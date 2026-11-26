import { useEffect, useMemo, useRef, useState } from "react"

import { hasLegalAction } from "@choke/shared/battle/engine"
import type { BattleState } from "@choke/shared/battle/types"

/** 没有任何操作可做之后，等多久自动结束回合（毫秒） */
export const AUTO_END_DELAY_MS = 3000
const STORAGE_KEY = "choke:auto-end-turn"

function readSetting() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off"
  } catch {
    return true
  }
}

/**
 * 我方回合里再也没有能做的操作时，亮出提示并倒计时，到点自动结束回合。
 * 倒计时期间点任何东西、按任何键都会取消，直到战斗状态变化（比如下一回合）才重新计时。
 * allowed 为 false（教学战）时永远不自动结束。开关记在本机，默认开。
 */
export function useAutoEndTurn({
  battle,
  allowed,
  onEndTurn,
}: {
  battle: BattleState | null
  allowed: boolean
  onEndTurn: () => void
}) {
  const [on, setOn] = useState(readSetting)
  const [cancelledFor, setCancelledFor] = useState<BattleState | null>(null)
  const endRef = useRef(onEndTurn)
  endRef.current = onEndTurn

  const stuck = useMemo(() => !!battle && battle.phase === "player" && !hasLegalAction(battle), [battle])
  const pending = allowed && on && stuck && cancelledFor !== battle

  useEffect(() => {
    if (!pending) return
    const timer = window.setTimeout(() => endRef.current(), AUTO_END_DELAY_MS)
    const cancel = () => setCancelledFor(battle)
    window.addEventListener("pointerdown", cancel, true)
    window.addEventListener("keydown", cancel, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("pointerdown", cancel, true)
      window.removeEventListener("keydown", cancel, true)
    }
  }, [pending, battle])

  const toggle = () => {
    setOn((value) => {
      const next = !value
      try {
        localStorage.setItem(STORAGE_KEY, next ? "on" : "off")
      } catch {
        /* 存不了就只在本次生效 */
      }
      return next
    })
  }

  return { on, toggle, pending, allowed }
}
