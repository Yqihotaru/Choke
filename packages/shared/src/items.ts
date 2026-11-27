import { CONTENT, type ItemId, type ItemStack } from "./content"
import { RARITIES, type Rarity } from "./types"

/**
 * 物品：目前只有碎片（每个品质一种），定义在 content/items.json。
 * 数量存在 user_items(user_id, item_id, count)。
 */

export type { ItemId, ItemStack }
export type ShardItemId = Extract<ItemId, `shard-${string}`>

export interface ItemDef {
  id: ItemId
  name: string
  kind: "shard"
  rarity: Rarity
}

export const ITEMS: Readonly<Record<ItemId, ItemDef>> = Object.fromEntries(
  Object.entries(CONTENT.items).map(([id, item]) => [id, { id, ...item }]),
) as Record<ItemId, ItemDef>

/** 分解一张卡得到的同品质碎片个数 */
export const SHARDS_PER_DISMANTLE = CONTENT.progression.card.shardsPerDismantle

export function shardItemId(rarity: Rarity): ShardItemId {
  // content schema 保证每个品质都有 shard-<品质>
  return `shard-${rarity}` as ShardItemId
}

/** 按品质从低到高 */
export const SHARD_ITEMS: readonly ItemDef[] = RARITIES.map((rarity) => ITEMS[shardItemId(rarity)])

export function isItemId(id: string): id is ItemId {
  return Object.hasOwn(ITEMS, id)
}
