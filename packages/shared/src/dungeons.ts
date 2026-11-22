/**
 * 资源副本：消耗体力，产出精华 / 金币 / 卡包 / 物品。定义在 content/dungeons.json。
 */

import { CONTENT, type Content, type DungeonId } from "./content"

export type { DungeonId }

export type DungeonRewards = Content["dungeons"][DungeonId]["rewards"]

export interface DungeonDef {
  id: DungeonId
  name: string
  summary: string
  /** 体力消耗 */
  cost: number
  rewards: DungeonRewards
}

export const DUNGEONS: DungeonDef[] = Object.entries(CONTENT.dungeons).map(([id, dungeon]) => ({
  id: id as DungeonId,
  ...dungeon,
}))

export function dungeonById(id: string): DungeonDef | undefined {
  return DUNGEONS.find((dungeon) => dungeon.id === id)
}
