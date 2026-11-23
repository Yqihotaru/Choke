import { sql } from "drizzle-orm"

import { periodKey } from "@choke/shared/reset"
import { questCounts, type QuestEvent } from "@choke/shared/quests"

import { QUEST_CONTENT } from "./content"
import type { db } from "./db/client"
import { questProgress } from "./db/schema"
import type { Tx } from "./tx"

/** 只依赖内容和进度表，不碰邮件和发奖，这样开包、喂养这些底层动作可以放心 import */
export const QUESTS = Object.entries(QUEST_CONTENT.quests)

/**
 * 记一笔进度：在发生动作的同一个事务里调用，动作回滚进度也一起回滚。
 * 每条匹配的任务一次 upsert，进度封顶在目标数；已经领过的任务继续累加到封顶也没有副作用。
 */
export async function recordQuestEvent(
  tx: Tx | typeof db,
  userId: string,
  event: QuestEvent,
  options: { amount?: number; mapKind?: string; now?: number } = {},
): Promise<void> {
  const amount = options.amount ?? 1
  if (amount <= 0) return
  const now = options.now ?? Date.now()
  for (const [questId, def] of QUESTS) {
    if (!questCounts(def, event, options.mapKind)) continue
    await tx
      .insert(questProgress)
      .values({ userId, questId, periodKey: periodKey(def.period, now), progress: Math.min(def.target, amount) })
      .onConflictDoUpdate({
        target: [questProgress.userId, questProgress.questId, questProgress.periodKey],
        set: {
          progress: sql`LEAST(${def.target}::int, ${questProgress.progress} + ${amount})`,
          updatedAt: sql`now()`,
        },
      })
  }
}
