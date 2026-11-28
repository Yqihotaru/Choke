import { and, eq, gt, sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"

import { db } from "../db/client"
import { PACKS, STARTER_PACKS, MYSTERY_PACK, type PackId } from "../gacha/packs"
import { packTokens, userPacks } from "../db/schema"
import { recordLedger, type LedgerSource } from "../ledger"
import type { Tx } from "../tx"

export const PACK_POOLS = [...(Object.keys(PACKS) as PackId[]), MYSTERY_PACK.id] as const

export type PackPoolId = (typeof PACK_POOLS)[number]

export type PackCounts = Record<PackPoolId, number>

export async function getPackCounts(userId: string): Promise<PackCounts> {
  const rows = await db
    .select({ pool: userPacks.pool, count: userPacks.count })
    .from(userPacks)
    .where(eq(userPacks.userId, userId))

  const counts = Object.fromEntries(PACK_POOLS.map((pool) => [pool, 0])) as PackCounts
  for (const row of rows) {
    if (row.pool in counts) counts[row.pool as PackPoolId] = row.count
  }
  return counts
}

export async function addPacks(
  userId: string,
  grants: Partial<Record<PackPoolId, number>>,
  executor: Tx | typeof db = db,
): Promise<void> {
  for (const [pool, count] of Object.entries(grants)) {
    if (!count || count <= 0) continue
    await executor
      .insert(userPacks)
      .values({ userId, pool, count })
      .onConflictDoUpdate({
        target: [userPacks.userId, userPacks.pool],
        set: { count: sql`${userPacks.count} + ${count}` },
      })
  }
}

/** 发卡包并在同一个事务里写流水；传入 tx 时并入调用方的事务 */
export async function grantPacks(
  userId: string,
  grants: Partial<Record<PackPoolId, number>>,
  origin: LedgerSource,
  tx?: Tx,
): Promise<void> {
  const entries = Object.entries(grants).map(([pool, count]) => ({
    kind: "pack" as const,
    ref: pool,
    delta: count ?? 0,
  }))
  if (tx) {
    await addPacks(userId, grants, tx)
    await recordLedger(tx, userId, entries, origin)
    return
  }
  await db.transaction(async (inner) => {
    await addPacks(userId, grants, inner)
    await recordLedger(inner, userId, entries, origin)
  })
}

export async function consumePack(
  userId: string,
  pool: PackPoolId,
  executor: Tx | typeof db = db,
): Promise<boolean> {
  const updated = await executor
    .update(userPacks)
    .set({ count: sql`${userPacks.count} - 1` })
    .where(and(eq(userPacks.userId, userId), eq(userPacks.pool, pool), gt(userPacks.count, 0)))
    .returning({ count: userPacks.count })
  return updated.length > 0
}

/** 新号 OOBE 完成时发放：30 新手包 + 1 神秘卡包；传入 tx 时并入调用方的事务 */
export async function grantStarterPacks(userId: string, tx?: Tx): Promise<void> {
  await grantPacks(userId, STARTER_PACKS, { source: "starter" }, tx)
}

/** 把背包里的一个卡包“拿到桌面”：先扣库存，生成一次性 token。扣库存和发 token 在同一个事务里 */
export async function createPackToken(
  userId: string,
  pool: PackPoolId,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const consumed = await consumePack(userId, pool, tx)
    if (!consumed) return null
    const id = randomUUID()
    await tx.insert(packTokens).values({ id, userId, pool })
    return id
  })
}

/** 打开桌面卡包时核销 token，不再重复扣库存。 */
export async function consumePackToken(
  userId: string,
  token: string,
  pool: PackPoolId,
  executor: Tx | typeof db = db,
): Promise<boolean> {
  const removed = await executor
    .delete(packTokens)
    .where(
      and(
        eq(packTokens.id, token),
        eq(packTokens.userId, userId),
        eq(packTokens.pool, pool),
      ),
    )
    .returning({ id: packTokens.id })
  return removed.length > 0
}

/** 卡包从桌面扔回背包：核销 token 并把库存加回去。 */
export async function returnPackToken(
  userId: string,
  token: string,
): Promise<PackPoolId | null> {
  return db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(packTokens)
      .where(and(eq(packTokens.id, token), eq(packTokens.userId, userId)))
      .returning({ pool: packTokens.pool })
    if (!removed) return null
    const pool = removed.pool as PackPoolId
    await addPacks(userId, { [pool]: 1 }, tx)
    return pool
  })
}
