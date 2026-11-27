import { CONTENT } from "./content"
import type { Rarity } from "./types"

/** 数值在 content/progression.json 的 card 段；这里只放公式 */
const CARD = CONTENT.progression.card

export const LEVEL_CAP = CARD.levelCap
export const CONSTELLATION_CAP = CARD.constellationCap

/** lv1 → 满级累计经验 */
export const LEVEL_EXP_TOTAL: Record<Rarity, number> = CARD.levelExpTotal

/** 升过级的卡被 NPC 回收时，已投入经验按这个比例折算 */
export const EXP_REFUND_RATE = CARD.refundRate

export function isHeroCardId(id: string): boolean {
  return id.startsWith("hero-")
}

export function levelCap(isHero: boolean): number {
  return isHero ? LEVEL_CAP.hero : LEVEL_CAP.normal
}

export function constellationCap(isHero: boolean): number {
  return isHero ? CONSTELLATION_CAP.hero : CONSTELLATION_CAP.normal
}

/** 1 → 该级累计经验的比例：按 levelCurve 的点分段线性插值 */
function expFraction(level: number, isHero: boolean): number {
  const curve = isHero ? CARD.levelCurve.hero : CARD.levelCurve.normal
  for (let i = 1; i < curve.length; i += 1) {
    const [l1, f1] = curve[i]!
    if (level <= l1) {
      const [l0, f0] = curve[i - 1]!
      return f0 + (f1 - f0) * ((level - l0) / (l1 - l0))
    }
  }
  return 1
}

export function totalExpAtLevel(level: number, rarity: Rarity, isHero: boolean): number {
  const cap = levelCap(isHero)
  const clamped = Math.min(Math.max(level, 1), cap)
  return Math.round(LEVEL_EXP_TOTAL[rarity] * expFraction(clamped, isHero))
}

/** 升到下一级需要的经验；满级为 0 */
export function expToNext(level: number, rarity: Rarity, isHero: boolean): number {
  if (level >= levelCap(isHero)) return 0
  return Math.max(1, totalExpAtLevel(level + 1, rarity, isHero) - totalExpAtLevel(level, rarity, isHero))
}

/** 这张卡身上已经投入的经验（含当前等级内的余量） */
export function investedExp(level: number, exp: number, rarity: Rarity, isHero: boolean): number {
  return totalExpAtLevel(level, rarity, isHero) + exp
}

export function refundExpOf(level: number, exp: number, rarity: Rarity, isHero: boolean): number {
  return Math.floor(investedExp(level, exp, rarity, isHero) * EXP_REFUND_RATE)
}

/**
 * 把经验加到卡上并自动升级。满级后多出来的经验作废，记在 wasted 里给前端提示。
 */
export function applyExp(
  level: number,
  exp: number,
  gained: number,
  rarity: Rarity,
  isHero: boolean,
): { level: number; exp: number; wasted: number } {
  const cap = levelCap(isHero)
  let nextLevel = level
  let nextExp = exp + gained
  while (nextLevel < cap) {
    const need = expToNext(nextLevel, rarity, isHero)
    if (nextExp < need) break
    nextExp -= need
    nextLevel += 1
  }
  if (nextLevel >= cap) return { level: cap, exp: 0, wasted: nextExp }
  return { level: nextLevel, exp: nextExp, wasted: 0 }
}

function toNumericMap(raw: Readonly<Record<string, number>>): Readonly<Record<number, number>> {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [Number(k), v]))
}

/** 40+ 突破金币消耗（数值在 content/progression.json 的 card.breakthroughCoins） */
export const BREAKTHROUGH_COIN_COST: Readonly<Record<number, number>> = toNumericMap(CARD.breakthroughCoins)

export function breakthroughCoinCost(level: number, isHero: boolean): number {
  if (isHero) return 0
  return BREAKTHROUGH_COIN_COST[level] ?? 0
}

/** 技能重洗「逢 N 自选」周期（数值在 content/progression.json 的 card.skillReroll） */
export const SKILL_REROLL_PITY_INTERVAL = CARD.skillReroll.pityInterval

export function skillRerollCost(rarity: Rarity): { shards: number; coins: number } {
  return {
    shards: CARD.skillReroll.shards[rarity],
    coins: CARD.skillReroll.coins[rarity],
  }
}

/** 单卡重洗计数是否已到自选档（例如逢 5：count === 4 时下一次洗为自选） */
export function isSkillRerollSelectReady(count: number): boolean {
  return count >= SKILL_REROLL_PITY_INTERVAL - 1
}

/**
 * 连续升级（含 40+ 突破金币消耗）：
 * 若经验够升到突破下一级但金币不足，则停在当前突破级，剩余经验保留在 exp 中。
 */
export function applyExpWithBreakthrough(
  level: number,
  exp: number,
  gained: number,
  rarity: Rarity,
  isHero: boolean,
  availableCoins: number,
): {
  level: number
  exp: number
  wasted: number
  coinsSpent: number
  blockedCost: number
} {
  const cap = levelCap(isHero)
  let nextLevel = level
  let nextExp = exp + gained
  let coinsLeft = Math.max(0, availableCoins)
  let coinsSpent = 0
  let blockedCost = 0

  while (nextLevel < cap) {
    const need = expToNext(nextLevel, rarity, isHero)
    if (nextExp < need) break
    const coinCost = breakthroughCoinCost(nextLevel, isHero)
    if (coinCost > coinsLeft) {
      blockedCost = coinCost
      break
    }
    nextExp -= need
    coinsLeft -= coinCost
    coinsSpent += coinCost
    nextLevel += 1
  }

  if (nextLevel >= cap) {
    return { level: cap, exp: 0, wasted: nextExp, coinsSpent, blockedCost: 0 }
  }
  return { level: nextLevel, exp: nextExp, wasted: 0, coinsSpent, blockedCost }
}
