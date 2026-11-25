import { and, eq, gte, sql } from "drizzle-orm"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { DUNGEONS, dungeonById } from "@choke/shared/dungeons"
import { PLAYER_EXP_PER_STAMINA, addPlayerExp } from "@choke/shared/player"
import { resetDayKey } from "@choke/shared/reset"
import {
  STAMINA_MAX,
  STAMINA_OVERFLOW_MAX,
  STAMINA_POTION_COST,
  STAMINA_POTION_DAILY_LIMIT,
  STAMINA_POTION_GAIN,
  settleStamina,
  spendStamina,
  staminaNextIn,
} from "@choke/shared/stamina"

import { requireSelf } from "../auth/guard"
import { WORLD_CONTENT } from "../content"
import { db } from "../db/client"
import { dungeonRuns, ledgerEntries, mapClears, userPacks, users } from "../db/schema"
import { grantItems } from "../items"
import { recordLedger } from "../ledger"
import { recordQuestEvent } from "../quest-events"
import { TxAbort, lockUser, runTx, type Tx } from "../tx"
import { requireFeature } from "../unlocks"

const paramsSchema = z.object({ userId: z.string() })
const runParamsSchema = z.object({ userId: z.string(), dungeonId: z.string() })

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

export async function dungeonRoutes(app: FastifyInstance) {
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

  app.get("/users/:userId/dungeons", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return

    const rows = await db
      .select({ mapId: mapClears.mapId, clears: mapClears.clears })
      .from(mapClears)
      .where(eq(mapClears.userId, userId))
    const clearsByMap = new Map(rows.map((r) => [r.mapId, r.clears]))

    return {
      ok: true,
      data: DUNGEONS.map((d) => {
        const clears = d.mapId ? (clearsByMap.get(d.mapId) ?? 0) : 0
        return {
          ...d,
          clears,
          sweepUnlocked: !d.mapId || clears > 0,
        }
      }),
    }
  })

  async function handleDungeonSweep(request: FastifyRequest, reply: FastifyReply) {
    const params = runParamsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    if (!(await requireFeature(reply, userId, "dungeons"))) return

    const dungeon = dungeonById(params.dungeonId)
    if (!dungeon) {
      return reply.code(404).send({
        ok: false,
        error: { code: "unknown_dungeon", message: "没有这个副本" },
      })
    }

    if (dungeon.mapId) {
      const [clear] = await db
        .select({ clears: mapClears.clears })
        .from(mapClears)
        .where(and(eq(mapClears.userId, userId), eq(mapClears.mapId, dungeon.mapId)))
        .limit(1)
      if (!clear || clear.clears <= 0) {
        const mapName = WORLD_CONTENT.maps[dungeon.mapId]?.name ?? dungeon.mapId
        return reply.code(400).send({
          ok: false,
          error: {
            code: "first_clear_required",
            message: `需先首通远征「${mapName}」才可扫荡`,
          },
        })
      }
    }

    const { essence = 0, coins = 0, packs = 0, items = [] } = dungeon.rewards

    // 体力是「读出 → 按时间结算 → 写回」，所以用 (stamina, updatedAt) 做乐观锁：
    // 并发请求只有一个能写成功，其余重读后重算，不会重复使用同一份体力。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [row] = await db
        .select({
          stamina: users.stamina,
          updatedAt: users.staminaUpdatedAt,
          playerLevel: users.playerLevel,
          playerExp: users.playerExp,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
      if (!row) {
        return reply.code(404).send({
          ok: false,
          error: { code: "not_found", message: "用户不存在" },
        })
      }

      const playerExpGained = dungeon.cost * PLAYER_EXP_PER_STAMINA
      const player = addPlayerExp({ level: row.playerLevel, exp: row.playerExp }, playerExpGained)
      const now = Date.now()
      const spent = spendStamina({ value: row.stamina, updatedAt: row.updatedAt }, dungeon.cost, now)
      if (!spent) {
        const settled = settleStamina({ value: row.stamina, updatedAt: row.updatedAt }, now)
        return reply.code(400).send({
          ok: false,
          error: {
            code: "not_enough_stamina",
            message: `体力不足（需要 ${dungeon.cost}，当前 ${settled.value}）`,
          },
        })
      }

      const wallet = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(users)
          .set({
            stamina: spent.value,
            staminaUpdatedAt: spent.updatedAt,
            essence: sql`${users.essence} + ${essence}`,
            coins: sql`${users.coins} + ${coins}`,
            playerLevel: player.level,
            playerExp: player.exp,
            progressUpdatedAt: now,
          })
          .where(
            and(
              eq(users.id, userId),
              eq(users.stamina, row.stamina),
              eq(users.staminaUpdatedAt, row.updatedAt),
              eq(users.playerLevel, row.playerLevel),
              eq(users.playerExp, row.playerExp),
            ),
          )
          .returning({ essence: users.essence, coins: users.coins })
        if (!updated) return null

        if (packs > 0) {
          await tx
            .insert(userPacks)
            .values({ userId, pool: "normal", count: packs })
            .onConflictDoUpdate({
              target: [userPacks.userId, userPacks.pool],
              set: { count: sql`${userPacks.count} + ${packs}` },
            })
        }
        if (items.length > 0) await grantItems(tx, userId, items)
        await recordLedger(
          tx,
          userId,
          [
            { kind: "stamina", delta: -dungeon.cost },
            { kind: "essence", delta: essence },
            { kind: "coins", delta: coins },
            { kind: "pack", ref: "normal", delta: packs },
            ...items.map(({ itemId, count }) => ({ kind: "item" as const, ref: itemId, delta: count })),
          ],
          { source: "dungeon", sourceRef: dungeon.id },
        )
        await recordQuestEvent(tx, userId, "dungeon-run")

        await tx.insert(dungeonRuns).values({
          userId,
          dungeon: dungeon.id,
          cost: dungeon.cost,
          rewards: dungeon.rewards,
        })
        return updated
      })
      if (!wallet) continue

      return {
        ok: true,
        data: {
          rewards: dungeon.rewards,
          stamina: {
            value: spent.value,
            max: STAMINA_MAX,
            overflowMax: STAMINA_OVERFLOW_MAX,
            nextIn: staminaNextIn(spent, now),
          },
          essence: wallet.essence,
          coins: wallet.coins,
          player: { ...player, gained: playerExpGained },
        },
      }
    }

    return reply.code(409).send({
      ok: false,
      error: { code: "busy", message: "操作太频繁，请稍后再试" },
    })
  }

  app.post("/users/:userId/dungeons/:dungeonId/sweep", handleDungeonSweep)
  app.post("/users/:userId/dungeons/:dungeonId/run", handleDungeonSweep)
}
