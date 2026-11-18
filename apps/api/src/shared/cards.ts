/**
 * 前后端共用的卡牌规则出口。
 *
 * 实现暂时还在仓库根的 src/card/；API 只从这里拿，等以后物理搬到
 * packages/shared 时只改这几个门面文件，路由不用动。
 */
export {
  constellationCap,
  expToNext,
  isHeroCardId,
  levelCap,
  meltExpOf,
} from "../../../../src/card/progression"
export { FOIL_COST, MARKET_MAX_PRICE, essenceOf } from "../../../../src/card/economy"
export type { Rarity } from "../../../../src/card/types"
