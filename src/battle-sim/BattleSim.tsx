import { useState } from "react"

import { BattleStage } from "@/battle/BattleStage"
import {
  STAGE_PRESETS,
  cloneBattle,
  createBattle,
  endTurn,
  playSkill,
  raiseDefense,
  swapBattleCard,
} from "@/battle/engine"
import type { BattleState } from "@/battle/types"
import { DEMO_CARDS } from "@/card/data"

/**
 * 实验室免登录战斗模拟页（/battle-sim）：
 * 直接使用与生产页完全一致的 `战斗机制 v0.1` 引擎与 `BattleStage` 舞台，
 * 预置 7 张满编示例卡组，默认挑战魔人 BOSS 希尔基。
 */
export function BattleSim() {
  const [stageId, setStageId] = useState<string>(STAGE_PRESETS[2]!.id)
  const [battle, setBattle] = useState<BattleState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const start = () => {
    setActionError(null)
    setBattle(
      createBattle(
        DEMO_CARDS.map((face, idx) => ({
          uid: idx + 1,
          cardId: face.id,
          face,
        })),
        {
          tutorial: false,
          stageId,
        },
      ),
    )
  }

  const play = (index: number, skillId: string) => {
    if (!battle) return
    const next = cloneBattle(battle)
    const message = playSkill(next, index, skillId)
    setBattle(next)
    setActionError(message)
  }

  const defend = (tier?: number) => {
    if (!battle) return
    const next = cloneBattle(battle)
    const message = raiseDefense(next, tier)
    setBattle(next)
    setActionError(message)
  }

  const swap = (activeSlotIndex: number, benchUid: number) => {
    if (!battle) return
    const next = cloneBattle(battle)
    const message = swapBattleCard(next, activeSlotIndex, benchUid)
    setBattle(next)
    setActionError(message)
  }

  const finishTurn = () => {
    if (!battle) return
    const next = cloneBattle(battle)
    const message = endTurn(next)
    setBattle(next)
    setActionError(message)
  }

  return (
    <BattleStage
      battle={battle}
      deck={DEMO_CARDS}
      stageId={stageId}
      tutorial={false}
      actionError={actionError}
      onSelectStage={(nextId) => setStageId(nextId)}
      onStart={start}
      onPlay={play}
      onDefend={defend}
      onSwap={swap}
      onEndTurn={finishTurn}
      onRestart={start}
    />
  )
}
