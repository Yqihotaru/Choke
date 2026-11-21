import type { PointerEvent } from "react"
import type { CardFaceData } from "@/card/types"

import type { CardData, PackPool } from "./types"

/** 事件名统一定义在 events.ts，这里转出以保持既有 import 不变。 */
export {
  CARD_POINTER_DROP_EVENT,
  CARD_POINTER_START_EVENT,
  DESK_ADD_CARDS_EVENT,
  DESK_HOVER_EVENT,
  DESK_ITEMS_EVENT,
  DECK_ASSIGN_EVENT,
  GACHA_OPEN_EVENT,
  PACKS_CHANGED_EVENT,
  type DeskHoverDetail,
  type DeskHoverTarget,
} from "./events"

import { CARD_POINTER_START_EVENT } from "./events"

export interface GachaOpenDetail {
  /** 开包结果只属于发起请求时的账号；桌面必须拒绝其他账号的迟到事件 */
  userId: string
  cards: CardData[]
  pool: PackPool
  rect?: { left: number; top: number; width: number; height: number }
}

export function toDeskCard(card: CardFaceData, userCardId?: number): CardData {
  return {
    cardId: card.id,
    userCardId,
    face: card,
    name: card.name,
    mapper: card.name,
    rarity: card.rarity,
    art: card.art,
    banner: card.banner,
    foil: card.foil,
    isHero: card.id.startsWith("hero-"),
  }
}

export interface CardDragPayload {
  userCardId?: number
  fromSlot?: number
  card?: CardData
}

export interface CardPointerStart {
  source: HTMLElement
  pointerId: number
  x: number
  y: number
  payload: CardDragPayload
  onStart?: () => void
  onFinish?: () => void
  onDrop?: () => void
}

export interface CardPointerDrop {
  payload: CardDragPayload
  x: number
  y: number
}

/** 按下先记住来源，越过阈值才抬卡；普通点击仍交给原来的详情/选槽处理。 */
export function startCardPointerDrag(
  event: PointerEvent<HTMLElement>,
  payload: CardDragPayload,
  callbacks: Pick<CardPointerStart, "onStart" | "onFinish" | "onDrop"> = {},
) {
  if (event.button !== 0 || !event.isPrimary) return
  if (event.target instanceof Element && event.target.closest("button, a, input, select, textarea")) return
  event.preventDefault()
  event.stopPropagation()
  event.currentTarget.dispatchEvent(new CustomEvent<CardPointerStart>(CARD_POINTER_START_EVENT, {
    bubbles: true,
    detail: {
      source: event.currentTarget,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      payload,
      ...callbacks,
    },
  }))
}
