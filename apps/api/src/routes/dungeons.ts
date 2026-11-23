import { and, eq, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { dungeonById } from "@choke/shared/dungeons"
import { PLAYER_EXP_PER_STAMINA, addPlayerExp } from "@choke/shared/player"
import { settleStamina, spendStamina, staminaNextIn, STAMINA_MAX } from "@choke/shared/stamina"

import { requireSelf } from "../auth/guard"
import { db } from "../db/client"
import { dungeonRuns, userPacks, users } from "../db/schema"
import { grantItems } from "../items"
import { recordLedger } from "../ledger"
import { recordQuestEvent } from "../quest-events"

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

    return {
      ok: true,
      data: { value: stamina.value, max: STAMINA_MAX, nextIn: stamina.nextIn },
    }
  })

  app.post("/users/:userId/dungeons/:dungeonId/run", async (request, reply) => {
    const params = runParamsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return

    const dungeon = dungeonById(params.dungeonId)
    if (!dungeon) {
      return reply.code(404).send({
        ok: false,
        error: { code: "unknown_dungeon", message: "没有这个副本" },
      })
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
  })
}
