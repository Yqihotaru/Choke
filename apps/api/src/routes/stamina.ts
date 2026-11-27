import { and, eq, gte, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { resetDayKey } from "@choke/shared/reset"
import {
  STAMINA_MAX,
  STAMINA_OVERFLOW_MAX,
  STAMINA_POTION_COST,
  STAMINA_POTION_DAILY_LIMIT,
  STAMINA_POTION_GAIN,
  settleStamina,
  staminaNextIn,
} from "@choke/shared/stamina"

import { requireSelf } from "../auth/guard"
import { db } from "../db/client"
import { ledgerEntries, users } from "../db/schema"
import { recordLedger } from "../ledger"
import { TxAbort, lockUser, runTx, type Tx } from "../tx"
import { requireFeature } from "../unlocks"

const paramsSchema = z.object({ userId: z.string() })

async function loadStamina(userId: string) {
  const [row] = await db
    .select({
      stamina: users.stamina,
      updatedAt: users.staminaUpdatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!row) return null
  const now = Date.now()
  const settled = settleStamina({ value: row.stamina, updatedAt: row.updatedAt }, now)
  return { ...settled, nextIn: staminaNextIn(settled, now) }
}

async function countPotionsToday(executor: Tx | typeof db, userId: string, dayKey: string): Promise<number> {
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        eq(ledgerEntries.kind, "coins"),
        eq(ledgerEntries.source, "stamina-potion"),
        eq(ledgerEntries.sourceRef, dayKey),
      ),
    )
  return row?.count ?? 0
}

export async function staminaRoutes(app: FastifyInstance) {
  app.get("/users/:userId/stamina", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return

    const stamina = await loadStamina(userId)
    if (!stamina) {
      return reply.code(404).send({
        ok: false,
        error: { code: "not_found", message: "用户不存在" },
      })
    }

    const potionUsedToday = await countPotionsToday(db, userId, resetDayKey(Date.now()))
    return {
      ok: true,
      data: {
        value: stamina.value,
        max: STAMINA_MAX,
        overflowMax: STAMINA_OVERFLOW_MAX,
        nextIn: stamina.nextIn,
        potionUsedToday,
        potionDailyLimit: STAMINA_POTION_DAILY_LIMIT,
        potionCost: STAMINA_POTION_COST,
        potionGain: STAMINA_POTION_GAIN,
      },
    }
  })

  app.post("/users/:userId/stamina/potion", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    if (!(await requireFeature(reply, userId, "stamina-potion"))) return

    const now = Date.now()
    const dayKey = resetDayKey(now)

    const result = await runTx(reply, async (tx) => {
      await lockUser(tx, userId)
      const used = await countPotionsToday(tx, userId, dayKey)
      if (used >= STAMINA_POTION_DAILY_LIMIT) {
        throw new TxAbort(400, "daily_limit_reached", `今日体力药水已达上限（${STAMINA_POTION_DAILY_LIMIT} 次）`)
      }

      const [user] = await tx
        .select({
          coins: users.coins,
          stamina: users.stamina,
          updatedAt: users.staminaUpdatedAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
      if (!user) throw new TxAbort(404, "not_found", "用户不存在")

      const settled = settleStamina({ value: user.stamina, updatedAt: user.updatedAt }, now)
      if (settled.value >= STAMINA_OVERFLOW_MAX) {
        throw new TxAbort(400, "stamina_full", "体力已达上限（720），无需购买")
      }

      const [wallet] = await tx
        .update(users)
        .set({ coins: sql`${users.coins} - ${STAMINA_POTION_COST}` })
        .where(and(eq(users.id, userId), gte(users.coins, STAMINA_POTION_COST)))
        .returning({ coins: users.coins })
      if (!wallet) {
        throw new TxAbort(400, "not_enough_coins", `金币不足：${user.coins} / ${STAMINA_POTION_COST}`, {
          need: STAMINA_POTION_COST,
          coins: user.coins,
        })
      }

      const nextValue = Math.min(STAMINA_OVERFLOW_MAX, settled.value + STAMINA_POTION_GAIN)
      const nextUpdatedAt = nextValue >= STAMINA_OVERFLOW_MAX ? now : settled.updatedAt
      const gained = nextValue - settled.value

      await tx
        .update(users)
        .set({ stamina: nextValue, staminaUpdatedAt: nextUpdatedAt })
        .where(eq(users.id, userId))

      await recordLedger(
        tx,
        userId,
        [
          { kind: "coins", delta: -STAMINA_POTION_COST },
          { kind: "stamina", delta: gained },
        ],
        { source: "stamina-potion", sourceRef: dayKey },
      )

      return {
        stamina: {
          value: nextValue,
          max: STAMINA_MAX,
          overflowMax: STAMINA_OVERFLOW_MAX,
          nextIn: staminaNextIn({ value: nextValue, updatedAt: nextUpdatedAt }, now),
        },
        coins: wallet.coins,
        gained,
        potionUsedToday: used + 1,
        potionDailyLimit: STAMINA_POTION_DAILY_LIMIT,
      }
    })
    if (!result) return

    return { ok: true, data: result }
  })
}
