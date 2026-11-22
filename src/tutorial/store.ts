import { useEffect, useSyncExternalStore } from "react"

import {
  fetchServerProgress,
  PROGRESS_SYNC_ENABLED,
  pushServerProgress,
} from "./persist"
import { TUTORIAL_STEPS, type PlayerProgress, type TutorialStep } from "./types"

/**
 * 等级经验表：index 是“当前等级”，值是升到下一级需要的经验。
 * 教程给的经验：album-view 100（1→2），deck-view 80 + battle-view 70（2→3）。
 * 所以正常走完教程正好 Lv.3；跳过则直接补到 Lv.3。
 */
const LEVEL_EXP_REQUIRED: Record<number, number> = {
  1: 100,
  2: 150,
  3: 250,
  4: 400,
  5: 600,
  6: 900,
}

export const MAX_LEVEL = 60

export function expToNextLevel(level: number): number {
  return (
    LEVEL_EXP_REQUIRED[level] ??
    Math.round(900 * Math.pow(1.22, Math.max(0, level - 6)))
  )
}

function createDefault(ownerId: string | null): PlayerProgress {
  return {
    version: 1,
    ownerId,
    level: 1,
    exp: 0,
    tutorialStep: "idle",
    tutorialDone: false,
    updatedAt: 0,
  }
}

const EMPTY = createDefault(null)
const STORAGE_PREFIX = "choke.progress.v1:"

function isStep(value: unknown): value is TutorialStep {
  return (
    typeof value === "string" &&
    (TUTORIAL_STEPS as readonly string[]).includes(value)
  )
}

function normalize(
  raw: Partial<PlayerProgress>,
  ownerId: string | null
): PlayerProgress {
  let tutorialStep = isStep(raw.tutorialStep) ? raw.tutorialStep : "idle"
  const tutorialDone = raw.tutorialDone === true || tutorialStep === "done"
  if (tutorialDone && tutorialStep === "idle") tutorialStep = "done"
  let level = Math.min(
    MAX_LEVEL,
    Math.max(1, Math.round(typeof raw.level === "number" ? raw.level : 1))
  )
  if (tutorialDone && level < 3) level = 3
  const exp = Math.max(0, Math.round(typeof raw.exp === "number" ? raw.exp : 0))
  return {
    version: 1,
    ownerId,
    level,
    exp,
    tutorialStep,
    tutorialDone,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  }
}

function storageKey(ownerId: string | null) {
  return STORAGE_PREFIX + (ownerId ?? "anon")
}

function read(ownerId: string | null): PlayerProgress {
  try {
    const raw = localStorage.getItem(storageKey(ownerId))
    if (!raw) return createDefault(ownerId)
    return normalize(JSON.parse(raw) as Partial<PlayerProgress>, ownerId)
  } catch {
    return createDefault(ownerId)
  }
}

function write(ownerId: string | null, state: PlayerProgress) {
  try {
    localStorage.setItem(storageKey(ownerId), JSON.stringify(state))
  } catch {
    // 隐私模式 / 存储已满：继续用内存状态
  }
}

const listeners = new Set<() => void>()
let current: PlayerProgress = EMPTY
let owner: string | null = null
let loaded = false

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return current
}

function hydrate(ownerId: string | null) {
  const nextOwner = ownerId ?? null
  if (loaded && owner === nextOwner) return
  owner = nextOwner
  loaded = true
  current = read(nextOwner)
  emit()
}

let pushTimer: number | null = null
function schedulePush(ownerId: string | null, state: PlayerProgress) {
  if (!PROGRESS_SYNC_ENABLED || !ownerId) return
  if (pushTimer) window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => {
    pushTimer = null
    pushServerProgress(ownerId, state).catch(() => {})
  }, 900)
}

function update(mutator: (state: PlayerProgress) => PlayerProgress) {
  const next = normalize(
    { ...mutator(current), ownerId: owner, updatedAt: Date.now() },
    owner
  )
  current = next
  write(owner, next)
  emit()
  schedulePush(owner, next)
}

export function addExp(
  state: Pick<PlayerProgress, "level" | "exp">,
  amount: number
): Pick<PlayerProgress, "level" | "exp"> {
  let level = state.level
  let exp = state.exp + Math.max(0, Math.round(amount))
  while (level < MAX_LEVEL && exp >= expToNextLevel(level)) {
    exp -= expToNextLevel(level)
    level += 1
  }
  return { level, exp }
}

const pulled = new Set<string>()

/** 登录后拉一次远端进度；远端更新才覆盖本地，否则把本地推上去 */
export async function pullProgress(ownerId: string | null) {
  if (!PROGRESS_SYNC_ENABLED || !ownerId || pulled.has(ownerId)) return
  const remote = await fetchServerProgress(ownerId)
  if (!remote || owner !== ownerId) return
  pulled.add(ownerId)
  const remoteState = normalize(
    {
      version: 1,
      ownerId,
      level: remote.level,
      exp: remote.exp,
      tutorialStep: remote.tutorialStep,
      tutorialDone: remote.tutorialDone,
      updatedAt: remote.updatedAt ?? 0,
    },
    ownerId
  )
  if (remoteState.updatedAt > current.updatedAt) {
    current = remoteState
    write(ownerId, current)
    emit()
  } else if (current.updatedAt > remoteState.updatedAt) {
    pushServerProgress(ownerId, current).catch(() => {})
  }
}

export function startTutorial() {
  if (current.tutorialStep !== "idle") return
  update((state) => ({ ...state, tutorialStep: "welcome" }))
}

/** 推进到下一步，同时结算经验；next === "done" 时教程毕业 */
export function advanceTutorial(next: TutorialStep, exp = 0) {
  update((state) => ({
    ...state,
    ...addExp(state, exp),
    tutorialStep: next,
    tutorialDone: state.tutorialDone || next === "done",
  }))
}

export function grantExp(exp: number) {
  update((state) => ({ ...state, ...addExp(state, exp) }))
}

/** 跳过：直接补到 Lv.3 + 毕业；新手礼包由 DeskPage 的 onFinish 负责补齐 */
export function skipTutorial() {
  update((state) => ({
    ...state,
    level: Math.max(state.level, 3),
    exp: state.level >= 3 ? state.exp : 0,
    tutorialStep: "done",
    tutorialDone: true,
  }))
}

/** 调试 / 重新体验教程用 */
export function resetTutorial() {
  update((state) => ({
    ...createDefault(state.ownerId),
    updatedAt: Date.now(),
  }))
}

export function useTutorialProgress(ownerId: string | null) {
  useEffect(() => {
    hydrate(ownerId)
    void pullProgress(ownerId)

    const onStorage = (event: StorageEvent) => {
      if (!ownerId || event.key !== storageKey(ownerId) || !event.newValue) return
      try {
        const next = normalize(
          JSON.parse(event.newValue) as Partial<PlayerProgress>,
          ownerId,
        )
        if (next.updatedAt > current.updatedAt) {
          current = next
          emit()
        }
      } catch {
        // 忽略其他标签页写坏的存档
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [ownerId])

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return snapshot.ownerId === (ownerId ?? null) ? snapshot : EMPTY
}
