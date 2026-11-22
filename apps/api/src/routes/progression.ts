import { and, asc, count, desc, eq, getTableColumns, gte, inArray, lt, ne, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import {
  ITEMS,
  SHARDS_PER_DISMANTLE,
  expToItems,
  isItemId,
  shardItemId,
  type ItemStack,
} from "@choke/shared/items"

import { requireSelf } from "../auth/guard"
import {
  FOIL_COST,
  applyExp,
  constellationCap,
  essenceOf,
  expToNext,
  feedExpOf,
  isHeroCardId,
  levelCap,
  refundExpOf,
  type Rarity,
} from "../shared/cards"
import { db } from "../db/client"
import { cards, deckSlots, marketListings, userCards, users } from "../db/schema"
import { grantItems, loadItems, mergeStacks, spendItems } from "../items"
import { TxAbort, lockUser, runTx, type Tx } from "../tx"

const feedBodySchema = z
  .object({
    cards: z.array(z.number().int().positive()).max(60).default([]),
    items: z
      .array(
        z.object({
          itemId: z.string().refine(isItemId, "未知物品"),
          count: z.number().int().positive().max(100_000),
        }),
      )
      .max(20)
      .default([]),
  })
  .refine((body) => body.cards.length > 0 || body.items.length > 0, "至少选一张卡或一种物品")
  .refine((body) => new Set(body.cards).size === body.cards.length, "卡不能重复")

/** 从卡册里移走一张卡：同时清掉布阵和在架的市场单 */
async function removeUserCard(tx: Tx, userId: string, userCardId: number) {
  const removed = await tx
    .delete(userCards)
    .where(and(eq(userCards.id, userCardId), eq(userCards.userId, userId)))
    .returning({ id: userCards.id })
  if (removed.length === 0) return false
  await tx.delete(deckSlots).where(eq(deckSlots.userCardId, userCardId))
  await tx
    .update(marketListings)
    .set({ status: "cancelled" })
    .where(eq(marketListings.userCardId, userCardId))
  return true
}

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
  /** 可作为喂养/融合材料的重复卡 */
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

  /**
   * 喂养：一次喂多张卡 + 多种物品（碎片、经验道具），喂完自动升级。
   * 卡：基础喂养值 + 已投入经验 × 75%；同名卡至少留一张。闪卡另给精华。
   * 满级后溢出的经验作废，返回 wasted 让前端提示；已满级的卡直接拒收。
   */
  app.post("/users/:userId/cards/:userCardId/feed", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const { userCardId } = params
    const body = feedBodySchema.parse(request.body)
    const stacks = mergeStacks(body.items as ItemStack[])

    if (body.cards.includes(userCardId)) {
      return reply.code(400).send({
        ok: false,
        error: { code: "feed_self", message: "不能把卡喂给它自己" },
      })
    }

    const result = await runTx(reply, async (tx) => {
      await lockUser(tx, userId)

      const [target] = await tx
        .select({ id: cards.id, rarity: cards.rarity, level: userCards.level, exp: userCards.exp })
        .from(userCards)
        .innerJoin(cards, eq(cards.id, userCards.cardId))
        .where(and(eq(userCards.userId, userId), eq(userCards.id, userCardId)))
        .limit(1)
      if (!target) throw new TxAbort(404, "not_found", "卡不在这个账号的卡册里")
      const targetHero = isHeroCardId(target.id)
      if (target.level >= levelCap(targetHero)) {
        throw new TxAbort(400, "max_level", "已经满级，不需要经验")
      }

      let gained = 0
      let essenceGained = 0

      if (body.cards.length > 0) {
        const sources = await tx
          .select({
            id: userCards.id,
            cardId: userCards.cardId,
            rarity: cards.rarity,
            level: userCards.level,
            exp: userCards.exp,
            foil: userCards.foil,
          })
          .from(userCards)
          .innerJoin(cards, eq(cards.id, userCards.cardId))
          .where(and(eq(userCards.userId, userId), inArray(userCards.id, body.cards)))
        if (sources.length !== body.cards.length) {
          throw new TxAbort(400, "source_not_found", "有材料卡不在这个账号的卡册里")
        }
        if (sources.some((source) => isHeroCardId(source.cardId))) {
          throw new TxAbort(400, "hero_protected", "本体卡不能当材料")
        }

        const using = new Map<string, number>()
        for (const source of sources) using.set(source.cardId, (using.get(source.cardId) ?? 0) + 1)
        const owned = await tx
          .select({ cardId: userCards.cardId, value: count() })
          .from(userCards)
          .where(and(eq(userCards.userId, userId), inArray(userCards.cardId, [...using.keys()])))
          .groupBy(userCards.cardId)
        for (const row of owned) {
          if (Number(row.value) - (using.get(row.cardId) ?? 0) < 1) {
            throw new TxAbort(400, "last_copy", "每张卡至少要留一张，不能全喂掉")
          }
        }

        for (const source of sources) {
          const rarity = source.rarity as Rarity
          gained += feedExpOf({ rarity, level: source.level, exp: source.exp })
          essenceGained += essenceOf(rarity, source.foil)
          await removeUserCard(tx, userId, source.id)
        }
      }

      if (stacks.length > 0) {
        await spendItems(tx, userId, stacks)
        for (const { itemId, count: amount } of stacks) gained += ITEMS[itemId].exp * amount
      }

      const next = applyExp(target.level, target.exp, gained, target.rarity as Rarity, targetHero)
      await tx
        .update(userCards)
        .set({ level: next.level, exp: next.exp })
        .where(and(eq(userCards.id, userCardId), eq(userCards.userId, userId)))

      let essence: number | undefined
      if (essenceGained > 0) {
        const [wallet] = await tx
          .update(users)
          .set({ essence: sql`${users.essence} + ${essenceGained}` })
          .where(eq(users.id, userId))
          .returning({ essence: users.essence })
        essence = wallet?.essence
      }

      return {
        gained,
        wasted: next.wasted,
        levelsGained: next.level - target.level,
        essenceGained,
        essence,
        items: await loadItems(userId, tx),
      }
    })
    if (!result) return

    return {
      ok: true,
      data: {
        card: await loadCard(userId, userCardId),
        ...result,
        consumedUserCardIds: body.cards,
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

  /**
   * 通用分解：任意卡 → 4 个同品质碎片（闪卡另给精华）。与「融合升命座」不同，这里不需要同名卡。
   * 升过级的卡另按已投入经验 × 75% 返还经验道具（大/中/小拆分，尾数舍去）。
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

    const rarity = target.rarity as Rarity
    const essenceGained = essenceOf(rarity, target.foil)

    const dismantled = await runTx(reply, async (tx) => {
      await lockUser(tx, userId)
      const [{ value: copies }] = await tx
        .select({ value: count() })
        .from(userCards)
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, target.id)))
      if (Number(copies) < 2) {
        throw new TxAbort(400, "last_copy", "这是最后一张，不能分解")
      }

      // 等级和经验在锁内重读，避免和并发的喂养交错
      const [fresh] = await tx
        .select({ level: userCards.level, exp: userCards.exp })
        .from(userCards)
        .where(and(eq(userCards.id, userCardId), eq(userCards.userId, userId)))
        .limit(1)
      if (!fresh || !(await removeUserCard(tx, userId, userCardId))) {
        throw new TxAbort(404, "not_found", "这不是你账号里的卡")
      }

      const itemsGained: ItemStack[] = [
        { itemId: shardItemId(rarity), count: SHARDS_PER_DISMANTLE },
        ...expToItems(refundExpOf(fresh.level, fresh.exp, rarity, false)),
      ]
      await grantItems(tx, userId, itemsGained)

      const [wallet] = await tx
        .update(users)
        .set({ essence: sql`${users.essence} + ${essenceGained}` })
        .where(eq(users.id, userId))
        .returning({ essence: users.essence })
      return { essence: wallet?.essence ?? 0, itemsGained, items: await loadItems(userId, tx) }
    })
    if (!dismantled) return

    return {
      ok: true,
      data: {
        removedUserCardId: userCardId,
        itemsGained: dismantled.itemsGained,
        essenceGained,
        items: dismantled.items,
        essence: dismantled.essence,
      },
    }
  })
}
