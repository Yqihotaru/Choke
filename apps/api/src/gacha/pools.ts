import { PACKS, type PackId } from "./packs"

export type PoolId = PackId

export const RARITY_ORDER = ["C", "UC", "R", "E", "L", "Mythic", "Prismatic"] as const

/** 按 packs.ts 里的权重抽一档稀有度。 */
export function rollRarity(pool: PoolId, random: () => number): string {
  const weights: Record<string, number> = PACKS[pool].weights
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0)
  let pick = random() * total
  for (const rarity of RARITY_ORDER) {
    const weight = weights[rarity] ?? 0
    if (weight <= 0) continue
    pick -= weight
    if (pick <= 0) return rarity
  }
  return "C"
}

/** 确定性 RNG，回放和审计用得到 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
