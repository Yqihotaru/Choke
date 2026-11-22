import type { StarCondition } from "./content"
import type { BattleStarRating, BattleState } from "./types"

/** 三星条件是否达成。只看最终状态，所以重放后服务端得到的结论和客户端一致 */
export function starMet(cond: StarCondition, state: BattleState): boolean {
  switch (cond.type) {
    case "turnsAtMost":
      return state.turn <= cond.value
    case "noDown":
      return state.downCount === 0
    case "apSpentAtMost":
      return state.apSpentTotal <= cond.value
  }
}

export function evaluateStars(state: BattleState): BattleStarRating {
  const stars = state.starConditions.map((condition) => ({ condition, met: starMet(condition, state) }))
  return { stars, count: stars.filter((s) => s.met).length }
}

/** 战前展示：条件名 + 目标 */
export function describeStar(cond: StarCondition): { title: string; target: string } {
  switch (cond.type) {
    case "turnsAtMost":
      return { title: "速通", target: `≤ ${cond.value} 回合` }
    case "noDown":
      return { title: "无伤", target: "无人被 DOWN" }
    case "apSpentAtMost":
      return { title: "高效", target: `累计 AP ≤ ${cond.value}` }
  }
}

/** 战后展示：实际成绩 */
export function starProgress(cond: StarCondition, state: BattleState): string {
  switch (cond.type) {
    case "turnsAtMost":
      return `${state.turn} / ${cond.value} 回合内`
    case "noDown":
      return `本场 DOWN ${state.downCount} 次`
    case "apSpentAtMost":
      return `消耗 ${state.apSpentTotal} / ${cond.value} AP`
  }
}
