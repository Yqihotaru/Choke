import type { Rarity } from "./types"

export const LEVEL_CAP = { normal: 80, hero: 12 } as const
export const CONSTELLATION_CAP = { normal: 6, hero: 12 } as const

/**
 * 喂养：一张卡直接喂给别的卡时提供的经验（经济与养成 v0.3 §5.3，×10）。
 * 分解成碎片再喂只有它的 80%，见 economy.ts SHARD_EXP。
 */
export const FEED_EXP: Record<Rarity, number> = {
  C: 50,
  UC: 100,
  R: 240,
  E: 600,
  L: 1440,
  Radiant: 3600,
  Prismatic: 9600,
}

/** lv1 → 满级累计经验（经济与养成 v0.3 §6.1，×10） */
export const LEVEL_EXP_TOTAL: Record<Rarity, number> = {
  C: 20000,
  UC: 30000,
  R: 40000,
  E: 220000,
  L: 340000,
  Radiant: 420000,
  Prismatic: 550000,
}

/** 升过级的卡被喂掉或分解时，已投入经验按这个比例返还 */
export const EXP_REFUND_RATE = 0.75

export function isHeroCardId(id: string): boolean {
  return id.startsWith("hero-")
}

export function levelCap(isHero: boolean): number {
  return isHero ? LEVEL_CAP.hero : LEVEL_CAP.normal
}

export function constellationCap(isHero: boolean): number {
  return isHero ? CONSTELLATION_CAP.hero : CONSTELLATION_CAP.normal
}

/**
 * 1 → 该级累计经验的比例。
 * 普通卡按 v0.3 §6.1 的 25% / 35% / 40% 三段分布；本体卡 1–12 线性。
 */
function expFraction(level: number, isHero: boolean): number {
  if (isHero) return (level - 1) / 11
  if (level <= 40) return 0.25 * ((level - 1) / 39)
  if (level <= 60) return 0.25 + 0.35 * ((level - 40) / 20)
  return 0.6 + 0.4 * ((level - 60) / 20)
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

/** 一张卡被喂掉时给的经验 = 基础喂养值 + 已投入经验 × 返还比例 */
export function feedExpOf(card: { rarity: Rarity; level: number; exp: number; isHero?: boolean }): number {
  return FEED_EXP[card.rarity] + refundExpOf(card.level, card.exp, card.rarity, !!card.isHero)
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
