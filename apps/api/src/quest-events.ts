import { sql } from "drizzle-orm"

import { isMaxEvent, questCounts, questPeriodKey, type QuestEvent } from "@choke/shared/quests"

import { QUEST_CONTENT } from "./content"
import type { db } from "./db/client"
import { questProgress } from "./db/schema"
import type { Tx } from "./tx"

/** 只依赖内容和进度表，不碰邮件和发奖，这样开包、喂养这些底层动作可以放心 import */
export const QUESTS = Object.entries(QUEST_CONTENT.quests)

export interface QuestEventOptions {
  /** 累加类事件：这次加几（默认 1） */
  amount?: number
  /** 取最大值类事件（等级、命座、档位）：这次达到的值 */
  value?: number
  mapKind?: string
  mapId?: string
  /** 获得卡牌事件：这张卡的稀有度 */
  rarity?: string
  now?: number
}

/**
 * 记一笔进度：在发生动作的同一个事务里调用，动作回滚进度也一起回滚。
 * 每条匹配的任务一次 upsert，进度封顶在目标数；已经领过的任务继续记到封顶也没有副作用。
 * 累加类事件按 amount 加；取最大值类事件按 value 取较大者。
 */
export async function recordQuestEvent(
  tx: Tx | typeof db,
  userId: string,
  event: QuestEvent,
  options: QuestEventOptions = {},
): Promise<void> {
  const max = isMaxEvent(event)
  const amount = max ? (options.value ?? 0) : (options.amount ?? 1)
  if (amount <= 0) return
  const now = options.now ?? Date.now()
  for (const [questId, def] of QUESTS) {
    if (!questCounts(def, event, options)) continue
    await tx
      .insert(questProgress)
      .values({ userId, questId, periodKey: questPeriodKey(def.period, now), progress: Math.min(def.target, amount) })
      .onConflictDoUpdate({
        target: [questProgress.userId, questProgress.questId, questProgress.periodKey],
        set: {
          progress: max
            ? sql`LEAST(${def.target}::int, GREATEST(${questProgress.progress}, ${amount}::int))`
            : sql`LEAST(${def.target}::int, ${questProgress.progress} + ${amount})`,
          updatedAt: sql`now()`,
        },
      })
  }
}
