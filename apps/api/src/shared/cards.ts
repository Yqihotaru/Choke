/**
 * 前后端共用的卡牌规则出口。
 * 实现位于 packages/shared，API 只从这里拿，不再反向依赖前端目录。
 */
export {
  constellationCap,
  expToNext,
  isHeroCardId,
  levelCap,
  meltExpOf,
} from "@choke/shared/progression"
export { FOIL_COST, MARKET_MAX_PRICE, essenceOf } from "@choke/shared/economy"
export type { Rarity } from "@choke/shared/types"
