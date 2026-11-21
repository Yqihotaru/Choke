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

/** 卡包库存变化 */
export const PACKS_CHANGED_EVENT = "choke:packs-changed"
/** 把卡片直接发到桌面 */
export const DESK_ADD_CARDS_EVENT = "choke:desk-add-cards"
/** 桌面上的 user_card id 列表变化 */
export const DESK_ITEMS_EVENT = "choke:desk-items"
/** 卡组槽位分配 */
export const DECK_ASSIGN_EVENT = "choke:deck-assign"

/** 抽卡面板开出卡后交给桌面播放开包动画 */
export const GACHA_OPEN_EVENT = "choke:gacha-open"

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
