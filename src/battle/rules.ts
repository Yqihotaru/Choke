import type { Element } from "@/card/types"

import {
  COMBO_BONUS,
  COMBO_CAP,
  DEFENSE_REDUCTION_NORMAL,
  DEFENSE_REDUCTION_TANK,
  ELEMENT_CYCLE,
  MITIGATION_CAP,
  MITIGATION_K,
} from "./config"
import type { EnemyIntent } from "./types"

/**
 * 战斗规则：全部是纯函数，不读 state、不写 state、不碰 DOM。
 * 这一层可以被服务端直接 import 做回放复算。
 */

export function comboMultiplier(combo: number): number {
  const capped = Math.min(Math.max(combo, 0), COMBO_CAP)
  return COMBO_BONUS[capped] ?? COMBO_BONUS[COMBO_CAP] ?? 1
}

/** 减伤：def / (def + K)，封顶 70% */
export function mitigation(defence: number): number {
  const value = Math.max(0, defence)
  return Math.min(value / (value + MITIGATION_K), MITIGATION_CAP)
}

/**
 * 防御档位减伤率（§6.7）：
 * - 坦克在场：最高 Lv4（20% / 40% / 70% / 90%）
 * - 无坦克在场：最高 Lv2（20% / 35%）
 */
export function defenseReductionOf(tier: number, tankPresent: boolean): number {
  const clamped = Math.min(Math.max(tier, 0), tankPresent ? 4 : 2)
  return (tankPresent ? DEFENSE_REDUCTION_TANK : DEFENSE_REDUCTION_NORMAL)[clamped] ?? 0
}

/**
 * 九属性相克环（§1.2）：
 * 顺时针 1 位 +25%，顺时针 2 位 +10%，逆时针 1 位 -20%，逆时针 2 位 -10%，同属性 -10%。
 * 物理对灵体 +20%；命中弱点至少 +30%。
 */
export function elementMultiplier(
  attack: Element,
  defend: Element,
  enemyId?: string,
  weaknesses: Element[] = [],
): number {
  let mult = 1
  if (attack === "physical") {
    if (enemyId === "ghost" || enemyId === "tutorial-ghost") {
      mult = 1.2
    }
  } else if (defend !== "physical") {
    const ai = ELEMENT_CYCLE.indexOf(attack)
    const di = ELEMENT_CYCLE.indexOf(defend)
    if (ai >= 0 && di >= 0) {
      const diff = (ai - di + ELEMENT_CYCLE.length) % ELEMENT_CYCLE.length
      if (diff === 0) mult = 0.9
      else if (diff === 1) mult = 1.25
      else if (diff === 2) mult = 1.1
      else if (diff === ELEMENT_CYCLE.length - 1) mult = 0.8
      else if (diff === ELEMENT_CYCLE.length - 2) mult = 0.9
    }
  }
  if (weaknesses.includes(attack)) {
    mult = Math.max(mult, 1.3)
  }
  return mult
}

export function enemyDamageTier(intent: EnemyIntent): "低" | "中" | "高" | "特大" {
  if (intent.isChargedUltimate) return "特大"
  if (intent.kind === "heavy_phys" || intent.kind === "heavy_magic") return "高"
  if (intent.kind === "magic" || intent.kind === "break_support") return "中"
  return "低"
}
