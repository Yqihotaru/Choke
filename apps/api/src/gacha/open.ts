import { and, eq, sql } from "drizzle-orm"

import { rollSkillRefs } from "@choke/shared/skills"
import type { CardSkillRef, Job, Rarity } from "@choke/shared/types"

import { CARD_TYPES, isHeroId } from "../card-types"
import { db } from "../db/client"
import { cards, packOpenings, packTokens, userCards, userPacks } from "../db/schema"
import { MIRROR_RATE, pickMirrorCard } from "../mirror"
import { recordLedger } from "../ledger"
import { recordQuestEvent } from "../quest-events"
import { PACK_SIZE, PACKS, STARTER_GUARANTEE } from "./packs"
import { RARITY_ORDER, mulberry32, rollRarity, type PoolId } from "./pools"

const rankOf = (rarity: string) => RARITY_ORDER.indexOf(rarity as (typeof RARITY_ORDER)[number])

/**
 * 新手包兜底是否要在这一包生效：调用时这包已经扣过库存，
 * 背包和桌面上都没有剩余新手包 = 这是最后一包；且之前的新手包里没出过 L 及以上。
 */
async function starterGuaranteeDue(userId: string): Promise<boolean> {
  const pool = STARTER_GUARANTEE.pool
  const [left] = await db
    .select({ count: userPacks.count })
    .from(userPacks)
    .where(and(eq(userPacks.userId, userId), eq(userPacks.pool, pool)))
  if ((left?.count ?? 0) > 0) return false
  const onDesk = await db
    .select({ id: packTokens.id })
    .from(packTokens)
    .where(and(eq(packTokens.userId, userId), eq(packTokens.pool, pool)))
    .limit(1)
  if (onDesk.length > 0) return false
  const opened = await db
    .select({ results: packOpenings.results })
    .from(packOpenings)
    .where(and(eq(packOpenings.userId, userId), eq(packOpenings.pool, pool)))
  const floor = rankOf(STARTER_GUARANTEE.rarity)
  return !opened.some((row) =>
    (row.results as { rarity: string }[]).some((card) => rankOf(card.rarity) >= floor),
  )
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
  /** 新手包兜底改出的那一张 */
  guaranteed?: boolean
  /** user_cards 实例 id，用于把这张卡直接拖进卡组 */
  userCardId: number
  /** 闪卡实例属性 */
  foil: boolean
  /** 实例序号 / 发出这一张时的累计发行数 */
  serial: number
  pulled: number
  /** 个体值，千分比 970–1030 */
  rollBp: number
  /** 这一张自己掷出的技能 id */
  skillRefs: CardSkillRef[]
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** 所有新实例都从这里领号；只接受事务，计数和实例写入必须一起提交或回滚。 */
export async function grantCard(
  tx: Transaction,
  values: { userId: string; cardId: string; foil?: boolean },
): Promise<{ userCardId: number; serial: number; rollBp: number; skillRefs: CardSkillRef[] }> {
  const [counted] = await tx
    .update(cards)
    .set({ pulled: sql`${cards.pulled} + 1` })
    .where(eq(cards.id, values.cardId))
    .returning({ pulled: cards.pulled, job: cards.job, rarity: cards.rarity })
  if (!counted) throw new Error(`卡不存在：${values.cardId}`)
  // 个体值：970–1030（±3%），抽到时掷一次
  const rollBp = 970 + Math.floor(Math.random() * 61)
  // 技能同样每张卡各掷各的，同名卡互不相同；掷出来就固定在这个实例上
  // 本体卡的技能池按 Prismatic 算（拿不到下位技能）；槽数规则等本体卡返工时再定
  const skillRarity = isHeroId(values.cardId) ? "Prismatic" : (counted.rarity as Rarity)
  const skillRefs = rollSkillRefs(counted.job as Job, skillRarity, Math.random)
  const [inserted] = await tx
    .insert(userCards)
    .values({ ...values, serial: counted.pulled, rollBp, skillRefs })
    .returning({ id: userCards.id })
  if (!inserted) throw new Error("卡实例写入失败")
  return { userCardId: inserted.id, serial: counted.pulled, rollBp, skillRefs }
}

/** 发本体卡并写流水；领取神秘卡包换来的那次，把扣掉的卡包也记进去 */
export async function grantHeroCard(userId: string, cardId: string, spentPack?: string) {
  return db.transaction(async (tx) => {
    const granted = await grantCard(tx, { userId, cardId })
    await recordLedger(
      tx,
      userId,
      [
        ...(spentPack ? [{ kind: "pack" as const, ref: spentPack, delta: -1 }] : []),
        { kind: "card", ref: cardId, delta: 1, userCardId: granted.userCardId },
      ],
      { source: "hero-claim" },
    )
    return granted
  })
}

export async function openPack(userId: string, pool: PoolId, count = PACK_SIZE) {
  const seed = Math.floor(Math.random() * 2 ** 32)
  const random = mulberry32(seed)
  // 镜像卡用独立随机流，避免改变主卡包序列。
  const mirrorRandom = mulberry32((seed ^ 0x9e3779b9) >>> 0)

  // 先把各档 id 取到内存，事务里只做写入，避免长事务里反复扫 cards
  const pools = new Map<string, string[]>()
  for (const rarity of ["C", "UC", "R", "E", "L", "Mythic", "Prismatic"]) {
    pools.set(rarity, await idsFor(rarity))
  }

  // 额外第 6 张：挂机包不触发，也不占配额、不动保底。
  const mirrorCandidate =
    pool !== "idle" && mirrorRandom() < MIRROR_RATE
      ? await pickMirrorCard(pool, mirrorRandom)
      : null

  const guarantee = pool === STARTER_GUARANTEE.pool && (await starterGuaranteeDue(userId))
  const floor = rankOf(STARTER_GUARANTEE.rarity)

  return db.transaction(async (tx) => {
    const results: DrawnCard[] = []

    for (let i = 0; i < count; i += 1) {
      let rarity = rollRarity(pool, random)
      let guaranteed = false
      if (
        guarantee &&
        i === count - 1 &&
        rankOf(rarity) < floor &&
        !results.some((card) => rankOf(card.rarity) >= floor)
      ) {
        rarity = STARTER_GUARANTEE.rarity
        guaranteed = true
      }

      const ids = pools.get(rarity) ?? []
      if (ids.length === 0) {
        throw new Error(`卡池里没有 ${rarity} 档的卡，先导入卡定义`)
      }
      const cardId = ids[Math.floor(random() * ids.length)]!
      const foil = random() < PACKS[pool].foilRate

      const { userCardId, serial, rollBp, skillRefs } = await grantCard(tx, { userId, cardId, foil })
      results.push({
        cardId,
        rarity,
        userCardId,
        foil,
        serial,
        pulled: serial,
        rollBp,
        skillRefs,
        ...(guaranteed ? { guaranteed } : {}),
      })
    }

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
        userCardId: granted.userCardId,
        foil: false,
        serial: granted.serial,
        pulled: granted.serial,
        rollBp: granted.rollBp,
        skillRefs: granted.skillRefs,
      }
    }

    await tx.insert(packOpenings).values({
      userId,
      pool,
      count,
      seed: String(seed),
      results,
      pityBefore: 0,
      pityAfter: 0,
    })
    await recordLedger(
      tx,
      userId,
      [
        { kind: "pack", ref: pool, delta: -1 },
        ...[...results, ...(bonus ? [bonus] : [])].map((card) => ({
          kind: "card" as const,
          ref: card.cardId,
          delta: 1,
          userCardId: card.userCardId,
        })),
      ],
      { source: "pack-open", sourceRef: pool },
    )
    await recordQuestEvent(tx, userId, "pack-open")

    return {
      seed,
      results,
      bonus,
    }
  })
}

export function invalidateCardCache() {
  idCache.clear()
}
