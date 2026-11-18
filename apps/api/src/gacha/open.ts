import { and, eq, sql } from "drizzle-orm"

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
  /** 实例序号 / 发出这一张时的累计发行数 */
  serial: number
  pulled: number
  /** 个体值，千分比 970–1030 */
  rollBp: number
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** 所有新实例都从这里领号；只接受事务，计数和实例写入必须一起提交或回滚。 */
export async function grantCard(
  tx: Transaction,
  values: { userId: string; cardId: string; foil?: boolean },
): Promise<{ userCardId: number; serial: number; rollBp: number }> {
  const [counted] = await tx
    .update(cards)
    .set({ pulled: sql`${cards.pulled} + 1` })
    .where(eq(cards.id, values.cardId))
    .returning({ pulled: cards.pulled })
  if (!counted) throw new Error(`卡不存在：${values.cardId}`)
  // 个体值：970–1030（±3%），抽到时掷一次
  const rollBp = 970 + Math.floor(Math.random() * 61)
  const [inserted] = await tx
    .insert(userCards)
    .values({ ...values, serial: counted.pulled, rollBp })
    .returning({ id: userCards.id })
  if (!inserted) throw new Error("卡实例写入失败")
  return { userCardId: inserted.id, serial: counted.pulled, rollBp }
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

      const { userCardId, serial, rollBp } = await grantCard(tx, { userId, cardId, foil })
      results.push({ cardId, rarity, fromPity, userCardId, foil, serial, pulled: serial, rollBp })
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
      const granted = await grantCard(tx, {
        userId,
        cardId: mirrorCandidate.id,
        foil: false,
      })
      bonus = {
        cardId: mirrorCandidate.id,
        rarity: mirrorCandidate.rarity,
        fromPity: false,
        userCardId: granted.userCardId,
        foil: false,
        serial: granted.serial,
        pulled: granted.serial,
        rollBp: granted.rollBp,
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
