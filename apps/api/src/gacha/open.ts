import { and, eq } from "drizzle-orm"

import { CARD_TYPES } from "../card-types"
import { db } from "../db/client"
import { cards, packOpenings, pity, userCards } from "../db/schema"
import { MIRROR_RATE, pickMirrorCard } from "../mirror"
import { PITY, PACK_SIZE, PACKS } from "./packs"
import { mulberry32, rollRarity, type PoolId } from "./pools"

const RANK: Record<string, number> = {
  C: 0,
  UC: 1,
  R: 2,
  E: 3,
  L: 4,
  Radiant: 5,
  Prismatic: 6,
}

const idCache = new Map<string, string[]>()
async function idsFor(rarity: string): Promise<string[]> {
  const cached = idCache.get(rarity)
  if (cached) return cached
  // 本体卡 hero-* 与镜像卡 mirror-* 都是账号专属定义，不属于公共卡池
  const rows = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.rarity, rarity), eq(cards.cardType, CARD_TYPES.pool)))
  const ids = rows.map((row) => row.id)
  idCache.set(rarity, ids)
  return ids
}

export interface DrawnCard {
  cardId: string
  rarity: string
  fromPity: boolean
  /** user_cards 实例 id，用于把这张卡直接拖进卡组 */
  userCardId: number
  /** 闪卡实例属性 */
  foil: boolean
}

export async function openPack(userId: string, pool: PoolId, count = PACK_SIZE) {
  const seed = Math.floor(Math.random() * 2 ** 32)
  const random = mulberry32(seed)
  // 镜像卡用独立随机流，避免改变主卡包序列。
  const mirrorRandom = mulberry32((seed ^ 0x9e3779b9) >>> 0)

  // PGlite 是单连接：事务内再查 cards 会死锁，先把各档 id 取到内存
  const pools = new Map<string, string[]>()
  for (const rarity of ["C", "UC", "R", "E", "L", "Radiant", "Prismatic"]) {
    pools.set(rarity, await idsFor(rarity))
  }

  // 额外第 6 张：挂机包不触发，也不占配额、不动保底。
  const mirrorCandidate =
    pool !== "idle" && mirrorRandom() < MIRROR_RATE
      ? await pickMirrorCard(pool, mirrorRandom)
      : null

  return db.transaction(async (tx) => {
    const current = await tx
      .select()
      .from(pity)
      .where(and(eq(pity.userId, userId), eq(pity.pool, pool)))
    let counter = current[0]?.counter ?? 0
    const before = counter

    const results: DrawnCard[] = []

    for (let i = 0; i < count; i += 1) {
      counter += 1
      let rarity = rollRarity(pool, random)
      let fromPity = false

      if (RANK[rarity] < RANK[PITY.rarity] && counter >= PITY.threshold) {
        rarity = PITY.rarity
        fromPity = true
      }

      if (RANK[rarity] >= RANK[PITY.rarity]) counter = 0

      const ids = pools.get(rarity) ?? []
      if (ids.length === 0) {
        throw new Error(`卡池里没有 ${rarity} 档的卡，先导入卡定义`)
      }
      const cardId = ids[Math.floor(random() * ids.length)]!
      const foil = random() < PACKS[pool].foilRate

      const [inserted] = await tx
        .insert(userCards)
        .values({ userId, cardId, foil })
        .returning({ id: userCards.id })
      results.push({ cardId, rarity, fromPity, userCardId: inserted!.id, foil })
    }

    await tx
      .insert(pity)
      .values({ userId, pool, counter })
      .onConflictDoUpdate({
        target: [pity.userId, pity.pool],
        set: { counter },
      })

    // 镜像卡作为 bonus 单独返回，前端演完 5 张后再弹第 6 张。
    let bonus: DrawnCard | null = null
    if (mirrorCandidate) {
      const [inserted] = await tx
        .insert(userCards)
        .values({ userId, cardId: mirrorCandidate.id, foil: false })
        .returning({ id: userCards.id })
      bonus = {
        cardId: mirrorCandidate.id,
        rarity: mirrorCandidate.rarity,
        fromPity: false,
        userCardId: inserted!.id,
        foil: false,
      }
    }

    await tx.insert(packOpenings).values({
      userId,
      pool,
      count,
      seed: String(seed),
      results,
      pityBefore: before,
      pityAfter: counter,
    })

    return {
      seed,
      results,
      bonus,
      pity: { before, after: counter },
    }
  })
}

export function invalidateCardCache() {
  idCache.clear()
}
