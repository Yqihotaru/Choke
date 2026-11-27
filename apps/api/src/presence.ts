import { eq, sql } from "drizzle-orm"

import { IDLE_PACKS_DAILY_LIMIT, IDLE_SECONDS_PER_PACK, ONLINE_TIMEOUT_MS } from "@choke/shared/presence"
import { resetDayKey } from "@choke/shared/reset"

import { db } from "./db/client"
import { users } from "./db/schema"
import type { Tx } from "./tx"

/**
 * 记一次心跳：把"距上一次心跳的间隔"计入今天的在线秒数。
 * 整个过程是一条 UPDATE，行锁保证多个标签页同时发心跳也不会重复计时。
 * - 间隔超过 ONLINE_TIMEOUT_MS 说明中间离线了，这次不计时；
 * - 换了重置日（北京时间 4:00）累计清零；
 * - 累计封顶在每日额度对应的秒数，之后只更新最后在线时间。
 * 返回今天累计的在线秒数；用户不存在返回 null。
 */
export async function recordBeat(
  userId: string,
  now: number = Date.now(),
  executor: Tx | typeof db = db,
): Promise<{ onlineDay: string; onlineSeconds: number } | null> {
  const day = resetDayKey(now)
  const nowIso = new Date(now).toISOString()
  const capSeconds = IDLE_PACKS_DAILY_LIMIT * IDLE_SECONDS_PER_PACK
  const gapCap = ONLINE_TIMEOUT_MS / 1000

  const [row] = await executor
    .update(users)
    .set({
      onlineSeconds: sql`least(
        case when ${users.onlineDay} = ${day} then ${users.onlineSeconds} else 0 end
        + (case when extract(epoch from (${nowIso}::timestamptz - ${users.lastSeenAt})) between 0 and ${gapCap}
          then extract(epoch from (${nowIso}::timestamptz - ${users.lastSeenAt}))::int else 0 end),
        ${capSeconds}
      )`,
      onlineDay: day,
      lastSeenAt: sql`greatest(${users.lastSeenAt}, ${nowIso}::timestamptz)`,
    })
    .where(eq(users.id, userId))
    .returning({ onlineDay: users.onlineDay, onlineSeconds: users.onlineSeconds })

  if (!row) return null
  return { onlineDay: row.onlineDay ?? day, onlineSeconds: row.onlineSeconds }
}

/** 今天（当前重置日）已累计的在线秒数；记录是前一天的就是 0 */
export function onlineSecondsToday(
  user: { onlineDay: string | null; onlineSeconds: number },
  now: number = Date.now(),
): number {
  return user.onlineDay === resetDayKey(now) ? user.onlineSeconds : 0
}
