/**
 * 资源副本：消耗体力，产出精华 / 金币 / 卡包。
 * 先做三个最基础的资源口，后续再加难度与掉落表。
 */

export interface DungeonRewards {
  essence?: number
  coins?: number
  /** 普通卡包数量 */
  packs?: number
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
