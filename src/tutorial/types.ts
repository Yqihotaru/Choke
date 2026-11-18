/**
 * 新手教程的状态机与持久化数据结构。
 *
 * 步骤是一条单向流水线；每一步只关心：
 * - 高亮哪个 DOM 节点（data-tutorial-id）
 * - 用哪种方式推进（点目标 / 等业务事件 / 点对话框）
 * - 推进时发多少经验、下一步是谁
 *
 * 业务组件不需要知道“现在是第几步”，只需要在关键动作发生时
 * emitTutorialEvent("pack-opened" / "deck-confirmed")。
 */

export const TUTORIAL_STEPS = [
  "idle",
  "welcome",
  "gacha-entry",
  "gacha-open",
  "album",
  "album-view",
  "deck",
  "deck-view",
  "battle-tab",
  "battle-view",
  "battle-result",
  "graduation",
  "done",
] as const

export type TutorialStep = (typeof TUTORIAL_STEPS)[number]

/** 真正会显示台词 / 遮罩的步骤（idle 和 done 不显示） */
export type TutorialPlayableStep = Exclude<TutorialStep, "idle" | "done">

export type TutorialEventType = "pack-opened" | "deck-confirmed"

export type TutorialMood = "idle" | "happy" | "smug" | "serious"

export type TutorialAdvance = "continue" | "click" | "event" | "external"

export interface TutorialLine {
  text: string
  mood?: TutorialMood
}

/** 目标解析上下文：书是否翻开会影响“桌面物件”还是“书本标签页”才是正确目标 */
export interface TutorialContext {
  bookOpen: boolean
  level: number
  tutorialDone: boolean
}

/** 目标按“书合着 / 书翻开”分别配置；台本 JSON 用这个结构 */
export interface TutorialTargetByView {
  desktop?: string | string[]
  book?: string | string[]
}

export type TutorialTarget =
  | string
  | string[]
  | TutorialTargetByView
  | ((context: TutorialContext) => string | string[] | null)

export interface TutorialScript {
  /** 高亮目标；不传 = 全屏遮罩（纯对话步骤） */
  target?: TutorialTarget
  advanceOn: TutorialAdvance
  /** advanceOn === "event" 时等待的业务事件 */
  event?: TutorialEventType
  /** 推进时发放的经验 */
  exp?: number
  /** 下一步；最后一步指向 done */
  next?: TutorialStep
  lines: TutorialLine[]
  /** 推进时合上活页书（毕业用） */
  closeBookOnExit?: boolean
}

export interface PlayerProgress {
  version: 1
  /** 存档按用户隔离；未登录为 null */
  ownerId: string | null
  level: number
  /** 当前等级内经验，升级时扣除 */
  exp: number
  tutorialStep: TutorialStep
  tutorialDone: boolean
  /** 本地/远端合并时用，越大越新 */
  updatedAt: number
}
