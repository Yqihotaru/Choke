import { TUTORIAL_STEPS, type PlayerProgress, type TutorialStep } from "./types"

/**
 * 后端同步适配层。
 *
 * 默认只写 localStorage；把 VITE_PROGRESS_SYNC 设为 "1" 后启用远端备份。
 * 建议的后端接口（与下面两个函数一一对应）：
 *
 *   GET  /api/users/:userId/progress
 *   PUT  /api/users/:userId/progress
 *   body: { level, exp, tutorialStep, tutorialDone, updatedAt }
 *
 * 服务端保存到 users 表的 player_level / player_exp / tutorial_step /
 * tutorial_done / progress_updated_at 五列即可；updatedAt 用毫秒时间戳，
 * 用来做“本地 / 远端谁更新”的合并。没有远端时完全不影响本地流程。
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

function endpoint(userId: string) {
  return `/api/users/${encodeURIComponent(userId)}/progress`
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
  try {
    const res = await fetch(endpoint(userId), { credentials: "include" })
    if (!res.ok) return null
    const payload = (await res.json()) as {
      ok?: boolean
      data?: Partial<ServerProgress>
    }
    if (!payload.ok || !payload.data) return null
    const data = payload.data
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
  } catch {
    return null
  }
}

export async function pushServerProgress(
  userId: string,
  progress: PlayerProgress
): Promise<void> {
  if (!PROGRESS_SYNC_ENABLED) return
  try {
    await fetch(endpoint(userId), {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: progress.level,
        exp: progress.exp,
        tutorialStep: progress.tutorialStep,
        tutorialDone: progress.tutorialDone,
        updatedAt: progress.updatedAt,
      }),
    })
  } catch {
    // 后端不可用时静默回退到本地缓存
  }
}
