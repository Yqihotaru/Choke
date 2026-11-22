import { and, eq, gte, sql } from "drizzle-orm"

import { CARD_TYPES, MIRROR_PREFIX } from "./card-types"
import { db } from "./db/client"
import { cards, userCards, users } from "./db/schema"
import type { PoolId } from "./gacha/pools"
import type { heroCardDef } from "./hero"

/** 非挂机卡包触发镜像卡“额外第 6 张”的概率。 */
export const MIRROR_RATE = 0.015

/** 进入镜像池的活跃窗口（天）。 */
export const MIRROR_ACTIVE_DAYS = 45

/**
 * 镜像卡稀有度：用卡包档位控制，只取 UC–L。
 * 不直接按全池均匀随机，避免高稀有度本体卡被低价池偷渡。
 */
export const MIRROR_RARITY_WEIGHTS: Record<PoolId, Record<string, number>> = {
  normal: { UC: 40, R: 35, E: 20, L: 5 },
  starter: { UC: 40, R: 35, E: 20, L: 5 },
  golden: { UC: 25, R: 35, E: 30, L: 10 },
  radiant: { UC: 20, R: 30, E: 35, L: 15 },
  sky: { UC: 15, R: 30, E: 35, L: 20 },
  prism: { UC: 15, R: 25, E: 35, L: 25 },
  idle: {},
}

/** 往下兼容的档位顺序：抽中档位池子为空时，逐档降。 */
const MIRROR_FALLBACK_ORDER = ["L", "E", "R", "UC"] as const

export function rollMirrorRarity(pool: PoolId, random: () => number): string {
  const weights = MIRROR_RARITY_WEIGHTS[pool]
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return "UC"
  let pick = random() * total
  for (const [rarity, weight] of Object.entries(weights)) {
    pick -= weight
    if (pick <= 0) return rarity
  }
  return "UC"
}

export interface MirrorCandidate {
  id: string
  rarity: string
}

/**
 * 从活跃镜像池里抽一张。
 * 池子只含 OAuth 登录、完成引导、最近活跃的账号的镜像卡。
 */
export async function pickMirrorCard(
  pool: PoolId,
  random: () => number,
): Promise<MirrorCandidate | null> {
  const wanted = rollMirrorRarity(pool, random)
  const start = MIRROR_FALLBACK_ORDER.indexOf(
    wanted as (typeof MIRROR_FALLBACK_ORDER)[number],
  )
  const cutoff = new Date(Date.now() - MIRROR_ACTIVE_DAYS * 24 * 60 * 60 * 1000)

  for (let i = Math.max(0, start); i < MIRROR_FALLBACK_ORDER.length; i += 1) {
    const rarity = MIRROR_FALLBACK_ORDER[i]!
    const rows = await db
      .select({ id: cards.id, rarity: cards.rarity })
      .from(cards)
      .innerJoin(users, eq(users.osuId, cards.originOsuId))
      .where(
        and(
          eq(cards.cardType, CARD_TYPES.mirror),
          eq(cards.rarity, rarity),
          eq(users.onboarded, true),
          gte(users.lastSeenAt, cutoff),
        ),
      )
    if (rows.length > 0) {
      return rows[Math.floor(random() * rows.length)] ?? null
    }
  }
  return null
}

/**
 * 登录 / 刷新本体卡时同步镜像卡定义。
 * 镜像卡与 hero-<osuId> 物理隔离：没有个人加成，走普通卡成长与哈希技能模板。
 */
export async function upsertMirrorCard(
  osuId: number,
  def: ReturnType<typeof heroCardDef>,
) {
  const { id: _heroId, ...rest } = def
  void _heroId
  const id = `${MIRROR_PREFIX}${osuId}`

  await db
    .insert(cards)
    .values({
      id,
      ...rest,
      cardType: CARD_TYPES.mirror,
      originOsuId: osuId,
      version: 1,
      // 镜像定义被重建时，补回仍存实例的最大发行号。
      pulled: sql<number>`coalesce((
        select max(${userCards.serial}) from ${userCards}
        where ${userCards.cardId} = ${id}
      ), 0)`,
    })
    .onConflictDoUpdate({
      target: cards.id,
      set: {
        ...rest,
        cardType: CARD_TYPES.mirror,
        originOsuId: osuId,
        pulled: sql`greatest(${cards.pulled}, excluded.pulled)`,
      },
    })

  return id
}
