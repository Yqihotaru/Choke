import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { requireSelf } from "../auth/guard"
import { CARD_TYPES } from "../card-types"
import { db } from "../db/client"
import { cards, userCards } from "../db/schema"

const RARITY_RANK = sql`CASE ${cards.rarity}
  WHEN 'C' THEN 0
  WHEN 'UC' THEN 1
  WHEN 'R' THEN 2
  WHEN 'E' THEN 3
  WHEN 'L' THEN 4
  WHEN 'Radiant' THEN 5
  WHEN 'Prismatic' THEN 6
  ELSE -1
END`

const SORTS = ["recent", "rarity", "pp", "name"] as const

interface PublicCardsPayload {
  rows: (typeof cards.$inferSelect)[]
  total: number
  limit: number
  offset: number
}
const publicCardsCache = new Map<string, PublicCardsPayload>()
const publicCountCache = new Map<string, number>()
const PUBLIC_CACHE_LIMIT = 64
let publicStats: { total: number; byRarity: Record<string, number> } | null = null
let publicCardsRevision = 0
/** 发行数变化只失效卡行；卡定义总数、稀有度统计仍可复用。 */
export function invalidatePublicCardRows() {
  publicCardsCache.clear()
  publicCardsRevision += 1
}
export function invalidatePublicCardCache() {
  invalidatePublicCardRows()
  publicCountCache.clear()
  publicStats = null
}

