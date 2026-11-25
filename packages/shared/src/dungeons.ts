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
  /** 绑定的资源远征地图 id；配置后需首通才允许扫荡 */
  mapId?: string
  rewards: DungeonRewards
}

export const DUNGEONS: DungeonDef[] = Object.entries(CONTENT.dungeons).map(([id, dungeon]) => ({
  id: id as DungeonId,
  ...dungeon,
}))

export function dungeonById(id: string): DungeonDef | undefined {
  return DUNGEONS.find((dungeon) => dungeon.id === id)
}

export function dungeonByMapId(mapId: string): DungeonDef | undefined {
  return DUNGEONS.find((dungeon) => dungeon.mapId === mapId)
}
