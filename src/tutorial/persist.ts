import { fetchProgress, saveProgress } from "@/desk/api"

import { TUTORIAL_STEPS, type PlayerProgress, type TutorialStep } from "./types"

/**
 * 后端同步适配层。
 *
 * localStorage 是主存储，远端同步默认开启（VITE_PROGRESS_SYNC=0 可临时关闭）。
 * 后端接口（与下面两个函数一一对应）：
 *
 *   GET  /api/users/:userId/progress
 *   PUT  /api/users/:userId/progress
 *   body: { level, exp, tutorialStep, tutorialDone, updatedAt }
 *
 * users 表保存 player_level / player_exp / tutorial_step / tutorial_done /
 * progress_updated_at；updatedAt 用毫秒时间戳，用来做“本地 / 远端谁更新”
 * 的合并。没有远端时完全不影响本地流程。
 */
// 默认开启；本地调试后端时可用 VITE_PROGRESS_SYNC=0 临时关掉
export const PROGRESS_SYNC_ENABLED = import.meta.env.VITE_PROGRESS_SYNC !== "0"

export interface ServerProgress {
  level: number
  exp: number
  tutorialStep: TutorialStep
  tutorialDone: boolean
  updatedAt?: number
}

function isStep(value: unknown): value is TutorialStep {
  return (
    typeof value === "string" &&
    (TUTORIAL_STEPS as readonly string[]).includes(value)
  )
}

export async function fetchServerProgress(
  userId: string
): Promise<ServerProgress | null> {
  if (!PROGRESS_SYNC_ENABLED) return null
  const data = await fetchProgress(userId)
  if (!data) return null
  if (
    typeof data.level !== "number" ||
    typeof data.exp !== "number" ||
    !isStep(data.tutorialStep) ||
    typeof data.tutorialDone !== "boolean"
  ) {
    return null
  }
  return {
    level: data.level,
    exp: data.exp,
    tutorialStep: data.tutorialStep,
    tutorialDone: data.tutorialDone,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  }
}

export async function pushServerProgress(
  userId: string,
  progress: PlayerProgress
): Promise<void> {
  if (!PROGRESS_SYNC_ENABLED) return
  await saveProgress(userId, {
    level: progress.level,
    exp: progress.exp,
    tutorialStep: progress.tutorialStep,
    tutorialDone: progress.tutorialDone,
    updatedAt: progress.updatedAt,
  })
}
