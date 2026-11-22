import type { Element } from "../types"

import type { Enemy } from "./types"

/**
 * 战斗数值与关卡配置。
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

/** 教程首战用的练习幽灵：血量、攻防都压低，保证新号也能在 1–2 回合内打完 */
export const TUTORIAL_ENEMY_HP = 3600

export interface StagePreset {
  id: string
  name: string
  title: string
  tier: Enemy["tier"]
  element: Element
  weaknesses: Element[]
  hp: number
  atk: number
  int: number
  def: number
  parTurns: number
  parAp: number
  damageThreshold?: number
  enrageOnInterrupt?: boolean
  summary: string
}

export const STAGE_PRESETS: StagePreset[] = [
  {
    id: "ghost",
    name: "谱面幽灵",
    title: "深渊徘徊灵体",
    tier: "normal",
    element: "dark",
    weaknesses: ["light", "physical"],
    hp: 28_000,
    atk: 620,
    int: 680,
    def: 1_100,
    parTurns: 5,
    parAp: 10,
    summary: "灵体属性（受物理 +20%），每回合 2 动，适合熟悉 Combo 与支援铺垫。",
  },
  {
    id: "vanguard",
    name: "断音重装卫队",
    title: "高 T 多动精锐",
    tier: "elite",
    element: "thunder",
    weaknesses: ["fire", "ice"],
    hp: 52_000,
    atk: 820,
    int: 760,
    def: 2_200,
    parTurns: 7,
    parAp: 15,
    summary: "高 T 精英：每回合 3–4 动，左侧带【重装甲 II】与【荆棘栅栏】，需破甲拆支援并善用防御档位。",
  },
  {
    id: "conductor",
    name: "失拍指挥·终曲",
    title: "深渊乐团指挥 · BOSS",
    tier: "boss",
    element: "dark",
    weaknesses: ["light", "ice", "fire"],
    hp: 120_000,
    atk: 1_080,
    int: 1_180,
    def: 2_800,
    parTurns: 10,
    parAp: 22,
    summary: "终曲 BOSS：每回合 3–4 动，带侧面蓄力大招、高额 Down 威胁与拆支援技能，全面检验打断、硬控与坦克开罐。",
  },
]
