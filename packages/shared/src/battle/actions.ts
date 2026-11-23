import {
  cloneBattle,
  createBattle,
  endTurn,
  playSkill,
  raiseDefense,
  swapBattleCard,
  type BattleInputCard,
} from "./engine"
import type { EncounterSpec } from "./content"
import type { BattleState } from "./types"

/**
 * 玩家的一次操作。战斗过程 = 遭遇 + 卡组 + 种子 + 操作列表，
 * 服务端拿同样的东西重放，就能得到和客户端逐位相同的结果。
 */
export type BattleAction =
  | { type: "skill"; card: number; skill: string }
  | { type: "defend"; tier?: number }
  | { type: "swap"; slot: number; benchUid: number }
  | { type: "endTurn" }

/** 在 state 上原地执行一个操作；返回错误信息（操作不合法）或 null */
export function applyAction(state: BattleState, action: BattleAction): string | null {
  switch (action.type) {
    case "skill":
      return playSkill(state, action.card, action.skill)
    case "defend":
      return raiseDefense(state, action.tier)
    case "swap":
      return swapBattleCard(state, action.slot, action.benchUid)
    case "endTurn":
      return endTurn(state)
  }
}

/** 复制一份再执行，适合 React 这类需要新对象的调用方 */
export function withAction(state: BattleState, action: BattleAction): { state: BattleState; error: string | null } {
  const next = cloneBattle(state)
  const error = applyAction(next, action)
  return { state: next, error }
}

export interface ReplayInput {
  encounter: EncounterSpec
  cards: BattleInputCard[]
  bench: BattleInputCard[]
  seed: string
  apMax: number
}

export interface ReplayResult {
  state: BattleState
  /** 第一个不合法操作的下标；全部合法则为 null。遇到不合法操作即停止 */
  invalidAt: number | null
  error: string | null
}

/** 从头重放一场战斗。服务端复算用的就是它 */
export function replayBattle(input: ReplayInput, actions: BattleAction[]): ReplayResult {
  const state = createBattle(input.encounter, input.cards, { seed: input.seed, apMax: input.apMax, bench: input.bench })
  for (let i = 0; i < actions.length; i += 1) {
    const error = applyAction(state, actions[i]!)
    if (error) return { state, invalidAt: i, error }
  }
  return { state, invalidAt: null, error: null }
}
