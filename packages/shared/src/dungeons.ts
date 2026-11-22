/**
 * 资源副本：消耗体力，产出精华 / 金币 / 卡包 / 物品。
 * 先做几个最基础的资源口，后续再加难度与掉落表。
 */

import type { ItemStack } from "./items"

export interface DungeonRewards {
  essence?: number
  coins?: number
  /** 普通卡包数量 */
  packs?: number
  items?: ItemStack[]
}

export interface DungeonDef {
  id: string
  name: string
  summary: string
  /** 体力消耗 */
  cost: number
  rewards: DungeonRewards
}

export const DUNGEONS: DungeonDef[] = [
  {
    id: "exp",
    name: "练习室",
    summary: "只产经验乐谱，比喂卡更省：一次 3,200 经验。",
    cost: 20,
    rewards: {
      items: [
        { itemId: "exp-medium", count: 3 },
        { itemId: "exp-small", count: 1 },
      ],
    },
  },
  {
    id: "essence",
    name: "精华回廊",
    summary: "稳定的精华来源，用来给卡镀闪。",
    cost: 20,
    rewards: { essence: 50 },
  },
  {
    id: "coins",
    name: "金币矿脉",
    summary: "少量金币，补市场交易的零钱。",
    cost: 20,
    rewards: { coins: 200 },
  },
  {
    id: "packs",
    name: "卡包补给",
    summary: "用体力换 1 个普通卡包，不触发保底。",
    cost: 60,
    rewards: { packs: 1 },
  },
]

export function dungeonById(id: string): DungeonDef | undefined {
  return DUNGEONS.find((dungeon) => dungeon.id === id)
}
