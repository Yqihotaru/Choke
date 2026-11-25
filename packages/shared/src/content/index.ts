import { prettifyError } from "zod"

import dungeonsRaw from "../../../../content/dungeons.json" with { type: "json" }
import economyRaw from "../../../../content/economy.json" with { type: "json" }
import itemsRaw from "../../../../content/items.json" with { type: "json" }
import packsRaw from "../../../../content/packs.json" with { type: "json" }
import progressionRaw from "../../../../content/progression.json" with { type: "json" }
import shopRaw from "../../../../content/shop.json" with { type: "json" }
import unlocksRaw from "../../../../content/unlocks.json" with { type: "json" }
import type { Rarity } from "../types"
import { MYSTERY_PACK_ID, contentSchema, type ContentData } from "./schema"

export { MYSTERY_PACK_ID }

/**
 * content/ 的唯一入口。模块加载时整体校验一次：结构不对或引用断了直接抛错，
 * 服务端因此拒绝启动，`pnpm content:check` 也会失败。
 *
 * id 类型取自 JSON 的键（TypeScript 会保留成字面量），所以写错 id 在编译期就能发现。
 */

/** 已接入的内容文件（相对 content/）。和上面的 import 保持一致；服务端据此发现没接入的文件 */
export const CONTENT_FILES = [
  "dungeons.json",
  "economy.json",
  "items.json",
  "packs.json",
  "progression.json",
  "shop.json",
  "unlocks.json",
] as const

export type FeatureId = keyof typeof unlocksRaw
export type ItemId = keyof typeof itemsRaw
export type DungeonId = keyof typeof dungeonsRaw
export type PackId = keyof typeof packsRaw.packs
export type ShopItemId = keyof typeof shopRaw

export interface ItemStack {
  itemId: ItemId
  count: number
}

type Data = ContentData
type DungeonData = Data["dungeons"][string]
type PackData = Data["packs"]["packs"][string]

export interface Content {
  progression: Data["progression"]
  items: Record<ItemId, Data["items"][string]>
  dungeons: Record<
    DungeonId,
    Omit<DungeonData, "rewards"> & {
      rewards: Omit<DungeonData["rewards"], "items"> & { items?: ItemStack[] }
    }
  >
  economy: Data["economy"]
  unlocks: Record<FeatureId, Data["unlocks"][string]>
  shop: Record<ShopItemId, Data["shop"][string]>
  packs: Omit<Data["packs"], "packs" | "starterGrant" | "starterGuarantee"> & {
    packs: Record<PackId, PackData>
    starterGrant: Partial<Record<PackId | typeof MYSTERY_PACK_ID, number>>
    starterGuarantee: { pool: PackId; rarity: Rarity }
  }
}

function load(): Content {
  const result = contentSchema.safeParse({
    progression: progressionRaw,
    items: itemsRaw,
    dungeons: dungeonsRaw,
    economy: economyRaw,
    packs: packsRaw,
    unlocks: unlocksRaw,
    shop: shopRaw,
  })
  if (!result.success) {
    throw new Error(`content/ 校验失败：\n${prettifyError(result.error)}`)
  }
  // 引用已在 schema 里逐个核对过，这里只是把 string 收窄成 JSON 键的字面量类型
  return result.data as unknown as Content
}

export const CONTENT: Content = load()
