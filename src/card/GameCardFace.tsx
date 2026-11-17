import { CardFaceB } from "./CardFaceB"
import type { CardFaceData, CardFaceMode } from "./types"

interface Props {
  card: CardFaceData
  mode?: CardFaceMode
  className?: string
  /** 书里的邻页提前加载，避免翻过去时才开始请求插画 */
  eager?: boolean
}

/**
 * 游戏里所有显示卡面的地方（卡册、图鉴、卡组、桌面、开包、背包、详情、市场、战斗、账号）都用这一张：
 * 当前是 B v2 · 大元素，暗色，MOD 摆在名字后面。换游戏卡面改这里，
 * 同时把 faces/ 里对应版本的 faceMeta.inGame 挪过去（实验室靠它排第一）。
 */
export function GameCardFace(props: Props) {
  return <CardFaceB {...props} tone="dark" mods="name" version="v2" />
}
