import type { Rarity } from "./types"

/**
 * 前后端共用的固定配置。
 * 只放「语义唯一、两端都必须一致」的值；任何展示文案不要放这里。
 */

/** 主队槽位 */
export const DECK_SIZE = 7

/** 每个卡包开出的张数 */
export const PACK_SIZE = 5

/** 市场解锁所需的玩家等级 */
export const MARKET_UNLOCK_LEVEL = 3

/** 卡池 id（与 apps/api/src/gacha/packs.ts 的 key 必须一致） */
export const POOL_IDS = ["normal", "idle", "golden", "radiant", "sky", "prism"] as const

export type PoolId = (typeof POOL_IDS)[number]

/** 侧面上限：敌我各 7 格 */
export const MAX_SUPPORT_SLOTS = 7

/** 七档品质基础值；压缩比固定 3.5×（C 400 → Prismatic 1,400） */
export const RARITY_BASE: Record<Rarity, number> = {
  C: 400,
  UC: 480,
  R: 600,
  E: 740,
  L: 960,
  Radiant: 1160,
  Prismatic: 1400,
}

/** 命座单颗收益率：品阶越低越高，满命 E ≈ 4 命 L */
export const CONSTELLATION_BONUS: Record<Rarity, number> = {
  C: 0.1,
  UC: 0.09,
  R: 0.08,
  E: 0.07,
  L: 0.05,
  Radiant: 0.04,
  Prismatic: 0.03,
}
