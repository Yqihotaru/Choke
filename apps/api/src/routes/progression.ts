import { and, asc, desc, eq, getTableColumns, gte, inArray, lt, ne, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import {
  NPC_RECYCLE_DAILY_LIMIT,
  npcRecycleValue,
} from "@choke/shared/economy"
import {
  ITEMS,
  SHARDS_PER_DISMANTLE,
  expToItems,
  isItemId,
  shardItemId,
  type ItemStack,
} from "@choke/shared/items"
import {
  applyExpWithBreakthrough,
  breakthroughCoinCost,
} from "@choke/shared/progression"
import {
  RESONANCE_ATTR_CAP,
  RESONANCE_TOTAL_CAP,
  RESONANCE_VALUE_BP,
  resonanceAttributeOf,
  summarizeResonance,
  type ResonanceAttribute,
  type ResonanceRecord,
} from "@choke/shared/resonance"
import { resetDayKey } from "@choke/shared/reset"
import type { Job, Mod } from "@choke/shared/types"

import { requireSelf } from "../auth/guard"
import {
  FOIL_COST,
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
import { EXPEDITION_LOCK_MESSAGE, anyLocked, lockedUserCardIds } from "../expedition/locks"
import { cards, deckSlots, heroResonance, ledgerEntries, marketListings, userCards, users } from "../db/schema"
import { grantItems, loadItems, mergeStacks, spendItems } from "../items"
import { recordLedger, type LedgerEntryInput } from "../ledger"
import { recordQuestEvent } from "../quest-events"
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

/** 从卡册里移走一张卡：同时清掉布阵和在架的市场单。出征中的卡不能移走 */
async function removeUserCard(tx: Tx, userId: string, userCardId: number) {
  if (await anyLocked(tx, userId, [userCardId])) {
    throw new TxAbort(400, "in_expedition", EXPEDITION_LOCK_MESSAGE)
  }
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
  skillRefs: userCards.skillRefs,
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

const constellationBodySchema = z
  .object({
    materialUserCardId: z.number().int().positive().optional(),
  })
  .optional()

async function loadResonance(executor: Tx | typeof db, userId: string): Promise<ResonanceRecord[]> {
  const rows = await executor
    .select({
      sourceCardId: heroResonance.sourceCardId,
      attribute: heroResonance.attribute,
      valueBp: heroResonance.valueBp,
      slot: heroResonance.slot,
    })
    .from(heroResonance)
    .where(eq(heroResonance.userId, userId))
    .orderBy(asc(heroResonance.slot), asc(heroResonance.createdAt))
  return rows.map((row) => ({
    sourceCardId: row.sourceCardId,
    attribute: row.attribute as ResonanceAttribute,
    valueBp: row.valueBp,
    slot: row.slot,
  }))
}

export async function progressionRoutes(app: FastifyInstance) {
  /** 本体卡吞噬共鸣记录与汇总 */
  app.get("/users/:userId/resonance", async (request, reply) => {
    const { userId: paramUserId } = z.object({ userId: z.string() }).parse(request.params)
    const userId = requireSelf(request, reply, paramUserId)
    if (!userId) return
    const records = await loadResonance(db, userId)
    return {
      ok: true,
      data: {
        records,
        summary: summarizeResonance(records),
      },
    }
  })

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

    const coinCost = breakthroughCoinCost(target.level, hero)
    const result = await runTx(reply, async (tx) => {
      await lockUser(tx, userId)
      if (coinCost > 0) {
        const [wallet] = await tx
          .update(users)
          .set({ coins: sql`${users.coins} - ${coinCost}` })
          .where(and(eq(users.id, userId), gte(users.coins, coinCost)))
          .returning({ coins: users.coins })
        if (!wallet) {
          const [u] = await tx.select({ coins: users.coins }).from(users).where(eq(users.id, userId)).limit(1)
          const coins = u?.coins ?? 0
          throw new TxAbort(400, "not_enough_coins", `突破金币不足：${coins} / ${coinCost}`, {
            need: coinCost,
            coins,
          })
        }
      }

      const [leveled] = await tx
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
        throw new TxAbort(409, "conflict", "卡牌状态刚刚变化了，请刷新后重试")
      }

      if (coinCost > 0) {
        await recordLedger(tx, userId, [{ kind: "coins", delta: -coinCost }], {
          source: "breakthrough",
          sourceRef: String(userCardId),
        })
      }

      const [u] = await tx.select({ coins: users.coins }).from(users).where(eq(users.id, userId)).limit(1)
      return { coins: u?.coins ?? 0 }
    })
    if (!result) return

    return {
      ok: true,
      data: {
        card: await loadCard(userId, userCardId),
        spent: need,
        coinsSpent: coinCost,
        coins: result.coins,
      },
    }
  })

  app.post("/users/:userId/cards/:userCardId/constellation", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const body = constellationBodySchema.parse(request.body)
    const { userCardId } = params
    const target = await loadCard(userId, userCardId)
    if (!target) {
      return reply.code(404).send({
        ok: false,
        error: { code: "not_found", message: "卡不在这个账号的卡册里" },
      })
    }

    const hero = target.cardType === "hero" || isHeroCardId(target.id)
    const cap = constellationCap(hero)
    if (target.constellation >= cap) {
      return reply.code(400).send({
        ok: false,
        error: { code: "max_constellation", message: "已经满命座" },
      })
    }

    if (hero) {
      const materialUserCardId = body?.materialUserCardId
      if (!materialUserCardId) {
        return reply.code(400).send({
          ok: false,
          error: { code: "missing_material", message: "本体卡升命座需要选择一张镜像卡作为材料" },
        })
      }
      if (materialUserCardId === userCardId) {
        return reply.code(400).send({
          ok: false,
          error: { code: "invalid_material", message: "不能吞噬自己" },
        })
      }

      const result = await runTx(reply, async (tx) => {
        await lockUser(tx, userId)

        const [freshTarget] = await tx
          .select({ id: userCards.id, constellation: userCards.constellation })
          .from(userCards)
          .where(and(eq(userCards.id, userCardId), eq(userCards.userId, userId)))
          .limit(1)
        if (!freshTarget) throw new TxAbort(404, "not_found", "卡不在这个账号的卡册里")
        if (freshTarget.constellation >= cap) {
          throw new TxAbort(400, "max_constellation", "已经满命座")
        }

        const [material] = await tx
          .select({
            id: userCards.id,
            cardId: userCards.cardId,
            cardType: cards.cardType,
            job: cards.job,
            mods: userCards.mods,
          })
          .from(userCards)
          .innerJoin(cards, eq(cards.id, userCards.cardId))
          .where(and(eq(userCards.id, materialUserCardId), eq(userCards.userId, userId)))
          .limit(1)
        if (!material) {
          throw new TxAbort(404, "material_not_found", "材料卡不在这个账号的卡册里")
        }
        if (material.cardType !== "mirror") {
          throw new TxAbort(400, "invalid_material", "本体卡命座只能吞噬镜像卡")
        }

        const existing = await loadResonance(tx, userId)
        if (existing.some((r) => r.sourceCardId === material.cardId)) {
          throw new TxAbort(409, "duplicate_source", "同一玩家的镜像卡只能提供一次共鸣")
        }

        const attr = resonanceAttributeOf(material.job as Job, (material.mods ?? []) as Mod[])
        const attrCount = existing.filter((r) => r.attribute === attr).length
        const capped = attrCount >= RESONANCE_ATTR_CAP || existing.length >= RESONANCE_TOTAL_CAP

        await removeUserCard(tx, userId, material.id)

        const nextSlot = freshTarget.constellation + 1
        const [upgraded] = await tx
          .update(userCards)
          .set({ constellation: nextSlot })
          .where(and(eq(userCards.id, userCardId), eq(userCards.userId, userId), lt(userCards.constellation, cap)))
          .returning({ constellation: userCards.constellation })
        if (!upgraded) {
          throw new TxAbort(400, "max_constellation", "已经满命座")
        }

        let addedResonance: ResonanceRecord | null = null
        if (!capped) {
          addedResonance = {
            sourceCardId: material.cardId,
            attribute: attr,
            valueBp: RESONANCE_VALUE_BP,
            slot: nextSlot,
          }
          await tx.insert(heroResonance).values({
            userId,
            sourceCardId: addedResonance.sourceCardId,
            attribute: addedResonance.attribute,
            valueBp: addedResonance.valueBp,
            slot: addedResonance.slot,
          })
        }

        await recordLedger(
          tx,
          userId,
          [{ kind: "card", ref: material.cardId, delta: -1, userCardId: material.id }],
          { source: "resonance", sourceRef: String(userCardId) },
        )
        await recordQuestEvent(tx, userId, "fuse")

        const resonance = await loadResonance(tx, userId)
        return {
          consumedUserCardId: material.id,
          constellation: upgraded.constellation,
          resonance,
          summary: summarizeResonance(resonance),
          addedResonance,
          capped,
        }
      })
      if (!result) return

      return {
        ok: true,
        data: {
          card: await loadCard(userId, userCardId),
          ...result,
        },
      }
    }

    const duplicates = await db
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
    const locked = await lockedUserCardIds(db, userId)
    const preferredId = body?.materialUserCardId
    const duplicate = preferredId
      ? duplicates.find((row) => row.id === preferredId && !locked.has(row.id))
      : duplicates.find((row) => !locked.has(row.id))

    if (!duplicate) {
      if (duplicates.length > 0 && (!preferredId || duplicates.some((row) => row.id === preferredId))) {
        return reply.code(400).send({
          ok: false,
          error: { code: "in_expedition", message: EXPEDITION_LOCK_MESSAGE },
        })
      }
      return reply.code(400).send({
        ok: false,
        error: { code: "no_duplicate", message: "没有同名卡可以消耗" },
      })
    }

    const result = await runTx(reply, async (tx) => {
      await lockUser(tx, userId)
      if (await anyLocked(tx, userId, [duplicate.id])) {
        throw new TxAbort(400, "in_expedition", EXPEDITION_LOCK_MESSAGE)
      }
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
      await recordLedger(
        tx,
        userId,
        [{ kind: "card", ref: target.id, delta: -1, userCardId: duplicate.id }],
        { source: "fuse", sourceRef: String(userCardId) },
      )
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
      await recordQuestEvent(tx, userId, "fuse")
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
      const ledger: LedgerEntryInput[] = []
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

        for (const source of sources) {
          const rarity = source.rarity as Rarity
          gained += feedExpOf({ rarity, level: source.level, exp: source.exp })
          essenceGained += essenceOf(rarity, source.foil)
          await removeUserCard(tx, userId, source.id)
          ledger.push({ kind: "card", ref: source.cardId, delta: -1, userCardId: source.id })
        }
      }

      if (stacks.length > 0) {
        await spendItems(tx, userId, stacks)
        for (const { itemId, count: amount } of stacks) {
          gained += ITEMS[itemId].exp * amount
          ledger.push({ kind: "item", ref: itemId, delta: -amount })
        }
      }

      const [userRow] = await tx
        .select({ coins: users.coins })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
      const availableCoins = userRow?.coins ?? 0

      const next = applyExpWithBreakthrough(
        target.level,
        target.exp,
        gained,
        target.rarity as Rarity,
        targetHero,
        availableCoins,
      )
      await tx
        .update(userCards)
        .set({ level: next.level, exp: next.exp })
        .where(and(eq(userCards.id, userCardId), eq(userCards.userId, userId)))

      let coins = availableCoins
      if (next.coinsSpent > 0) {
        const [coinWallet] = await tx
          .update(users)
          .set({ coins: sql`${users.coins} - ${next.coinsSpent}` })
          .where(eq(users.id, userId))
          .returning({ coins: users.coins })
        coins = coinWallet?.coins ?? availableCoins - next.coinsSpent
        ledger.push({ kind: "coins", delta: -next.coinsSpent })
      }

      let essence: number | undefined
      if (essenceGained > 0) {
        const [wallet] = await tx
          .update(users)
          .set({ essence: sql`${users.essence} + ${essenceGained}` })
          .where(eq(users.id, userId))
          .returning({ essence: users.essence })
        essence = wallet?.essence
      }
      ledger.push({ kind: "essence", delta: essenceGained })
      await recordLedger(tx, userId, ledger, { source: "feed", sourceRef: String(userCardId) })
      await recordQuestEvent(tx, userId, "feed")

      return {
        gained,
        wasted: next.wasted,
        levelsGained: next.level - target.level,
        coinsSpent: next.coinsSpent,
        blockedCost: next.blockedCost,
        coins,
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
      await recordLedger(tx, userId, [{ kind: "essence", delta: -cost }], {
        source: "foil",
        sourceRef: String(userCardId),
      })
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
   * 除本体卡外任何卡都能分解，包括最后一张。
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
      await recordLedger(
        tx,
        userId,
        [
          { kind: "card", ref: target.id, delta: -1, userCardId },
          ...itemsGained.map(({ itemId, count }) => ({ kind: "item" as const, ref: itemId, delta: count })),
          { kind: "essence", delta: essenceGained },
        ],
        { source: "dismantle", sourceRef: String(userCardId) },
      )
      await recordQuestEvent(tx, userId, "dismantle")
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

  async function countRecycledToday(executor: Tx | typeof db, userId: string, dayKey: string): Promise<number> {
    const [row] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.userId, userId),
          eq(ledgerEntries.kind, "card"),
          eq(ledgerEntries.source, "npc-recycle"),
          eq(ledgerEntries.sourceRef, dayKey),
        ),
      )
    return row?.count ?? 0
  }

  /** 查询今日 NPC 回收额度 */
  app.get("/users/:userId/cards/recycle", async (request, reply) => {
    const { userId: paramUserId } = z.object({ userId: z.string() }).parse(request.params)
    const userId = requireSelf(request, reply, paramUserId)
    if (!userId) return

    const dayKey = resetDayKey(Date.now())
    const usedToday = await countRecycledToday(db, userId, dayKey)
    return {
      ok: true,
      data: {
        dailyLimit: NPC_RECYCLE_DAILY_LIMIT,
        usedToday,
        remaining: Math.max(0, NPC_RECYCLE_DAILY_LIMIT - usedToday),
      },
    }
  })

  /** NPC 回收：批量把多余卡换金币（每日限 20 张，本体卡和出征锁定卡不可回收） */
  app.post("/users/:userId/cards/recycle", async (request, reply) => {
    const { userId: paramUserId } = z.object({ userId: z.string() }).parse(request.params)
    const userId = requireSelf(request, reply, paramUserId)
    if (!userId) return

    const body = z
      .object({
        userCardIds: z.array(z.number().int().positive()).min(1).max(NPC_RECYCLE_DAILY_LIMIT),
      })
      .refine((b) => new Set(b.userCardIds).size === b.userCardIds.length, "卡不能重复")
      .parse(request.body)

    const dayKey = resetDayKey(Date.now())
    const recycled = await runTx(reply, async (tx) => {
      await lockUser(tx, userId)
      const usedToday = await countRecycledToday(tx, userId, dayKey)
      const remaining = Math.max(0, NPC_RECYCLE_DAILY_LIMIT - usedToday)
      if (body.userCardIds.length > remaining) {
        throw new TxAbort(
          400,
          "daily_limit_reached",
          `今日 NPC 回收剩余额度不足（剩余 ${remaining} / ${NPC_RECYCLE_DAILY_LIMIT} 张）`,
        )
      }

      const targets = await tx
        .select({
          id: userCards.id,
          cardId: userCards.cardId,
          level: userCards.level,
          exp: userCards.exp,
          rarity: cards.rarity,
          cardType: cards.cardType,
        })
        .from(userCards)
        .innerJoin(cards, eq(cards.id, userCards.cardId))
        .where(and(eq(userCards.userId, userId), inArray(userCards.id, body.userCardIds)))

      if (targets.length !== body.userCardIds.length) {
        throw new TxAbort(404, "not_found", "有卡不在这个账号的卡册里")
      }
      if (targets.some((t) => t.cardType === "hero" || isHeroCardId(t.cardId))) {
        throw new TxAbort(400, "hero_protected", "本体卡不能回收")
      }

      let coinsGained = 0
      const ledger: LedgerEntryInput[] = []
      for (const target of targets) {
        await removeUserCard(tx, userId, target.id)
        coinsGained += npcRecycleValue(target.rarity as Rarity, target.level, target.exp, false)
        ledger.push({ kind: "card", ref: target.cardId, delta: -1, userCardId: target.id })
      }

      const [wallet] = await tx
        .update(users)
        .set({ coins: sql`${users.coins} + ${coinsGained}` })
        .where(eq(users.id, userId))
        .returning({ coins: users.coins })

      ledger.push({ kind: "coins", delta: coinsGained })
      await recordLedger(tx, userId, ledger, { source: "npc-recycle", sourceRef: dayKey })

      return {
        recycledCount: targets.length,
        coinsGained,
        coins: wallet?.coins ?? 0,
        usedToday: usedToday + targets.length,
        remaining: remaining - targets.length,
        dailyLimit: NPC_RECYCLE_DAILY_LIMIT,
      }
    })
    if (!recycled) return

    return { ok: true, data: recycled }
  })
}
