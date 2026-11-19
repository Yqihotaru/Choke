import { CardFaceB2 } from "../CardFaceB2"
import type { CardFaceProps } from "./index"

export const faceMeta = {
  id: "b-v3",
  label: "B v3 · 游戏版",
  note: "本体徽章 / 断图回退 / 100px 容器查询",
  order: 72,
  supportsTheme: true,
  supportsModPlacement: true,
  inGame: true,
} as const

export default function CardFaceBV3({ theme, modPlacement, ...props }: CardFaceProps) {
  return <CardFaceB2 {...props} tone={theme} mods={modPlacement} version="v2" />
}
