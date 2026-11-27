import type { Element, Rarity } from "../types"
import type { StatusEffect } from "./types"

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

/** 九属性相克环倍率（§1.2）：同属性 / 顺时针 1·2 位 / 逆时针 1·2 位 */
export const ELEMENT_CYCLE_MULT = {
  same: 0.9,
  counter1: 1.25,
  counter2: 1.1,
  resisted1: 0.8,
  resisted2: 0.9,
} as const

/** 物理命中灵体（spirit 特性）的倍率 */
export const PHYSICAL_SPIRIT_MULT = 1.2

/** 命中敌人弱点时加算到属性乘区的额外加成（+15%，配合弱点破防机制） */
export const WEAKNESS_BONUS = 0.15

/** 残血增强类被动的队伍血量比例阈值 */
export const LOW_HP_THRESHOLD = 0.3

/** 硬壳支援：单段伤害低于门槛时的保底伤害 */
export const SHELL_MIN_DAMAGE = 100

/** 弱点破防（Break）护盾默认格数：按敌人档位，可在敌人 JSON 里用 shieldMax 单独覆盖（0 = 无盾） */
export const SHIELD_MAX_BY_TIER = { normal: 3, elite: 5, boss: 7 } as const

/** 破盾时给敌人施加「脆弱」状态的持续回合数（仅提供伤害窗口，不返 AP、不抢打断位） */
export const SHIELD_BREAK_VULNERABLE_TURNS = 2

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

/** 重装甲支援每档给全队 DEF / 魔法抗性 +20%（II 档 = +40%），再走 DEF/(DEF+K) 的减伤公式 */
export const ARMOR_RESIST_PER_TIER = 0.2
/** 重装甲（DEF 乘区）和手动防御（绝对减免）叠加后的总减伤上限：任何情况至少吃 10% 伤害 */
export const TOTAL_DEFENSE_REDUCTION_CAP = 0.9
/** 全队被动回血（生生不息、生命脉动等）每回合合计上限：最大生命的 4% */
export const REGEN_TEAM_CAP = 0.04
/** 全队被动减伤（滞拍格挡、稳拍护盾）合计上限：10%（约半档手动防御）；之后仍计入总减伤 90% 上限 */
export const TEAM_DAMAGE_REDUCE_CAP = 0.1
/** 异常计数增伤最多计几种负面状态 */
export const DEBUFF_SCALE_MAX_KINDS = 3

/** 减伤公式的常数项：def / (def + K)，封顶 70% */
export const MITIGATION_K = 10000
export const MITIGATION_CAP = 0.7

/**
 * 阵容加成：上阵卡的数据乘 FIELD_WEIGHT，替补卡的数据乘 BENCH_WEIGHT 后计入。
 * 1 和 0 等于旧规则（只看上阵卡）。
 */
export const FIELD_WEIGHT = 1
export const BENCH_WEIGHT = 0

/** 侧面支援默认值（§8.1） */
export const SUPPORT_PROC_RATE = 0.6
export const SUPPORT_DAMAGE_RATE = 0.5
export const SUPPORT_MAX_SLOTS = 7

/** 抢攻基础概率（§10.2，基础 4%，这里给到 14% 便于内测体验） */
export const PREEMPTIVE_RATE = 0.14
export const PREEMPTIVE_POWER = 0.7

/** 每回合触发灯（Boost / 必杀 / 连击）基础概率与 MOD/诗人被动系数（§10.1） */
export const CARD_TRIGGER_CONFIG = {
  modBonusPerMod: 0.03,
  criticalArtBase: 0.04,
  criticalArtModScale: 0.5,
  criticalArtBardScale: 0.3,
  doubleCastBase: 0.05,
  doubleCastModScale: 0.5,
  doubleCastBardScale: 0.3,
  boostBase: 0.12,
} as const

/** 敌方异常/增益状态默认模板（§11.1） */
export const ENEMY_STATUS_TEMPLATES: Readonly<Record<string, StatusEffect>> = {
  freeze: { id: "freeze", name: "冻结", amount: 0.2, turns: 2, isDebuff: true },
  shock: { id: "shock", name: "触电", amount: 0.3, turns: 3, isDebuff: true },
  burn: { id: "burn", name: "燃烧", amount: 0.03, turns: 3, isDebuff: true },
  poison: { id: "poison", name: "中毒", amount: 0.03, turns: 4, isDebuff: true },
  fear: { id: "fear", name: "恐惧", amount: 1, turns: 3, isDebuff: true },
  charm: { id: "charm", name: "魅惑", amount: 0.5, turns: 2, isDebuff: true },
  bleed: { id: "bleed", name: "流血", amount: 0.01, turns: 3, stacks: 1, isDebuff: true },
  confuse: { id: "confuse", name: "混乱", amount: 0.3, turns: 2, isDebuff: true },
  curse: { id: "curse", name: "诅咒", amount: 0.15, turns: 3, isDebuff: true },
  silence: { id: "silence", name: "沉默", amount: 1, turns: 2, isDebuff: true },
  armor_break: { id: "armor_break", name: "破防", stat: "def", amount: -0.2, turns: 3, stacks: 1, isDebuff: true },
  weaken: { id: "weaken", name: "衰弱", stat: "atk", amount: -0.2, turns: 2, isDebuff: true },
  vulnerable: { id: "vulnerable", name: "脆弱", amount: 0.3, turns: 2, isDebuff: true },
  enrage: { id: "enrage", name: "狂暴", stat: "atk", amount: 0.4, turns: 99, isDebuff: false },
  vigilant: { id: "vigilant", name: "警觉", amount: 1, turns: 3, isDebuff: false },
}

/** 敌方挂在我方队伍上的异常状态默认数值与回合 */
export const TEAM_STATUS_DEFAULT = { amount: 0.03, turns: 3 } as const

/** Down 抵抗公式参数（§7.3 & §6.8）：坦克基础 45% + 每档防御 +15%；非坦克每档防御 +12% */
export const DOWN_RESIST_CONFIG = {
  tankBase: 0.45,
  tankPerDefTier: 0.15,
  otherPerDefTier: 0.12,
} as const
