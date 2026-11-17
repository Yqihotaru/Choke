import type { TutorialEventType } from "./types"

/** 业务组件 → 教程状态机的单向通道 */
export const TUTORIAL_EVENT = "choke:tutorial-event"

/** 教程要求合上活页书（毕业 / 跳过时） */
export const TUTORIAL_CLOSE_BOOK_EVENT = "choke:tutorial-close-book"

/** 抽卡面板库存为空时，请求桌面重新确认 / 补发新手卡包 */
export const TUTORIAL_ENSURE_STARTER_EVENT = "choke:tutorial-ensure-starter"

export interface TutorialEventDetail {
  type: TutorialEventType
  [key: string]: unknown
}

export function emitTutorialEvent(
  type: TutorialEventType,
  detail: Record<string, unknown> = {}
) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<TutorialEventDetail>(TUTORIAL_EVENT, {
      detail: { type, ...detail },
    })
  )
}

export function requestTutorialCloseBook() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(TUTORIAL_CLOSE_BOOK_EVENT))
}

export function requestTutorialStarter() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(TUTORIAL_ENSURE_STARTER_EVENT))
}
