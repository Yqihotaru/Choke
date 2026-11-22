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

/** 精华镀闪：给已有卡加闪卡外观。精华只能用于闪卡。 */
export const FOIL_COST = 50

/** 市场单卡价格上限（金币） */
export const MARKET_MAX_PRICE = 100000
