import { z } from "zod"

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

/** 服务端收到的操作先过这一道：形状不对的直接拒绝，合不合法再交给引擎判断 */
export const battleActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("skill"), card: z.int().min(0).max(20), skill: z.string().min(1).max(60) }),
  z.strictObject({ type: z.literal("defend"), tier: z.int().min(0).max(4).optional() }),
  z.strictObject({ type: z.literal("swap"), slot: z.int().min(0).max(20), benchUid: z.int() }),
  z.strictObject({ type: z.literal("endTurn") }),
])

/** 单次上传的操作条数上限；一整场战斗的上限 */
export const MAX_ACTIONS_PER_UPLOAD = 300
export const MAX_ACTIONS_PER_BATTLE = 3000

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
  /** 开场队伍血量比例，缺省满血 */
  hpRatio?: number
}

export interface ReplayResult {
  state: BattleState
  /** 第一个不合法操作的下标；全部合法则为 null。遇到不合法操作即停止 */
  invalidAt: number | null
  error: string | null
}

/** 从头重放一场战斗。服务端复算用的就是它 */
export function replayBattle(input: ReplayInput, actions: BattleAction[]): ReplayResult {
  const state = createBattle(input.encounter, input.cards, {
    seed: input.seed,
    apMax: input.apMax,
    bench: input.bench,
    hpRatio: input.hpRatio,
  })
  for (let i = 0; i < actions.length; i += 1) {
    const error = applyAction(state, actions[i]!)
    if (error) return { state, invalidAt: i, error }
  }
  return { state, invalidAt: null, error: null }
}
