import { and, eq, inArray, sql } from "drizzle-orm"

import { investedExp, isHeroCardId, totalExpAtLevel, levelCap } from "@choke/shared/progression"
import type { Rarity } from "@choke/shared/types"

import { cards, userCards, users } from "./db/schema"
import { recordLedger, type LedgerSource } from "./ledger"
import type { Tx } from "./tx"

/** 这张卡还能吃多少经验才到满级；满级为 0 */
export function expRoomOf(card: { cardId: string; level: number; exp: number; rarity: string }): number {
  const hero = isHeroCardId(card.cardId)
  const total = totalExpAtLevel(levelCap(hero), card.rarity as Rarity, hero)
  return Math.max(0, total - investedExp(card.level, card.exp, card.rarity as Rarity, hero))
}

/**
 * 途中经验：给一批卡每张各加 amount，超过满级的部分作废。必须在事务里调用，调用方已经 lockUser。
 * 经验直接记在卡上，不进经验池，也不写流水（流水只记账号级资产）。
 */
export async function addCardExperience(
  tx: Tx,
  userId: string,
  userCardIds: readonly number[],
  amount: number,
): Promise<void> {
  if (amount <= 0 || userCardIds.length === 0) return
  const rows = await tx
    .select({
      id: userCards.id,
      cardId: userCards.cardId,
      level: userCards.level,
      exp: userCards.exp,
      rarity: cards.rarity,
    })
    .from(userCards)
    .innerJoin(cards, eq(cards.id, userCards.cardId))
    .where(and(eq(userCards.userId, userId), inArray(userCards.id, [...userCardIds])))
  for (const row of rows) {
    const gain = Math.min(amount, expRoomOf(row))
    if (gain <= 0) continue
    await tx
      .update(userCards)
      .set({ exp: sql`${userCards.exp} + ${gain}` })
      .where(eq(userCards.id, row.id))
  }
}

/** 往经验池里存经验，并写流水。必须在事务里调用，调用方已经 lockUser */
export async function addExpPool(tx: Tx, userId: string, amount: number, origin: LedgerSource): Promise<void> {
  if (amount <= 0) return
  await tx
    .update(users)
    .set({ expPool: sql`${users.expPool} + ${amount}` })
    .where(eq(users.id, userId))
  await recordLedger(tx, userId, [{ kind: "expPool", delta: amount }], origin)
}
