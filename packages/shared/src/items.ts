import { FEED_EXP } from "./progression"
import { RARITIES, type Rarity } from "./types"

/**
 * 物品：碎片（7 档，按品质）和经验道具。数量存在 user_items(user_id, item_id, count)。
 * 碎片既是材料也能当经验喂任何卡；经验道具只从经验本和返还里来，只能当经验用。
 */

export type ShardItemId = `shard-${Rarity}`
export type ExpItemId = "exp-small" | "exp-medium" | "exp-large"
export type ItemId = ShardItemId | ExpItemId

export interface ItemDef {
  id: ItemId
  name: string
  kind: "shard" | "exp"
  /** 当经验喂卡时值多少 */
  exp: number
  rarity?: Rarity
}

/** 分解一张卡得到的同品质碎片个数 */
export const SHARDS_PER_DISMANTLE = 4

/** 碎片的经验 = 喂养值 × 80% ÷ 4 = 喂养值 ÷ 5：分解再喂比直接喂少 20% */
export const SHARD_EXP: Record<Rarity, number> = Object.fromEntries(
  RARITIES.map((rarity) => [rarity, FEED_EXP[rarity] / 5]),
) as Record<Rarity, number>

export const EXP_ITEMS: readonly ItemDef[] = [
  { id: "exp-large", name: "经验乐谱 · 大", kind: "exp", exp: 5000 },
  { id: "exp-medium", name: "经验乐谱 · 中", kind: "exp", exp: 1000 },
  { id: "exp-small", name: "经验乐谱 · 小", kind: "exp", exp: 200 },
]

export function shardItemId(rarity: Rarity): ShardItemId {
  return `shard-${rarity}`
}

export const SHARD_ITEMS: readonly ItemDef[] = RARITIES.map((rarity) => ({
  id: shardItemId(rarity),
  name: `${rarity} 碎片`,
  kind: "shard" as const,
  exp: SHARD_EXP[rarity],
  rarity,
}))

export const ITEMS: Readonly<Record<ItemId, ItemDef>> = Object.fromEntries(
  [...SHARD_ITEMS, ...EXP_ITEMS].map((item) => [item.id, item]),
) as Record<ItemId, ItemDef>

export function isItemId(id: string): id is ItemId {
  return Object.hasOwn(ITEMS, id)
}

export interface ItemStack {
  itemId: ItemId
  count: number
}

/** 把一笔经验拆成大/中/小经验道具（贪心），不足最小档的尾数舍去 */
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