async function queryPublicCards(query: {
  rarity?: string
  q?: string
  country?: string
  sort: (typeof SORTS)[number]
  limit: number
  offset: number
}) {
  const filters = [eq(cards.cardType, CARD_TYPES.pool)]
  if (query.rarity) filters.push(eq(cards.rarity, query.rarity))
  if (query.country) filters.push(eq(cards.country, query.country))
  if (query.q) filters.push(ilike(cards.name, `%${query.q}%`))
  const where = and(...filters)
  const countKey = JSON.stringify({ rarity: query.rarity, q: query.q, country: query.country })
  const cachedTotal = publicCountCache.get(countKey)
    ?? (!query.rarity && !query.country && !query.q ? publicStats?.total : undefined)
  const orderBy =
    query.sort === "rarity"
      ? [desc(RARITY_RANK), sql`${cards.pp} desc nulls last`]
      : query.sort === "name"
        ? [asc(cards.name)]
        : [sql`${cards.pp} desc nulls last`]
  const rowsPromise = db
    .select()
    .from(cards)
    .where(where)
    .orderBy(...orderBy)
    .limit(query.limit)
    .offset(query.offset)
  const totalPromise = cachedTotal == null
    ? db.select({ value: count() }).from(cards).where(where)
    : Promise.resolve([{ value: cachedTotal }])
  const [rows, totalRows] = await Promise.all([rowsPromise, totalPromise])
  const total = Number(totalRows[0]?.value ?? 0)
  if (cachedTotal == null) {
    if (publicCountCache.size >= PUBLIC_CACHE_LIMIT) {
      publicCountCache.delete(publicCountCache.keys().next().value!)
    }
    publicCountCache.set(countKey, total)
  }
  return { rows, total, limit: query.limit, offset: query.offset }
}
export async function cardRoutes(app: FastifyInstance) {
  app.get("/cards", async (request) => {
    const query = z
      .object({
        rarity: z.string().optional(),
        q: z.string().optional(),
        country: z.string().max(8).optional(),
        sort: z.enum(SORTS).default("pp"),
        limit: z.coerce.number().int().min(1).max(200).default(48),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(request.query)

    const key = JSON.stringify(query)
    let data = publicCardsCache.get(key)
    if (!data) {
      const revision = publicCardsRevision
      data = await queryPublicCards(query)
      // 发卡可能在查询期间提交，不能把发卡前的累计数重新写回缓存。
      if (revision === publicCardsRevision) {
        if (publicCardsCache.size >= PUBLIC_CACHE_LIMIT) {
          publicCardsCache.delete(publicCardsCache.keys().next().value!)
        }
        publicCardsCache.set(key, data)
      }
    }
    return { ok: true, data }
  })

  app.get("/cards/stats", async () => {
    if (publicStats) return { ok: true, data: publicStats }
    const rows = await db
      .select({ rarity: cards.rarity, value: count() })
      .from(cards)
      .where(eq(cards.cardType, CARD_TYPES.pool))
      .groupBy(cards.rarity)

    const byRarity: Record<string, number> = {}
    let total = 0
    for (const row of rows) {
      const value = Number(row.value)
      byRarity[row.rarity] = value
      total += value
    }
    publicStats = { total, byRarity }
    return { ok: true, data: publicStats }
  })

  app.get("/cards/countries", async () => {
    const rows = await db
      .select({ code: cards.country, value: count() })
      .from(cards)
      .where(eq(cards.cardType, CARD_TYPES.pool))
      .groupBy(cards.country)

    return {
      ok: true,
      data: rows
        .filter((row): row is { code: string; value: number } => !!row.code)
        .map((row) => ({ code: row.code, total: Number(row.value) }))
        .sort((a, b) => b.total - a.total || a.code.localeCompare(b.code)),
    }
  })

  app.get("/users/:userId/codex/stats", async (request, reply) => {
    const params = z.object({ userId: z.string() }).parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return

    const poolRows = await db
      .select({ rarity: cards.rarity, country: cards.country, total: count() })
      .from(cards)
      .where(eq(cards.cardType, CARD_TYPES.pool))
      .groupBy(cards.rarity, cards.country)

    const ownedRows = await db
      .select({
        rarity: cards.rarity,
        country: cards.country,
        owned: countDistinct(userCards.cardId),
      })
      .from(userCards)
      .innerJoin(cards, eq(cards.id, userCards.cardId))
      .where(eq(userCards.userId, userId))
      .groupBy(cards.rarity, cards.country)

    const byRarity: Record<string, { total: number; owned: number }> = {}
    const countries = new Map<string, { code: string; total: number; owned: number }>()
    let total = 0

    for (const row of poolRows) {
      const rowTotal = Number(row.total)
      total += rowTotal
      const rarity = (byRarity[row.rarity] ??= { total: 0, owned: 0 })
      rarity.total += rowTotal
      if (row.country) {
        const country = countries.get(row.country) ?? { code: row.country, total: 0, owned: 0 }
        country.total += rowTotal
        countries.set(row.country, country)
      }
    }

    let owned = 0
    for (const row of ownedRows) {
      const rowOwned = Number(row.owned)
      owned += rowOwned
      const rarity = (byRarity[row.rarity] ??= { total: 0, owned: 0 })
      rarity.owned += rowOwned
      if (row.country) {
        const country = countries.get(row.country) ?? { code: row.country, total: 0, owned: 0 }
        country.owned += rowOwned
        countries.set(row.country, country)
      }
    }

    return {
      ok: true,
      data: {
        total,
        owned,
        byRarity,
        countries: [...countries.values()].sort(
          (a, b) => b.total - a.total || a.code.localeCompare(b.code),
        ),
      },
    }
  })

  app.get("/users/:userId/codex", async (request, reply) => {
    const params = z.object({ userId: z.string() }).parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return

    const query = z
      .object({
        rarity: z.string().optional(),
        q: z.string().optional(),
        country: z.string().max(8).optional(),
        owned: z.enum(["all", "owned", "unseen"]).default("all"),
        sort: z.enum(SORTS).default("rarity"),
        limit: z.coerce.number().int().min(1).max(200).default(24),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(request.query)

    const ownedCards = db
      .selectDistinct({ cardId: userCards.cardId })
      .from(userCards)
      .where(eq(userCards.userId, userId))
      .as("owned_cards")

    const baseFilters = [eq(cards.cardType, CARD_TYPES.pool)]
    if (query.rarity) baseFilters.push(eq(cards.rarity, query.rarity))
    if (query.country) baseFilters.push(eq(cards.country, query.country))
    if (query.q) baseFilters.push(ilike(cards.name, `%${query.q}%`))

    const filters = [...baseFilters]
    if (query.owned === "owned") filters.push(isNotNull(ownedCards.cardId))
    if (query.owned === "unseen") filters.push(isNull(ownedCards.cardId))
    const where = and(...filters)

    const orderBy =
      query.sort === "rarity"
        ? [desc(RARITY_RANK), sql`${cards.pp} desc nulls last`]
        : query.sort === "name"
          ? [asc(cards.name)]
          : [sql`${cards.pp} desc nulls last`]

    const rows = await db
      .select({
        ...getTableColumns(cards),
        owned: sql<boolean>`(${ownedCards.cardId} is not null)`,
      })
      .from(cards)
      .leftJoin(ownedCards, eq(ownedCards.cardId, cards.id))
      .where(where)
      .orderBy(...orderBy)
      .limit(query.limit)
      .offset(query.offset)

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(cards)
      .leftJoin(ownedCards, eq(ownedCards.cardId, cards.id))
      .where(where)

    const [{ value: ownedTotal }] = await db
      .select({ value: count() })
      .from(cards)
      .leftJoin(ownedCards, eq(ownedCards.cardId, cards.id))
      .where(and(...baseFilters, isNotNull(ownedCards.cardId)))

    return {
      ok: true,
      data: {
        rows,
        total: Number(total),
        ownedTotal: Number(ownedTotal),
        limit: query.limit,
        offset: query.offset,
      },
    }
  })

  app.get("/cards/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const [row] = await db.select().from(cards).where(eq(cards.id, id)).limit(1)
    if (!row) {
      return reply.code(404).send({ ok: false, error: { code: "not_found", message: "鍗′笉瀛樺湪" } })
    }
    return { ok: true, data: row }
  })

  app.get("/users/:userId/cards", async (request, reply) => {
    const params = z.object({ userId: z.string() }).parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return

    const query = z
      .object({
        rarity: z.string().optional(),
        q: z.string().optional(),
        sort: z.enum(SORTS).default("recent"),
        limit: z.coerce.number().int().min(1).max(60).default(24),
        offset: z.coerce.number().int().min(0).default(0),
        ids: z.string().optional(),
      })
      .parse(request.query)

    const filters = [eq(userCards.userId, userId)]
    if (query.rarity) filters.push(eq(cards.rarity, query.rarity))
    if (query.q) filters.push(ilike(cards.name, `%${query.q}%`))
    // 按实例 id 刷新桌面卡面快照；所有筛选仍限制在当前用户名下。
    if (query.ids) {
      const ids = query.ids.split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0)
      filters.push(inArray(userCards.id, ids.length ? ids : [0]))
    }
    const where = and(...filters)

    const orderBy =
      query.sort === "rarity"
        ? [desc(RARITY_RANK), sql`${cards.pp} desc nulls last`]
        : query.sort === "pp"
          ? [sql`${cards.pp} desc nulls last`]
          : query.sort === "name"
            ? [asc(cards.name)]
            : [desc(userCards.obtainedAt)]

    const rows = await db
      .select({
        ...getTableColumns(cards),
        userCardId: userCards.id,
        level: userCards.level,
        constellation: userCards.constellation,
        exp: userCards.exp,
        serial: userCards.serial,
        foil: userCards.foil,
        obtainedAt: userCards.obtainedAt,
      })
      .from(userCards)
      .innerJoin(cards, eq(cards.id, userCards.cardId))
      .where(where)
      .orderBy(...orderBy)
      .limit(query.limit)
      .offset(query.offset)

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(userCards)
      .innerJoin(cards, eq(cards.id, userCards.cardId))
      .where(where)

    return {
      ok: true,
      data: { rows, total: Number(total), limit: query.limit, offset: query.offset },
    }
  })
}
