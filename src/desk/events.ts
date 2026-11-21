/**
 * 桌面事件总线：所有跨组件的 window 事件名只在这里定义。
 *
 * 领域划分：
 * - drag：卡片指针拖拽
 * - desk：悬停反馈（卡册 / 背包 / 卡组槽）
 * - data：数据变化（卡包库存、桌面卡、卡组分配）
 * - flow：面板间流程（抽卡 → 桌面开包动画）
 */

/** 卡片指针拖拽开始（书页、开包层、桌面共用） */
export const CARD_POINTER_START_EVENT = "choke:card-pointer-start"
/** 卡片指针拖拽落点 */
export const CARD_POINTER_DROP_EVENT = "choke:card-pointer-drop"

/** 桌面上的卡拖到某个目标上时的悬停反馈 */
export const DESK_HOVER_EVENT = "choke:desk-hover"

/** 桌面数据变化：卡包库存 / 新增卡 / 桌面卡 id 列表 */
export const DESK_DATA_CHANGED_EVENT = "choke:desk-data"

/** 卡组槽位分配 */
export const DECK_ASSIGN_EVENT = "choke:deck-assign"

/** 抽卡面板开出卡后交给桌面播放开包动画 */
export const GACHA_OPEN_EVENT = "choke:gacha-open"

export type DeskDataScope = "packs" | "cards" | "items"

export interface DeskDataDetail<T = unknown> {
  scope: DeskDataScope
  payload?: T
}

export function emitDeskData<T = unknown>(scope: DeskDataScope, payload?: T) {
  window.dispatchEvent(
    new CustomEvent<DeskDataDetail<T>>(DESK_DATA_CHANGED_EVENT, {
      detail: { scope, payload },
    }),
  )
}

/** 订阅某一类数据变化；scope 省略表示订阅全部。返回取消函数。 */
export function onDeskData<T = unknown>(
  scope: DeskDataScope | null,
  handler: (payload: T, scope: DeskDataScope) => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<DeskDataDetail<T>>).detail
    if (!detail) return
    if (scope === null || detail.scope === scope) {
      handler(detail.payload as T, detail.scope)
    }
  }
  window.addEventListener(DESK_DATA_CHANGED_EVENT, listener)
  return () => window.removeEventListener(DESK_DATA_CHANGED_EVENT, listener)
}

/** 悬停目标：卡册 / 背包 / 卡组第 N 槽（null = 没有目标） */
export type DeskHoverTarget = "album" | "backpack" | "deck"

export interface DeskHoverDetail {
  target: DeskHoverTarget
  /** album / backpack 用 boolean；deck 用槽位号（null = 离开） */
  value: boolean | number | null
}

export function emitDeskHover(target: DeskHoverTarget, value: boolean | number | null) {
  window.dispatchEvent(
    new CustomEvent<DeskHoverDetail>(DESK_HOVER_EVENT, { detail: { target, value } }),
  )
}

export function onDeskHover(
  target: DeskHoverTarget,
  handler: (value: boolean | number | null) => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<DeskHoverDetail>).detail
    if (detail?.target === target) handler(detail.value)
  }
  window.addEventListener(DESK_HOVER_EVENT, listener)
  return () => window.removeEventListener(DESK_HOVER_EVENT, listener)
}
