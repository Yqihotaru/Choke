import { CardFaceB } from "../../card/CardFaceB"
import type { CardFaceProps } from "./index"

export const faceMeta = {
  id: "b-v2",
  label: "B v2 · 大元素",
  note: "侧栏 / 明暗主题 / MOD 三种摆法",
  order: 71,
  supportsTheme: true,
  supportsModPlacement: true,
  inGame: true,
} as const

export default function CardFaceBV2({ theme, modPlacement, ...props }: CardFaceProps) {
  return <CardFaceB {...props} tone={theme} mods={modPlacement} version="v2" />
}
