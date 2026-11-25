/** 桌上的固定物件：只剩发牌按钮；功能入口在顶栏 / 底栏 */
export type DeskObjectId = "button"

export interface DeskObjectMeta {
  label: string
  sub: string
  /** 物件名，用在提示和无障碍标签里 */
  thing: string
  w: number
  h: number
  /** 默认位置：相对桌面宽高的比例 */
  x: number
  y: number
}

export const OBJECT_META: Record<DeskObjectId, DeskObjectMeta> = {
  button: { label: "发牌", sub: "DEAL", thing: "按钮", w: 124, h: 150, x: 0.45, y: 0.68 },
}

export const OBJECT_ORDER: DeskObjectId[] = ["button"]
