import { and, desc, eq, getTableColumns, gte, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { MARKET_MAX_PRICE } from "../shared/cards"
import { MARKET_UNLOCK_LEVEL } from "../shared/tutorial"
import { requireSelf } from "../auth/guard"
import { db } from "../db/client"
import { EXPEDITION_LOCK_MESSAGE, anyLocked } from "../expedition/locks"
import { cards, deckSlots, marketListings, userCards, users } from "../db/schema"
import { recordLedger } from "../ledger"
import { TxAbort, runTx } from "../tx"

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
}

const paramsSchema = z.object({ userId: z.string() })
const listingParams = z.object({ userId: z.string(), listingId: z.coerce.number().int().positive() })

/** 市场是等级门槛功能：上架和购买都要服务端校验，不能只靠前端藏按钮 */
async function marketDenyReason(userId: string): Promise<"guest_market" | "market_locked" | null> {
  const [row] = await db
    .select({
      level: users.playerLevel,
      done: users.tutorialDone,
      osuId: users.osuId,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  // 游客（无 osu!、无邮箱）不能用市场：否则市场与卡牌稀缺性都失去意义。
  if (!row || (!row.osuId && !row.email)) return "guest_market"
  if (!row.done || row.level < MARKET_UNLOCK_LEVEL) return "market_locked"
  return null
}

async function loadCard(userId: string, userCardId: number) {
  const [row] = await db
    .select(cardColumns)
    .from(userCards)
    .innerJoin(cards, eq(cards.id, userCards.cardId))
    .where(and(eq(userCards.userId, userId), eq(userCards.id, userCardId)))
    .limit(1)
  return row ?? null
}

export async function marketRoutes(app: FastifyInstance) {
  app.get("/market/listings", async () => {
    const rows = await db
      .select({
        listingId: marketListings.id,
        price: marketListings.price,
        sellerId: marketListings.sellerId,
        sellerName: users.username,
        sellerPublicId: users.publicId,
        ...cardColumns,
      })
      .from(marketListings)
      .innerJoin(userCards, eq(userCards.id, marketListings.userCardId))
      .innerJoin(cards, eq(cards.id, userCards.cardId))
      .innerJoin(users, eq(users.id, marketListings.sellerId))
      .where(eq(marketListings.status, "active"))
      .orderBy(desc(marketListings.id))
      .limit(80)

    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.listingId,
        price: row.price,
        sellerId: row.sellerId,
        sellerName: row.sellerName,
        sellerPublicId: row.sellerPublicId,
        card: {
          id: row.id,
          name: row.name,
          rarity: row.rarity,
          job: row.job,
          no: row.no,
          total: row.total,
          country: row.country,
          globalRank: row.globalRank,
          pp: row.pp,
          profileUrl: row.profileUrl,
          art: row.art,
          banner: row.banner,
          skillRefs: row.skillRefs,
          version: row.version,
          userCardId: row.userCardId,
          level: row.level,
          constellation: row.constellation,
          exp: row.exp,
          serial: row.serial,
          rollBp: row.rollBp,
          pulled: row.pulled,
          foil: row.foil,
        },
      })),
    }
  })

  app.get("/users/:userId/market/listings", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return

    const rows = await db
      .select({
        listingId: marketListings.id,
        price: marketListings.price,
        ...cardColumns,
      })
      .from(marketListings)
      .innerJoin(userCards, eq(userCards.id, marketListings.userCardId))
      .innerJoin(cards, eq(cards.id, userCards.cardId))
      .where(and(eq(marketListings.sellerId, userId), eq(marketListings.status, "active")))
      .orderBy(desc(marketListings.id))

    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.listingId,
        price: row.price,
        card: {
          id: row.id,
          name: row.name,
          rarity: row.rarity,
          job: row.job,
          no: row.no,
          total: row.total,
          country: row.country,
          globalRank: row.globalRank,
          pp: row.pp,
          profileUrl: row.profileUrl,
          art: row.art,
          banner: row.banner,
          skillRefs: row.skillRefs,
          version: row.version,
          userCardId: row.userCardId,
          level: row.level,
          constellation: row.constellation,
          exp: row.exp,
          serial: row.serial,
          rollBp: row.rollBp,
          pulled: row.pulled,
          foil: row.foil,
        },
      })),
    }
  })

  app.post("/users/:userId/market/list", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const deny = await marketDenyReason(userId)
    if (deny) {
      return reply.code(403).send({
        ok: false,
        error: {
          code: deny,
          message:
            deny === "guest_market"
              ? "游客账号不能使用市场，请先用 osu! 或邮箱登录"
              : `市场达到 Lv.${MARKET_UNLOCK_LEVEL} 解锁后才能上架`,
        },
      })
    }
    const body = z
      .object({
        userCardId: z.number().int().positive(),
        price: z.number().int().min(1).max(MARKET_MAX_PRICE),
      })
      .safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "bad_request", message: "价格或卡 id 不合法" },
      })
    }

    const card = await loadCard(userId, body.data.userCardId)
    if (!card) {
      return reply.code(404).send({
        ok: false,
        error: { code: "not_found", message: "卡不在这个账号的卡册里" },
      })
    }
    if (card.id.startsWith("hero-")) {
      return reply.code(400).send({
        ok: false,
        error: { code: "hero_not_tradable", message: "本体卡不能上架" },
      })
    }

    const [inDeck] = await db
      .select({ id: deckSlots.userCardId })
      .from(deckSlots)
      .where(and(eq(deckSlots.userId, userId), eq(deckSlots.userCardId, body.data.userCardId)))
      .limit(1)
    if (inDeck) {
      return reply.code(400).send({
        ok: false,
        error: { code: "in_deck", message: "先从卡组里移出再上架" },
      })
    }
    if (await anyLocked(db, userId, [body.data.userCardId])) {
      return reply.code(400).send({
        ok: false,
        error: { code: "in_expedition", message: EXPEDITION_LOCK_MESSAGE },
      })
    }

    const [listed] = await db
      .select({ id: marketListings.id })
      .from(marketListings)
      .where(
        and(
          eq(marketListings.userCardId, body.data.userCardId),
          eq(marketListings.status, "active"),
        ),
      )
      .limit(1)
    if (listed) {
      return reply.code(400).send({
        ok: false,
        error: { code: "already_listed", message: "这张卡已经在市场里" },
      })
    }

    const [created] = await db
      .insert(marketListings)
      .values({
        sellerId: userId,
        userCardId: body.data.userCardId,
        price: body.data.price,
      })
      .returning()

    return {
      ok: true,
      data: {
        id: created!.id,
        price: created!.price,
        card,
      },
    }
  })

  app.delete("/users/:userId/market/listings/:listingId", async (request, reply) => {
    const params = listingParams.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return

    const removed = await db
      .delete(marketListings)
      .where(
        and(
          eq(marketListings.id, params.listingId),
          eq(marketListings.sellerId, userId),
          eq(marketListings.status, "active"),
        ),
      )
      .returning({ id: marketListings.id })

    if (removed.length === 0) {
      return reply.code(404).send({
        ok: false,
        error: { code: "not_found", message: "没有这条上架记录" },
      })
    }
    return { ok: true, data: { id: removed[0]!.id } }
  })

  app.post("/users/:userId/market/buy/:listingId", async (request, reply) => {
    const params = listingParams.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const deny = await marketDenyReason(userId)
    if (deny) {
      return reply.code(403).send({
        ok: false,
        error: {
          code: deny,
          message:
            deny === "guest_market"
              ? "游客账号不能使用市场，请先用 osu! 或邮箱登录"
              : `市场达到 Lv.${MARKET_UNLOCK_LEVEL} 解锁后才能购买`,
        },
      })
    }

    // 先在事务里把上架从 active 抢成 sold，再扣款、过户；任何一步失败都整体回滚，
    // 并发购买只有一个能抢到这条上架，金币也不会被扣成负数。
    const bought = await runTx(reply, async (tx) => {
      const [listing] = await tx
        .update(marketListings)
        .set({ status: "sold" })
        .where(and(eq(marketListings.id, params.listingId), eq(marketListings.status, "active")))
        .returning({
          sellerId: marketListings.sellerId,
          userCardId: marketListings.userCardId,
          price: marketListings.price,
        })
      if (!listing) {
        throw new TxAbort(404, "not_found", "这条上架已经不存在")
      }
      if (listing.sellerId === userId) {
        throw new TxAbort(400, "own_listing", "不能买自己的卡")
      }

      const [buyerWallet] = await tx
        .update(users)
        .set({ coins: sql`${users.coins} - ${listing.price}` })
        .where(and(eq(users.id, userId), gte(users.coins, listing.price)))
        .returning({ coins: users.coins })
      if (!buyerWallet) {
        const [buyer] = await tx
          .select({ coins: users.coins })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
        const coins = buyer?.coins ?? 0
        throw new TxAbort(400, "not_enough_coins", `金币不足：${coins} / ${listing.price}`, {
          need: listing.price,
          coins,
        })
      }

      const moved = await tx
        .update(userCards)
        .set({ userId })
        .where(and(eq(userCards.id, listing.userCardId), eq(userCards.userId, listing.sellerId)))
        .returning({ id: userCards.id, cardId: userCards.cardId })
      if (moved.length === 0) {
        throw new TxAbort(409, "card_moved", "卖家已经不再持有这张卡")
      }

      await tx
        .update(users)
        .set({ coins: sql`${users.coins} + ${listing.price}` })
        .where(eq(users.id, listing.sellerId))
      await tx.delete(deckSlots).where(eq(deckSlots.userCardId, listing.userCardId))
      const origin = { source: "market-buy", sourceRef: String(params.listingId) }
      await recordLedger(
        tx,
        userId,
        [
          { kind: "coins", delta: -listing.price },
          { kind: "card", ref: moved[0]!.cardId, delta: 1, userCardId: listing.userCardId },
        ],
        origin,
      )
      await recordLedger(
        tx,
        listing.sellerId,
        [
          { kind: "coins", delta: listing.price },
          { kind: "card", ref: moved[0]!.cardId, delta: -1, userCardId: listing.userCardId },
        ],
        { ...origin, source: "market-sell" },
      )
      return { coins: buyerWallet.coins, price: listing.price, userCardId: listing.userCardId }
    })
    if (!bought) return

    return {
      ok: true,
      data: {
        card: await loadCard(userId, bought.userCardId),
        price: bought.price,
        coins: bought.coins,
      },
    }
  })
}
