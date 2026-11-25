import { eq } from "drizzle-orm"

import { addPlayerExp } from "@choke/shared/player"

import { users } from "./db/schema"
import type { Tx } from "./tx"

/** 给玩家加经验并处理升级。必须在事务里调用，调用方已经 lockUser */
export async function addPlayerExperience(tx: Tx, userId: string, amount: number, now: number) {
  if (amount <= 0) return
  const [row] = await tx
    .select({ level: users.playerLevel, exp: users.playerExp })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!row) return
  const next = addPlayerExp({ level: row.level, exp: row.exp }, amount)
  await tx
    .update(users)
    .set({ playerLevel: next.level, playerExp: next.exp, progressUpdatedAt: now })
    .where(eq(users.id, userId))
}
