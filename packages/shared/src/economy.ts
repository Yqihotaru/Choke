import type { Rarity } from "./types"

/** 闪卡分解/熔掉时得到的精华（已含闪卡 ×3）。非闪卡不产精华。 */
export const ESSENCE_OF: Record<Rarity, number> = {
  C: 1,
  UC: 2,
  R: 4,
  E: 8,
  L: 16,
  Radiant: 32,
  Prismatic: 64,
}

export function essenceOf(rarity: Rarity, foil = false): number {
  return foil ? ESSENCE_OF[rarity] * 3 : 0
}

/** 分解值：分解一张卡得到的碎片（经济与养成系统 v0.2 §6.1）。熔卡经验 = 分解值 × 1.2。 */
export const SHARD_OF: Record<Rarity, number> = {
  C: 4,
  UC: 8,
  R: 20,
  E: 50,
  L: 120,
  Radiant: 300,
  Prismatic: 800,
}

export function shardOf(rarity: Rarity): number {
  return SHARD_OF[rarity]
}

/** 1 碎片 = 1 经验（v0.2 §6.3），可以喂任何卡，经验不能换回碎片。 */
export const SHARD_EXP_RATE = 1

/** 精华镀闪：给已有卡加闪卡外观。精华只能用于闪卡。 */
export const FOIL_COST = 50

/** 市场单卡价格上限（金币） */
export const MARKET_MAX_PRICE = 100000
