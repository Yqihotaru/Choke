import { CONTENT } from "./content"
import type { Rarity } from "./types"

/** 数值在 content/economy.json */
const ECONOMY = CONTENT.economy

/** 闪卡分解 / 被喂掉时的精华基数。非闪卡不产精华。 */
export const ESSENCE_OF: Record<Rarity, number> = ECONOMY.foilEssence

export function essenceOf(rarity: Rarity, foil = false): number {
  return foil ? ESSENCE_OF[rarity] * ECONOMY.foilEssenceMultiplier : 0
}

/** 精华镀闪：给已有卡加闪卡外观。精华只能用于闪卡。 */
export const FOIL_COST = ECONOMY.foilCost

/** 市场单卡价格上限（金币） */
export const MARKET_MAX_PRICE = ECONOMY.marketMaxPrice
