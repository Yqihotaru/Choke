import type { PackPool, Rarity } from "./types"

/** 跟卡框线条一致：石墨 / 翡翠 / 钢蓝 / 紫 / 金 / 银 / 镭射（单色场合用近白色） */
export const RARITY_COLOR: Record<Rarity, string> = {
  C: "#9A9AA0",
  UC: "#5FA679",
  R: "#5D8CC4",
  E: "#9B74DA",
  L: "#D8B24E",
  Radiant: "#C3C9D2",
  Prismatic: "#F4F4F6",
}

/** UI 侧的卡池展示信息。权重/保底/每包张数由 API 的 GET /config 提供。 */
export interface PoolMeta {
  label: string
  short: string
  color: string
}

export const POOL_META: Record<PackPool, PoolMeta> = {
  normal: { label: "普通卡池", short: "普通", color: "#E5484D" },
  idle: { label: "挂机卡池", short: "挂机", color: "#3CBADB" },
  golden: { label: "黄金卡池", short: "黄金", color: "#FFC24B" },
  radiant: { label: "璀璨卡池", short: "璀璨", color: "#B98CFF" },
  sky: { label: "天穹卡池", short: "天穹", color: "#21E985" },
  prism: { label: "棱彩卡池", short: "棱彩", color: "#F4F4F6" },
}

export const POOL_ORDER: PackPool[] = [
  "normal",
  "idle",
  "golden",
  "radiant",
  "sky",
  "prism",
]
