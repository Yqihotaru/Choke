import { deriveStream, nextRandom } from "../rng"
import type { Reward, RewardTable } from "./content"

/**
 * 掉落计算：纯函数，只吃种子。同一个远征种子、同一个名字，永远掷出同样的结果，
 * 所以服务端可以重算，玩家也没法靠重开刷掉落。
 */

export function emptyReward(): Reward {
  return {}
}

export function isRewardEmpty(reward: Reward | undefined | null): boolean {
  if (!reward) return true
  return !(
    reward.coins ||
    reward.essence ||
    reward.stamina ||
    reward.playerExp ||
    reward.items?.length ||
    reward.packs?.length ||
    reward.cards?.length
  )
}

/** 把若干份奖励加在一起；同样的物品、卡包、卡合并数量 */
export function mergeRewards(...parts: (Reward | undefined | null)[]): Reward {
  const total: Reward = {}
  const items = new Map<string, number>()
  const packs = new Map<string, number>()
  const cards = new Map<string, { cardId: string; foil?: boolean; count: number }>()
  for (const part of parts) {
    if (!part) continue
    for (const key of ["coins", "essence", "stamina", "playerExp"] as const) {
      if (part[key]) total[key] = (total[key] ?? 0) + part[key]!
    }
    for (const { itemId, count } of part.items ?? []) items.set(itemId, (items.get(itemId) ?? 0) + count)
    for (const { pool, count } of part.packs ?? []) packs.set(pool, (packs.get(pool) ?? 0) + count)
    for (const { cardId, count, foil } of part.cards ?? []) {
      const key = `${cardId}|${foil ? 1 : 0}`
      const hit = cards.get(key)
      if (hit) hit.count += count
      else cards.set(key, { cardId, count, ...(foil ? { foil: true } : {}) })
    }
  }
  if (items.size > 0) total.items = [...items].map(([itemId, count]) => ({ itemId, count })) as Reward["items"]
  if (packs.size > 0) total.packs = [...packs].map(([pool, count]) => ({ pool, count }))
  if (cards.size > 0) total.cards = [...cards.values()]
  return total
}

/** 按权重抽一项，返回下标 */
function pickWeighted(weights: readonly number[], roll: number): number {
  const sum = weights.reduce((a, b) => a + b, 0)
  let at = roll * sum
  for (let i = 0; i < weights.length; i += 1) {
    at -= weights[i]!
    if (at < 0) return i
  }
  return weights.length - 1
}

export interface RollOptions {
  /** 远征种子 */
  seed: string
  /** 随机流名字，如 `loot-n2`、`treasure-n4`；同名同种子掷出同样的结果 */
  stream: string
  /** 这次拿到的星数（战斗节点）；宝箱和没有星级的写 0 */
  stars?: number
  /** 是否首通；只有地图级掉落表才会传 true */
  firstClear?: boolean
}

/**
 * 发放顺序：固定 → 随机 → 星级加成（累加：3 星同时拿 1、2、3 档）→ 首通奖励。
 */
export function rollRewardTable(table: RewardTable, options: RollOptions): Reward {
  let stream = deriveStream(options.seed, options.stream)
  const parts: (Reward | undefined)[] = [table.fixed]

  if (table.random) {
    const weights = table.random.entries.map((entry) => entry.weight)
    for (let i = 0; i < table.random.rolls; i += 1) {
      const [next, roll] = nextRandom(stream)
      stream = next
      parts.push(table.random.entries[pickWeighted(weights, roll)]!.reward)
    }
  }

  const stars = options.stars ?? 0
  for (const tier of ["1", "2", "3"] as const) {
    if (stars >= Number(tier)) parts.push(table.starBonus?.[tier])
  }
  if (options.firstClear) parts.push(table.firstClear)
  return mergeRewards(...parts)
}

/** 整张图的星级档位：拿到的星数占满星的比例，三等分 */
export function mapStarTier(stars: number, maxStars: number): 0 | 1 | 2 | 3 {
  if (maxStars <= 0) return 0
  return Math.min(3, Math.floor((stars / maxStars) * 3)) as 0 | 1 | 2 | 3
}
