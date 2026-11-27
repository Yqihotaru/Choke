import { eq, sql } from "drizzle-orm"

import type { MailAttachment } from "@choke/shared/mail"

import { users, userPacks } from "./db/schema"
import { grantCard } from "./gacha/open"
import { grantItems, mergeStacks } from "./items"
import { recordLedger, type LedgerEntryInput, type LedgerSource } from "./ledger"
import { PACK_POOLS, type PackPoolId } from "./packs/inventory"
import { TxAbort, type Tx } from "./tx"

/**
 * 把一份附件发给玩家，并写流水。必须在事务里调用，且调用方已经 lockUser。
 * 附件里有不认识的卡包 / 卡时直接抛错，整笔事务回滚，什么都不会发出去。
 */
export async function grantAttachment(
  tx: Tx,
  userId: string,
  attachment: MailAttachment,
  origin: LedgerSource,
): Promise<void> {
  const ledger: LedgerEntryInput[] = []

  const coins = attachment.coins ?? 0
  const essence = attachment.essence ?? 0
  if (coins > 0 || essence > 0) {
    await tx
      .update(users)
      .set({ coins: sql`${users.coins} + ${coins}`, essence: sql`${users.essence} + ${essence}` })
      .where(eq(users.id, userId))
    ledger.push({ kind: "coins", delta: coins }, { kind: "essence", delta: essence })
  }

  const items = mergeStacks(attachment.items ?? [])
  if (items.length > 0) {
    await grantItems(tx, userId, items)
    for (const { itemId, count } of items) ledger.push({ kind: "item", ref: itemId, delta: count })
  }

  for (const { pool, count } of attachment.packs ?? []) {
    if (!(PACK_POOLS as readonly string[]).includes(pool)) {
      throw new TxAbort(400, "unknown_pack", `附件里有不存在的卡包：${pool}`)
    }
    await tx
      .insert(userPacks)
      .values({ userId, pool: pool as PackPoolId, count })
      .onConflictDoUpdate({
        target: [userPacks.userId, userPacks.pool],
        set: { count: sql`${userPacks.count} + ${count}` },
      })
    ledger.push({ kind: "pack", ref: pool, delta: count })
  }

  const sortedCards = [...(attachment.cards ?? [])].sort((a, b) => a.cardId.localeCompare(b.cardId))
  for (const { cardId, count, foil } of sortedCards) {
    for (let i = 0; i < count; i += 1) {
      let granted
      try {
        granted = await grantCard(tx, { userId, cardId, foil })
      } catch (error) {
        throw new TxAbort(400, "unknown_card", error instanceof Error ? error.message : "附件里有不存在的卡")
      }
      ledger.push({ kind: "card", ref: cardId, delta: 1, userCardId: granted.userCardId })
    }
  }

  await recordLedger(tx, userId, ledger, origin)
}
