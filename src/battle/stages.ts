import { lazy } from "react"

/** 两套战斗界面：classic 默认，modern 懒加载。独立战斗页和被嵌入的流程（远征）共用这里 */
export type BattleUiMode = "classic" | "modern"

const BATTLE_UI_KEY = "choke:battle-ui"

export const ClassicStage = lazy(() => import("./view/BattleStage").then((m) => ({ default: m.BattleStage })))
export const ModernStage = lazy(() => import("./view-modern/BattleStage").then((m) => ({ default: m.BattleStage })))

export function readBattleUiMode(searchParams?: URLSearchParams): BattleUiMode {
  const fromUrl = searchParams?.get("ui")
  if (fromUrl === "classic" || fromUrl === "modern") return fromUrl
  try {
    const saved = localStorage.getItem(BATTLE_UI_KEY)
    if (saved === "classic" || saved === "modern") return saved
  } catch {
    // ignore storage failure
  }
  return "classic"
}

export function saveBattleUiMode(mode: BattleUiMode) {
  try {
    localStorage.setItem(BATTLE_UI_KEY, mode)
  } catch {
    // The current tab can still switch when storage is unavailable.
  }
}
