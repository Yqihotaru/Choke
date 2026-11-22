import { and, eq, gte, sql } from "drizzle-orm"

import { ITEMS, type ItemId, type ItemStack } from "@choke/shared/items"

import { db } from "./db/client"
import { userItems } from "./db/schema"
import { TxAbort, type Tx } from "./tx"

export type ItemWallet = Partial<Record<ItemId, number>>

/** 同一个 itemId 合并成一条，去掉 count ≤ 0 的 */
export function mergeStacks(stacks: readonly ItemStack[]): ItemStack[] {
  const merged = new Map<ItemId, number>()
  for (const { itemId, count } of stacks) {
    if (count > 0) merged.set(itemId, (merged.get(itemId) ?? 0) + count)
  }
  return [...merged].map(([itemId, count]) => ({ itemId, count }))
}

export async function loadItems(userId: string, executor: Tx | typeof db = db): Promise<ItemWallet> {
  const rows = await executor
    .select({ itemId: userItems.itemId, count: userItems.count })
    .from(userItems)
    .where(eq(userItems.userId, userId))
  const wallet: ItemWallet = {}
  for (const row of rows) {
    if (row.count > 0 && Object.hasOwn(ITEMS, row.itemId)) wallet[row.itemId as ItemId] = row.count
  }
  return wallet
}

export async function grantItems(tx: Tx, userId: string, stacks: readonly ItemStack[]) {
  for (const { itemId, count } of mergeStacks(stacks)) {
    await tx
      .insert(userItems)
      .values({ userId, itemId, count })
      .onConflictDoUpdate({
        target: [userItems.userId, userItems.itemId],
        set: { count: sql`${userItems.count} + ${count}` },
      })
  }
}

/** 扣物品；任何一项不够就抛 TxAbort，整笔事务回滚 */
export async function spendItems(tx: Tx, userId: string, stacks: readonly ItemStack[]) {
  for (const { itemId, count } of mergeStacks(stacks)) {
    const [row] = await tx
      .update(userItems)
      .set({ count: sql`${userItems.count} - ${count}` })
      .where(
        and(eq(userItems.userId, userId), eq(userItems.itemId, itemId), gte(userItems.count, count)),
      )
      .returning({ count: userItems.count })
    if (!row) {
      const [have] = await tx
        .select({ count: userItems.count })
        .from(userItems)
        .where(and(eq(userItems.userId, userId), eq(userItems.itemId, itemId)))
        .limit(1)
      const owned = have?.count ?? 0
      throw new TxAbort(400, "not_enough_items", `${ITEMS[itemId].name} 不足：${owned} / ${count}`, {
        itemId,
        need: count,
        have: owned,
      })
    }
  }
}
