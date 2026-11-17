import type { ComponentType } from "react"

import type { CardFaceData, CardFaceMode } from "../types"

export interface CardFaceProps {
  card: CardFaceData
  mode?: CardFaceMode
  theme?: "dark" | "light"
  modPlacement?: "spine" | "portrait" | "name"
  className?: string
}

export interface CardFaceMeta {
  id: string
  label: string
  note?: string
  order?: number
  /** 这个卡面是否响应 theme="light" */
  supportsTheme?: boolean
  /** 这个卡面是否支持三种 MOD 位置 */
  supportsModPlacement?: boolean
}

interface FaceModule {
  default: ComponentType<CardFaceProps>
  faceMeta: CardFaceMeta
}

const modules = import.meta.glob<FaceModule>("./*.tsx", { eager: true })

/** 自动收集 faces/ 下每个带 faceMeta + default 的卡面。新增一个版本只需丢一对 tsx/css。 */
export const CARD_FACES = Object.values(modules)
  .filter((mod): mod is FaceModule => Boolean(mod.faceMeta && mod.default))
  .sort((a, b) => (a.faceMeta.order ?? 100) - (b.faceMeta.order ?? 100))
  .map((mod) => ({ ...mod.faceMeta, Component: mod.default }))

export const DEFAULT_FACE = CARD_FACES[0]

export function getCardFace(id: string) {
  return CARD_FACES.find((face) => face.id === id) ?? DEFAULT_FACE
}
