import type { Element } from "../types"

/**
 * 战斗数值。敌人与关卡在 content/enemies、content/encounters。
 * 只放「调平衡会改的东西」；这里不出现任何状态、DOM 或 React。
 */

/** 九属性相克环（§1.2）：金 → 木 → 土 → 冰 → 火 → 雷 → 光 → 暗 → 金 */
export const ELEMENT_CYCLE: Element[] = [
  "metal",
  "wood",
  "earth",
  "ice",
  "fire",
  "thunder",
  "light",
  "dark",
]

/** Combo 曲线（§9.2）：1-2 为 0%，3 为 12%，线性爬升至 10 Combo = +180%（2.80×）封顶 */
export const COMBO_BONUS = [1, 1, 1, 1.12, 1.26, 1.51, 1.77, 2.03, 2.29, 2.54, 2.8]

export const COMBO_CAP = 10

export const ROMAN_TIER = ["0", "I", "II", "III", "IV"] as const

/** 防御档位减伤表（§6.7） */
export const DEFENSE_REDUCTION_TANK = [0, 0.2, 0.4, 0.7, 0.9]
export const DEFENSE_REDUCTION_NORMAL = [0, 0.2, 0.35, 0.35, 0.35]

/** 减伤公式的常数项：def / (def + K)，封顶 70% */
export const MITIGATION_K = 10000
export const MITIGATION_CAP = 0.7

/** 侧面支援默认值（§8.1） */
export const SUPPORT_PROC_RATE = 0.6
export const SUPPORT_DAMAGE_RATE = 0.5
export const SUPPORT_MAX_SLOTS = 7

/** 抢攻基础概率（§10.2，基础 4%，这里给到 14% 便于内测体验） */
export const PREEMPTIVE_RATE = 0.14
export const PREEMPTIVE_POWER = 0.7
