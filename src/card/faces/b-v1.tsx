import { CardFaceB } from "../CardFaceB"
import type { CardFaceProps } from "./index"

export const faceMeta = {
  id: "b-v1",
  label: "B v1 · 放大前",
  note: "侧栏 / 明暗主题 / MOD 三种摆法",
  order: 70,
  supportsTheme: true,
  supportsModPlacement: true,
} as const

export default function CardFaceBV1({ theme, modPlacement, ...props }: CardFaceProps) {
  return <CardFaceB {...props} tone={theme} mods={modPlacement} version="v1" />
}
