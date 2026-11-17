import type { PanelId } from "@/desk/DeskBook"

import type { PlayerProgress } from "./types"

/** 桌面上会出现锁的模块：九个书本章节 + 发牌按钮 + 邀请函 */
export type ModuleId = PanelId | "button" | "invite"

/**
 * 等级解锁表——桌面物件和书本左右标签页共用这一份。
 * 教程流程只负责把等级推到 2 / 3，不另写一套“教程解锁”。
 */
export const MODULE_UNLOCK_LEVEL: Record<ModuleId, number> = {
  account: 1,
  about: 1,
  packs: 1,
  album: 1,
  deck: 2,
  battle: 2,
  backpack: 3,
  codex: 3,
  invite: 3,
  button: 3,
  market: 6,
}

/**
 * 日常模块在教程毕业前不开放，避免玩家在 Step 1 就绕去背包 / 图鉴。
 * 市场始终在桌面上显示锁定态，用来预告 Lv.6 目标。
 */
const AFTER_TUTORIAL: ModuleId[] = ["backpack", "codex", "invite", "button"]

export function unlockLevelOf(id: ModuleId): number {
  return MODULE_UNLOCK_LEVEL[id]
}

export function isModuleUnlocked(
  id: ModuleId,
  progress: Pick<PlayerProgress, "level" | "tutorialDone">
): boolean {
  if (AFTER_TUTORIAL.includes(id) && !progress.tutorialDone) return false
  return progress.level >= MODULE_UNLOCK_LEVEL[id]
}

/** 桌面上是否画出这个物件；市场例外：永远画出，但呈锁定态 */
export function isModuleVisibleOnDesk(
  id: ModuleId,
  progress: Pick<PlayerProgress, "level" | "tutorialDone">
): boolean {
  if (id === "market") return true
  return isModuleUnlocked(id, progress)
}

export function lockHintOf(
  id: ModuleId,
  progress: Pick<PlayerProgress, "level" | "tutorialDone">
): string {
  const need = MODULE_UNLOCK_LEVEL[id]
  if (AFTER_TUTORIAL.includes(id) && !progress.tutorialDone) {
    return "先完成新手教程解锁"
  }
  if (progress.level < need) {
    const gap = need - progress.level
    return `需要 Lv.${need} 解锁，还差 ${gap} 级`
  }
  return `需要 Lv.${need} 解锁`
}
