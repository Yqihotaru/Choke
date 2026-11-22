import { CONTENT, type ItemId, type ItemStack } from "./content"
import { RARITIES, type Rarity } from "./types"

/**
 * 物品：碎片（每个品质一种）和经验道具，定义在 content/items.json。
 * 数量存在 user_items(user_id, item_id, count)。
 * 碎片既是材料也能当经验喂任何卡；经验道具只从经验本和返还里来，只能当经验用。
 */

export type { ItemId, ItemStack }
export type ShardItemId = Extract<ItemId, `shard-${string}`>
export type ExpItemId = Extract<ItemId, `exp-${string}`>

export interface ItemDef {
  id: ItemId
  name: string
  kind: "shard" | "exp"
  /** 当经验喂卡时值多少 */
  exp: number
  rarity?: Rarity
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

export const SHARD_EXP: Record<Rarity, number> = Object.fromEntries(
  SHARD_ITEMS.map((item) => [item.rarity, item.exp]),
) as Record<Rarity, number>

/** 按单价从大到小（expToItems 的贪心拆分依赖这个顺序） */
export const EXP_ITEMS: readonly ItemDef[] = Object.values(ITEMS)
  .filter((item) => item.kind === "exp")
  .sort((a, b) => b.exp - a.exp)

export function isItemId(id: string): id is ItemId {
  return Object.hasOwn(ITEMS, id)
}

/** 把一笔经验拆成经验道具（从大到小贪心），不足最小档的尾数舍去 */
export function expToItems(exp: number): ItemStack[] {
  const result: ItemStack[] = []
  let left = Math.max(0, Math.floor(exp))
  for (const item of EXP_ITEMS) {
    const count = Math.floor(left / item.exp)
    if (count > 0) {
      result.push({ itemId: item.id, count })
      left -= count * item.exp
    }
  }
  return result
}
