import { and, eq, gt, inArray } from "drizzle-orm"

import { db } from "../db/client"
import { expeditions, marketListings } from "../db/schema"
import type { Tx } from "../tx"

type Exec = Tx | typeof db

/**
 * 出征期间被锁住的卡：所有未结束出征的卡池。
 * 这些卡不能出售、分解、被喂、被融合吃掉。已经过了到期时间但还没被结算的出征不算（它随时会被结算掉）。
 */
export async function lockedUserCardIds(exec: Exec, userId: string, now = Date.now()): Promise<Set<number>> {
  const rows = await exec
    .select({ pool: expeditions.pool })
    .from(expeditions)
    .where(
      and(
        eq(expeditions.userId, userId),
        inArray(expeditions.status, ["active", "suspended"]),
        gt(expeditions.expiresAt, new Date(now)),
      ),
    )
  const ids = new Set<number>()
  for (const row of rows) for (const card of row.pool) ids.add(card.userCardId)
  return ids
}

export const EXPEDITION_LOCK_MESSAGE = "这张卡正在出征中，结束出征后才能操作"

/** 这批卡里有没有正在出征的 */
export async function anyLocked(exec: Exec, userId: string, userCardIds: readonly number[]): Promise<boolean> {
  if (userCardIds.length === 0) return false
  const locked = await lockedUserCardIds(exec, userId)
  return userCardIds.some((id) => locked.has(id))
}

/** 在架的市场单对应的卡（出征选卡时要排除） */
export async function listedUserCardIds(exec: Exec, userCardIds: readonly number[]): Promise<Set<number>> {
  if (userCardIds.length === 0) return new Set()
  const rows = await exec
    .select({ id: marketListings.userCardId })
    .from(marketListings)
    .where(and(inArray(marketListings.userCardId, [...userCardIds]), eq(marketListings.status, "active")))
  return new Set(rows.map((row) => row.id))
}
