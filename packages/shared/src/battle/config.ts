import type { Element, Rarity } from "../types"

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

/**
 * Combo 曲线（§9.2）：凸曲线，封顶 +50%。
 * 下标是 Combo 层数；1–2 层无加成，9 层及以上封顶 1.50。
 * 这是配置项：以后技能可以抬高上限，别把数值写死在引擎里。
 */
export const COMBO_BONUS = [1, 1, 1, 1.03, 1.08, 1.14, 1.22, 1.3, 1.4, 1.5]

export const COMBO_CAP = COMBO_BONUS.length - 1

/** 斩杀"血量低"的判定线：敌人当前血量 / 最大血量 */
export const EXECUTE_LOW_HP_RATIO = 0.4

/** 敌方招式挂在我方队伍上的状态的显示名（只影响显示与日志，不影响随机） */
export const TEAM_STATUS_NAME: Record<string, string> = {
  burn: "燃烧",
  poison: "中毒",
  bleed: "流血",
  freeze: "冻结",
  heal_block: "禁疗",
  weaken: "衰弱",
  fear: "恐惧",
  armor_break: "破防",
}

/** 技能附带状态的几率修正：按敌人档位乘在技能自己的 statusChance 上 */
export const STATUS_CHANCE_BY_TIER = { normal: 1, elite: 0.8, boss: 0.65 } as const

/**
 * 打断（盲抽打断技能）：成功率 = 档位基础率 × 施放者稀有度系数 × （难打断 ×0.4），限制在 5%–95%。
 * 盲抽时难打断的招式权重 0.4，其他招式 1。
 */
export const INTERRUPT_BASE_RATE = { normal: 0.65, elite: 0.55, boss: 0.45 } as const
export const INTERRUPT_RARITY_FACTOR: Record<Rarity, number> = {
  C: 0.9,
  UC: 0.95,
  R: 1,
  E: 1.05,
  L: 1.1,
  Mythic: 1.15,
  Prismatic: 1.2,
}
/** 本体卡按最高档计 */
export const INTERRUPT_HERO_FACTOR = 1.2
export const HARD_TO_INTERRUPT_WEIGHT = 0.4
export const HARD_TO_INTERRUPT_RATE_FACTOR = 0.4
export const INTERRUPT_RATE_MIN = 0.05
export const INTERRUPT_RATE_MAX = 0.95

/**
 * 硬控（眠咒 / 击晕）：成功率 =（档位基础率 + 控制专精）×（本回合有未被打断的难以打断招式时 ×0.4），限制在 5%–95%。
 * 难以打断的招式不该被一发硬控整个绕过，所以和打断用同一个系数。
 */
export const HARD_CONTROL_BASE_RATE = { normal: 0.8, elite: 0.65, boss: 0.5 } as const
export const HARD_CONTROL_HARD_FACTOR = 0.4
export const HARD_CONTROL_RATE_MIN = 0.05
export const HARD_CONTROL_RATE_MAX = 0.95

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
