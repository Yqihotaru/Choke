import { CONTENT } from "./content"
import { RARITIES, type Rarity } from "./types"

/**
 * 远征点数：出征前把点数花在卡槽、AP 上限和稀有度权限上，结果写进出征快照，途中不能改。
 * 数值在 content/progression.json 的 expedition 段；这里只放规则。
 */
const RULES = CONTENT.progression.expedition

/** 付费解锁的稀有度，按解锁顺序；排在它们前面的稀有度免费 */
export const GATED_RARITIES = ["L", "Mythic", "Prismatic"] as const satisfies readonly Rarity[]
type GatedRarity = (typeof GATED_RARITIES)[number]

/** 不花点数时能带的最高稀有度 */
export const FREE_MAX_RARITY: Rarity = "E"

export const BASE_SLOTS = RULES.baseSlots
export const MAX_SLOTS = RULES.baseSlots + RULES.slotCosts.length
export const BASE_AP_MAX = RULES.ap.base
export const UPGRADED_AP_MAX = RULES.ap.upgraded

export interface ExpeditionAllocation {
  /** 上场卡槽数，BASE_SLOTS 到 MAX_SLOTS */
  slots: number
  /** 是否把 AP 上限升到 UPGRADED_AP_MAX */
  apUpgrade: boolean
  /**
   * 能带的最高稀有度。解锁是一条链（L → Mythic → Prismatic），
   * 所以只存"点到哪一档"，不可能出现没点 L 就点了 Mythic 的状态。
   */
  maxRarity: Rarity
}

/** 不花任何点数的分配：本机练习和教学战用 */
export const FREE_ALLOCATION: Readonly<ExpeditionAllocation> = {
  slots: BASE_SLOTS,
  apUpgrade: false,
  maxRarity: FREE_MAX_RARITY,
}

/** 到这个玩家等级为止累计拿到的点数 */
export function totalPoints(level: number): number {
  return RULES.pointsByLevel.reduce((sum, [from, points]) => (level >= from ? sum + points : sum), 0)
}

function rarityCost(maxRarity: Rarity): number {
  const reach = GATED_RARITIES.indexOf(maxRarity as GatedRarity)
  if (reach < 0) return 0
  return GATED_RARITIES.slice(0, reach + 1).reduce((sum, rarity) => sum + RULES.rarityCosts[rarity], 0)
}

function slotsCost(slots: number): number {
  return RULES.slotCosts.slice(0, Math.max(0, slots - RULES.baseSlots)).reduce((sum, cost) => sum + cost, 0)
}

/** 这份分配一共要花多少点 */
export function allocationCost(allocation: ExpeditionAllocation): number {
  return slotsCost(allocation.slots) + (allocation.apUpgrade ? RULES.ap.cost : 0) + rarityCost(allocation.maxRarity)
}

/** 全部点满要花的点数 */
export const FULL_ALLOCATION_COST = allocationCost({
  slots: MAX_SLOTS,
  apUpgrade: true,
  maxRarity: GATED_RARITIES[GATED_RARITIES.length - 1]!,
})

export function apMaxOf(allocation: ExpeditionAllocation): number {
  return allocation.apUpgrade ? RULES.ap.upgraded : RULES.ap.base
}

/** 能不能带这张卡；本体卡不受稀有度限制，也不花点数 */
export function cardAllowed(allocation: ExpeditionAllocation, card: { rarity: Rarity; isHero?: boolean }): boolean {
  if (card.isHero) return true
  return RARITIES.indexOf(card.rarity) <= RARITIES.indexOf(allocation.maxRarity)
}

/** 校验服务端收到的分配（来路不明的输入）；合法返回 null，否则返回原因 */
export function allocationError(input: unknown, level: number): string | null {
  if (typeof input !== "object" || input === null) return "分配格式不对"
  const { slots, apUpgrade, maxRarity } = input as Partial<ExpeditionAllocation>
  if (!Number.isInteger(slots) || slots! < BASE_SLOTS || slots! > MAX_SLOTS) {
    return `卡槽数必须是 ${BASE_SLOTS} 到 ${MAX_SLOTS}`
  }
  if (typeof apUpgrade !== "boolean") return "AP 升级必须是 true 或 false"
  if (typeof maxRarity !== "string" || !RARITIES.includes(maxRarity as Rarity)) return "稀有度权限不合法"
  const reach = RARITIES.indexOf(maxRarity as Rarity)
  if (reach < RARITIES.indexOf(FREE_MAX_RARITY)) return `稀有度权限不能低于免费档 ${FREE_MAX_RARITY}`
  const cost = allocationCost({ slots: slots!, apUpgrade, maxRarity: maxRarity as Rarity })
  const have = totalPoints(level)
  if (cost > have) return `点数不够：需要 ${cost}，当前 ${have}`
  return null
}

/** 卡池（或场上阵容）里有没有没权限的卡；返回第一张违规的下标，全部合法返回 -1 */
export function firstDisallowedCard(
  allocation: ExpeditionAllocation,
  cards: readonly { rarity: Rarity; isHero?: boolean }[],
): number {
  return cards.findIndex((card) => !cardAllowed(allocation, card))
}
