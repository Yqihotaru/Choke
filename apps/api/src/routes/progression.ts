import { and, asc, count, desc, eq, getTableColumns, gte, inArray, lt, ne, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { requireSelf } from "../auth/guard"
import {
  FOIL_COST,
  SHARD_EXP_RATE,
  constellationCap,
  essenceOf,
  expToNext,
  isHeroCardId,
  levelCap,
  meltExpOf,
  shardOf,
  type Rarity,
} from "../shared/cards"
import { db } from "../db/client"
import { cards, deckSlots, marketListings, userCards, users } from "../db/schema"
import { TxAbort, lockUser, runTx } from "../tx"

const cardColumns = {
  ...getTableColumns(cards),
  userCardId: userCards.id,
  level: userCards.level,
  constellation: userCards.constellation,
  exp: userCards.exp,
  serial: userCards.serial,
  rollBp: userCards.rollBp,
  foil: userCards.foil,
  obtainedAt: userCards.obtainedAt,
}

const paramsSchema = z.object({
  userId: z.string(),
  userCardId: z.coerce.number().int().positive(),
})

async function loadCard(userId: string, userCardId: number) {
  const [row] = await db
    .select(cardColumns)
    .from(userCards)
    .innerJoin(cards, eq(cards.id, userCards.cardId))
    .where(and(eq(userCards.userId, userId), eq(userCards.id, userCardId)))
    .limit(1)
  return row ?? null
}

async function loadFuel(userId: string, excludeUserCardId: number) {
  const groups = await db
    .select({ cardId: userCards.cardId })
    .from(userCards)
    .where(eq(userCards.userId, userId))
    .groupBy(userCards.cardId)
    .having(sql`count(*) > 1`)

  const ids = groups.map((group) => group.cardId)
  if (ids.length === 0) return []

  return db
    .select(cardColumns)
    .from(userCards)
    .innerJoin(cards, eq(cards.id, userCards.cardId))
    .where(
      and(
        eq(userCards.userId, userId),
        inArray(userCards.cardId, ids),
        ne(userCards.id, excludeUserCardId),
      ),
    )
    .orderBy(desc(cards.pp), asc(userCards.id))
    .limit(60)
}

export async function progressionRoutes(app: FastifyInstance) {
  /** 可作为熔卡/升命座材料的重复卡 */
  app.get("/users/:userId/cards/:userCardId/fuel", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const { userCardId } = params
    const target = await loadCard(userId, userCardId)
    if (!target) {
      return reply.code(404).send({
        ok: false,
        error: { code: "not_found", message: "卡不在这个账号的卡册里" },
      })
    }
    return { ok: true, data: { rows: await loadFuel(userId, userCardId) } }
  })

  app.post("/users/:userId/cards/:userCardId/level", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const { userCardId } = params
    const target = await loadCard(userId, userCardId)
    if (!target) {
      return reply.code(404).send({
        ok: false,
        error: { code: "not_found", message: "卡不在这个账号的卡册里" },
      })
    }

    const hero = isHeroCardId(target.id)
    const cap = levelCap(hero)
    if (target.level >= cap) {
      return reply.code(400).send({
        ok: false,
        error: { code: "max_level", message: "已经满级" },
      })
    }

    const need = expToNext(target.level, target.rarity as Rarity, hero)
    if (target.exp < need) {
      return reply.code(400).send({
        ok: false,
        error: {
          code: "not_enough_exp",
          message: `经验不足：${target.exp} / ${need}`,
          need,
          exp: target.exp,
        },
      })
    }

    const [leveled] = await db
      .update(userCards)
      .set({ level: sql`${userCards.level} + 1`, exp: sql`${userCards.exp} - ${need}` })
      .where(
        and(
          eq(userCards.id, userCardId),
          eq(userCards.userId, userId),
          eq(userCards.level, target.level),
          gte(userCards.exp, need),
        ),
      )
      .returning({ id: userCards.id })
    if (!leveled) {
      return reply.code(409).send({
        ok: false,
        error: { code: "conflict", message: "卡牌状态刚刚变化了，请刷新后重试" },
      })
    }

    return {
      ok: true,
      data: { card: await loadCard(userId, userCardId), spent: need },
    }
  })

  app.post("/users/:userId/cards/:userCardId/constellation", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const { userCardId } = params
    const target = await loadCard(userId, userCardId)
    if (!target) {
      return reply.code(404).send({
        ok: false,
        error: { code: "not_found", message: "卡不在这个账号的卡册里" },
      })
    }

    const hero = isHeroCardId(target.id)
    const cap = constellationCap(hero)
    if (target.constellation >= cap) {
      return reply.code(400).send({
        ok: false,
        error: { code: "max_constellation", message: "已经满命座" },
      })
    }

    const [duplicate] = await db
      .select({ id: userCards.id })
      .from(userCards)
      .where(
        and(
          eq(userCards.userId, userId),
          eq(userCards.cardId, target.id),
          ne(userCards.id, userCardId),
        ),
      )
      .orderBy(asc(userCards.level), asc(userCards.id))
      .limit(1)

    if (!duplicate) {
      return reply.code(400).send({
        ok: false,
        error: { code: "no_duplicate", message: "没有同名卡可以消耗" },
      })
    }

    const result = await runTx(reply, async (tx) => {
      await lockUser(tx, userId)
      const consumed = await tx
        .delete(userCards)
        .where(and(eq(userCards.id, duplicate.id), eq(userCards.userId, userId)))
        .returning({ id: userCards.id })
      if (consumed.length === 0) {
        throw new TxAbort(400, "no_duplicate", "没有同名卡可以消耗")
      }
      await tx.delete(deckSlots).where(eq(deckSlots.userCardId, duplicate.id))
      await tx
        .update(marketListings)
        .set({ status: "cancelled" })
        .where(eq(marketListings.userCardId, duplicate.id))
      const upgraded = await tx
        .update(userCards)
        .set({ constellation: sql`${userCards.constellation} + 1` })
        .where(
          and(
            eq(userCards.id, userCardId),
            eq(userCards.userId, userId),
            lt(userCards.constellation, cap),
          ),
        )
        .returning({ id: userCards.id })
      if (upgraded.length === 0) {
        throw new TxAbort(400, "max_constellation", "已经满命座")
      }
      return true
    })
    if (!result) return

    return {
      ok: true,
      data: {
        card: await loadCard(userId, userCardId),
        consumedUserCardId: duplicate.id,
      },
    }
  })

  app.post("/users/:userId/cards/:userCardId/melt", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const { userCardId } = params
    const body = z
      .object({ sourceUserCardId: z.number().int().positive() })
      .parse(request.body)

    const target = await loadCard(userId, userCardId)
    if (!target) {
      return reply.code(404).send({
        ok: false,
        error: { code: "not_found", message: "卡不在这个账号的卡册里" },
      })
    }
    if (body.sourceUserCardId === userCardId) {
      return reply.code(400).send({
        ok: false,
        error: { code: "melt_self", message: "不能把卡熔给它自己" },
      })
    }

    const [source] = await db
      .select({
        id: userCards.id,
        cardId: userCards.cardId,
        rarity: cards.rarity,
        foil: userCards.foil,
      })
      .from(userCards)
      .innerJoin(cards, eq(cards.id, userCards.cardId))
      .where(and(eq(userCards.userId, userId), eq(userCards.id, body.sourceUserCardId)))
      .limit(1)

    if (!source) {
      return reply.code(400).send({
        ok: false,
        error: { code: "source_not_found", message: "材料卡不在这个账号的卡册里" },
      })
    }

    const [{ value: copies }] = await db
      .select({ value: count() })
      .from(userCards)
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, source.cardId)))

    if (Number(copies) < 2) {
      return reply.code(400).send({
        ok: false,
        error: { code: "last_copy", message: "这是最后一张，不能熔" },
      })
    }

    const gained = meltExpOf(source.rarity as Rarity)
    const essenceGained = essenceOf(source.rarity as Rarity, source.foil)

    const melted = await runTx(reply, async (tx) => {
      await lockUser(tx, userId)
      const removed = await tx
        .delete(userCards)
        .where(and(eq(userCards.id, source.id), eq(userCards.userId, userId)))
        .returning({ id: userCards.id })
      if (removed.length === 0) {
        throw new TxAbort(400, "source_not_found", "材料卡不在这个账号的卡册里")
      }
      const [{ value: left }] = await tx
        .select({ value: count() })
        .from(userCards)
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, source.cardId)))
      if (Number(left) < 1) {
        throw new TxAbort(400, "last_copy", "这是最后一张，不能熔")
      }

      await tx.delete(deckSlots).where(eq(deckSlots.userCardId, source.id))
      await tx
        .update(marketListings)
        .set({ status: "cancelled" })
        .where(eq(marketListings.userCardId, source.id))
      const fed = await tx
        .update(userCards)
        .set({ exp: sql`${userCards.exp} + ${gained}` })
        .where(and(eq(userCards.id, userCardId), eq(userCards.userId, userId)))
        .returning({ id: userCards.id })
      if (fed.length === 0) {
        throw new TxAbort(404, "not_found", "卡不在这个账号的卡册里")
      }
      const [wallet] = await tx
        .update(users)
        .set({ essence: sql`${users.essence} + ${essenceGained}` })
        .where(eq(users.id, userId))
        .returning({ essence: users.essence })
      return { essence: wallet?.essence ?? 0 }
    })
    if (!melted) return
    const wallet = melted

    return {
      ok: true,
      data: {
        card: await loadCard(userId, userCardId),
        gained,
        essenceGained,
        essence: wallet?.essence ?? 0,
        consumedUserCardId: source.id,
      },
    }
  })

  app.post("/users/:userId/cards/:userCardId/enhance", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const { userCardId } = params
    const body = z
      .object({ action: z.enum(["foil"]) })
      .parse(request.body)

    const target = await loadCard(userId, userCardId)
    if (!target) {
      return reply.code(404).send({
        ok: false,
        error: { code: "not_found", message: "卡不在这个账号的卡册里" },
      })
    }

    if (target.foil) {
      return reply.code(400).send({
        ok: false,
        error: { code: "already_foil", message: "这张卡已经是闪卡" },
      })
    }

    const cost = FOIL_COST

    const enhanced = await runTx(reply, async (tx) => {
      const [wallet] = await tx
        .update(users)
        .set({ essence: sql`${users.essence} - ${cost}` })
        .where(and(eq(users.id, userId), gte(users.essence, cost)))
        .returning({ essence: users.essence })
      if (!wallet) {
        const [user] = await tx
          .select({ essence: users.essence })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
        const essence = user?.essence ?? 0
        throw new TxAbort(400, "not_enough_essence", `精华不足：${essence} / ${cost}`, {
          need: cost,
          essence,
        })
      }
      const flipped = await tx
        .update(userCards)
        .set({ foil: true })
        .where(
          and(
            eq(userCards.id, userCardId),
            eq(userCards.userId, userId),
            eq(userCards.foil, false),
          ),
        )
        .returning({ id: userCards.id })
      if (flipped.length === 0) {
        throw new TxAbort(400, "already_foil", "这张卡已经是闪卡")
      }
      return wallet
    })
    if (!enhanced) return
    const wallet = enhanced

    return {
      ok: true,
      data: {
        card: await loadCard(userId, userCardId),
        cost,
        essence: wallet?.essence ?? 0,
        action: body.action,
      },
    }
  })

  /** 碎片换经验：1 碎片 = SHARD_EXP_RATE 经验，可以喂任何卡（含本体卡），满级卡不收。 */
  app.post("/users/:userId/cards/:userCardId/shards", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const { userCardId } = params
    const body = z
      .object({ amount: z.number().int().positive().max(1_000_000) })
      .parse(request.body)

    const target = await loadCard(userId, userCardId)
    if (!target) {
      return reply.code(404).send({
        ok: false,
        error: { code: "not_found", message: "卡不在这个账号的卡册里" },
      })
    }
    if (target.level >= levelCap(isHeroCardId(target.id))) {
      return reply.code(400).send({
        ok: false,
        error: { code: "max_level", message: "已满级，不需要经验" },
      })
    }

    const spent = body.amount
    const gained = spent * SHARD_EXP_RATE

    const fed = await runTx(reply, async (tx) => {
      const [wallet] = await tx
        .update(users)
        .set({ shards: sql`${users.shards} - ${spent}` })
        .where(and(eq(users.id, userId), gte(users.shards, spent)))
        .returning({ shards: users.shards })
      if (!wallet) {
        const [user] = await tx
          .select({ shards: users.shards })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
        const shards = user?.shards ?? 0
        throw new TxAbort(400, "not_enough_shards", `碎片不足：${shards} / ${spent}`, {
          need: spent,
          shards,
        })
      }
      const updated = await tx
        .update(userCards)
        .set({ exp: sql`${userCards.exp} + ${gained}` })
        .where(and(eq(userCards.id, userCardId), eq(userCards.userId, userId)))
        .returning({ id: userCards.id })
      if (updated.length === 0) {
        throw new TxAbort(404, "not_found", "卡不在这个账号的卡册里")
      }
      return wallet
    })
    if (!fed) return

    return {
      ok: true,
      data: {
        card: await loadCard(userId, userCardId),
        spent,
        gained,
        shards: fed.shards,
      },
    }
  })

  /**
   * 通用分解：任意卡 → 碎片（闪卡额外给精华）。与「融卡升命座」不同，这里不需要同名卡。
   * 仍然保留最后一张，避免把某张卡彻底分解光。
   */
  app.post("/users/:userId/cards/:userCardId/dismantle", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const { userCardId } = params

    const target = await loadCard(userId, userCardId)
    if (!target) {
      return reply.code(404).send({
        ok: false,
        error: { code: "not_found", message: "这不是你账号里的卡" },
      })
    }
    if (isHeroCardId(target.id)) {
      return reply.code(400).send({
        ok: false,
        error: { code: "hero_protected", message: "本体卡不能分解" },
      })
    }

    const [{ value: copies }] = await db
      .select({ value: count() })
      .from(userCards)
      .where(and(eq(userCards.userId, userId), eq(userCards.cardId, target.id)))
    if (Number(copies) < 2) {
      return reply.code(400).send({
        ok: false,
        error: { code: "last_copy", message: "这是最后一张，不能分解" },
      })
    }

    const shardsGained = shardOf(target.rarity as Rarity)
    const essenceGained = essenceOf(target.rarity as Rarity, target.foil)

    const dismantled = await runTx(reply, async (tx) => {
      await lockUser(tx, userId)
      const removed = await tx
        .delete(userCards)
        .where(and(eq(userCards.id, userCardId), eq(userCards.userId, userId)))
        .returning({ id: userCards.id })
      if (removed.length === 0) {
        throw new TxAbort(404, "not_found", "这不是你账号里的卡")
      }
      const [{ value: left }] = await tx
        .select({ value: count() })
        .from(userCards)
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, target.id)))
      if (Number(left) < 1) {
        throw new TxAbort(400, "last_copy", "这是最后一张，不能分解")
      }

      await tx.delete(deckSlots).where(eq(deckSlots.userCardId, userCardId))
      await tx
        .update(marketListings)
        .set({ status: "cancelled" })
        .where(eq(marketListings.userCardId, userCardId))
      const [wallet] = await tx
        .update(users)
        .set({
          shards: sql`${users.shards} + ${shardsGained}`,
          essence: sql`${users.essence} + ${essenceGained}`,
        })
        .where(eq(users.id, userId))
        .returning({ essence: users.essence, shards: users.shards })
      return { essence: wallet?.essence ?? 0, shards: wallet?.shards ?? 0 }
    })
    if (!dismantled) return

    return {
      ok: true,
      data: {
        removedUserCardId: userCardId,
        shardsGained,
        essenceGained,
        shards: dismantled.shards,
        essence: dismantled.essence,
      },
    }
  })
}
