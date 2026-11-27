import { eq, sql } from "drizzle-orm"

import { db } from "./db/client"
import { users } from "./db/schema"
import type { Tx } from "./tx"

/**
 * 记一次心跳：只把“最后在线时间”往前推（多个标签页同时发也不会倒退）。
 * 用户不存在返回 false。
 */
export async function recordBeat(
  userId: string,
  now: number = Date.now(),
  executor: Tx | typeof db = db,
): Promise<boolean> {
  const nowIso = new Date(now).toISOString()
  const rows = await executor
    .update(users)
    .set({ lastSeenAt: sql`greatest(${users.lastSeenAt}, ${nowIso}::timestamptz)` })
    .where(eq(users.id, userId))
    .returning({ id: users.id })
  return rows.length > 0
}
