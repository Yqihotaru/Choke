import { and, eq, inArray, like, or, sql, type SQL } from "drizzle-orm"

import { ITEMS } from "@choke/shared/items"
import type { MailAttachment, MailAttachmentLine } from "@choke/shared/mail"
import {
  QUEST_PERIODS,
  SIGN_IN_ID,
  daysInMonthKey,
  mergeQuestRewards,
  signInRewardFor,
  type QuestDef,
  type QuestReward,
  type QuestView,
  type QuestsOverview,
} from "@choke/shared/quests"
import { nextReset, periodKey, resetMonthDay, resetMonthKey } from "@choke/shared/reset"

import { QUEST_CONTENT } from "./content"
import { db } from "./db/client"
import { questProgress } from "./db/schema"
import { MYSTERY_PACK, PACKS } from "./gacha/packs"
import { sendMail } from "./mail"
import { QUESTS, recordQuestEvent } from "./quest-events"
import { grantAttachment } from "./rewards"
import { TxAbort, lockUser, type Tx } from "./tx"

type Exec = Tx | typeof db

const EXPIRED_SWEEP_LIMIT = 200

/** 奖励在 schema 里已经核对过物品和卡包都存在，这里只是换成发奖函数认的类型 */
const asAttachment = (reward: QuestReward) => reward as MailAttachment

// ---------- 读取 ----------

type Row = typeof questProgress.$inferSelect

/** 现在这一轮（今天 / 本周 / 本月）的进度行 */
async function currentRows(exec: Exec, userId: string, now: number, lock = false): Promise<Row[]> {
  const groups: SQL[] = []
  for (const period of QUEST_PERIODS) {
    const ids = QUESTS.filter(([, def]) => def.period === period).map(([questId]) => questId)
    if (ids.length === 0) continue
    groups.push(and(inArray(questProgress.questId, ids), eq(questProgress.periodKey, periodKey(period, now)))!)
  }
  if (groups.length === 0) return []
  const query = exec
    .select()
    .from(questProgress)
    .where(and(eq(questProgress.userId, userId), or(...groups)))
  return lock ? query.for("update") : query
}

function rewardLines(reward: QuestReward): MailAttachmentLine[] {
  const lines: MailAttachmentLine[] = []
  if (reward.coins) lines.push({ kind: "coins", label: "金币", count: reward.coins })
  if (reward.essence) lines.push({ kind: "essence", label: "闪卡精华", count: reward.essence })
  if (reward.stamina) lines.push({ kind: "stamina", label: "体力", count: reward.stamina })
  for (const { itemId, count } of reward.items ?? []) {
    lines.push({ kind: "item", label: ITEMS[itemId as keyof typeof ITEMS]?.name ?? itemId, count })
  }
  for (const { pool, count } of reward.packs ?? []) {
    const name = pool === MYSTERY_PACK.id ? MYSTERY_PACK.name : ((PACKS as Record<string, { name: string }>)[pool]?.name ?? pool)
    lines.push({ kind: "pack", label: name, count })
  }
  return lines
}

/** 总览：任务 + 签到 + 重置时间。读之前先把过期没领的奖励发到邮箱 */
export async function getQuests(userId: string, now = Date.now()): Promise<QuestsOverview> {
  try {
    await mailExpiredRewards(userId, now)
  } catch (error) {
    console.warn(`[quests] 过期任务奖励转邮件失败，下次再试：`, error)
  }

  const rows = await currentRows(db, userId, now)
  const byQuest = new Map(rows.map((row) => [row.questId, row]))

  const points = Object.fromEntries(QUEST_PERIODS.map((p) => [p, { earned: 0, total: 0 }])) as QuestsOverview["points"]
  const quests: QuestView[] = QUESTS.map(([questId, def]) => {
    const row = byQuest.get(questId)
    const progress = Math.min(def.target, row?.progress ?? 0)
    const claimed = row?.claimedAt != null
    points[def.period].total += def.points
    if (claimed) points[def.period].earned += def.points
    return {
      id: questId,
      period: def.period,
      name: def.name,
      desc: def.desc,
      target: def.target,
      progress,
      claimable: !claimed && progress >= def.target,
      claimed,
      rewards: rewardLines(def.rewards),
      points: def.points,
    }
  })

  const monthKey = resetMonthKey(now)
  const today = resetMonthDay(now)
  const signed = await db
    .select({ periodKey: questProgress.periodKey })
    .from(questProgress)
    .where(and(eq(questProgress.userId, userId), eq(questProgress.questId, SIGN_IN_ID), like(questProgress.periodKey, `${monthKey}-%`)))
  const signedSet = new Set(signed.map((row) => Number(row.periodKey.slice(8))))

  return {
    now: new Date(now).toISOString(),
    resets: Object.fromEntries(QUEST_PERIODS.map((p) => [p, new Date(nextReset(p, now)).toISOString()])) as QuestsOverview["resets"],
    quests,
    points,
    claimable: quests.filter((quest) => quest.claimable).length,
    signIn: {
      monthKey,
      today,
      signedToday: signedSet.has(today),
      signedDays: signedSet.size,
      days: Array.from({ length: daysInMonthKey(monthKey) }, (_, i) => {
        const day = i + 1
        return {
          day,
          rewards: rewardLines(signInRewardFor(QUEST_CONTENT.signIn, day)),
          signed: signedSet.has(day),
          special: Object.hasOwn(QUEST_CONTENT.signIn.bonus, String(day)),
        }
      }),
    },
  }
}

// ---------- 领奖 ----------

function questOrThrow(questId: string): QuestDef {
  const def = QUEST_CONTENT.quests[questId]
  if (!def) throw new TxAbort(404, "not_found", "没有这个任务")
  return def
}

async function claimRow(tx: Tx, userId: string, questId: string, row: Row, now: number): Promise<QuestReward> {
  const def = QUEST_CONTENT.quests[questId]!
  await grantAttachment(tx, userId, asAttachment(def.rewards), { source: "quest", sourceRef: `${questId}@${row.periodKey}` })
  await tx
    .update(questProgress)
    .set({ claimedAt: new Date(now), updatedAt: new Date(now) })
    .where(and(eq(questProgress.userId, userId), eq(questProgress.questId, questId), eq(questProgress.periodKey, row.periodKey)))
  return def.rewards
}

/** 领一条任务的奖励：事务里先锁用户再查进度，重复点、同时点都只会发一次 */
export async function claimQuest(userId: string, questId: string, now = Date.now()) {
  const def = questOrThrow(questId)
  return db.transaction(async (tx) => {
    await lockUser(tx, userId)
    const [row] = await tx
      .select()
      .from(questProgress)
      .where(
        and(
          eq(questProgress.userId, userId),
          eq(questProgress.questId, questId),
          eq(questProgress.periodKey, periodKey(def.period, now)),
        ),
      )
      .for("update")
    if (!row || row.progress < def.target) throw new TxAbort(400, "not_done", "这个任务还没完成")
    if (row.claimedAt) throw new TxAbort(400, "already_claimed", "这个任务的奖励已经领过了")
    const reward = await claimRow(tx, userId, questId, row, now)
    return { questId, rewards: rewardLines(reward) }
  })
}

/** 一键全领：把所有完成了没领的任务一次领完，任何一条发放失败整批回滚 */
export async function claimAllQuests(userId: string, now = Date.now()) {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId)
    const rows = await currentRows(tx, userId, now, true)
    const claimed: string[] = []
    const rewards: QuestReward[] = []
    for (const row of rows) {
      const def = QUEST_CONTENT.quests[row.questId]
      if (!def || row.claimedAt || row.progress < def.target) continue
      rewards.push(await claimRow(tx, userId, row.questId, row, now))
      claimed.push(row.questId)
    }
    return { claimed, rewards: rewardLines(mergeQuestRewards(rewards)) }
  })
}

// ---------- 签到 ----------

/** 签到：每天 4:00 换日，一天一次，不补签。奖励按「本月第几天」查表 */
export async function signIn(userId: string, now = Date.now()) {
  const dayKey = periodKey("daily", now)
  const day = resetMonthDay(now)
  const reward = signInRewardFor(QUEST_CONTENT.signIn, day)
  return db.transaction(async (tx) => {
    await lockUser(tx, userId)
    const inserted = await tx
      .insert(questProgress)
      .values({ userId, questId: SIGN_IN_ID, periodKey: dayKey, progress: 1, claimedAt: new Date(now) })
      .onConflictDoNothing()
      .returning({ periodKey: questProgress.periodKey })
    if (inserted.length === 0) throw new TxAbort(400, "already_signed", "今天已经签到过了")
    await grantAttachment(tx, userId, asAttachment(reward), { source: "sign-in", sourceRef: dayKey })
    await recordQuestEvent(tx, userId, "sign-in", { now })
    return { day, rewards: rewardLines(reward) }
  })
}

// ---------- 过期未领 ----------

/**
 * 周期结束时已完成但没领的奖励，合成一封邮件发到邮箱（读任务时顺便做，不用定时任务）。
 * 先在事务里把这些行抢成「已领取」再发信：并发读取只有一个能抢到，奖励不会发两次。
 * 没完成的进度直接作废。
 */
export async function mailExpiredRewards(userId: string, now = Date.now()): Promise<number> {
  const stale = await db
    .select()
    .from(questProgress)
    .where(and(eq(questProgress.userId, userId), sql`${questProgress.claimedAt} IS NULL`))
    .limit(EXPIRED_SWEEP_LIMIT)

  // 过了期还没完成的进度、和已从内容里删掉的任务留下的行，都没有用了：顺手清掉，免得越积越多
  const useless = stale.filter((row) => {
    const def = QUEST_CONTENT.quests[row.questId]
    return !def || (row.periodKey < periodKey(def.period, now) && row.progress < def.target)
  })
  for (const row of useless) {
    await db
      .delete(questProgress)
      .where(
        and(
          eq(questProgress.userId, userId),
          eq(questProgress.questId, row.questId),
          eq(questProgress.periodKey, row.periodKey),
          sql`${questProgress.claimedAt} IS NULL`,
        ),
      )
  }

  const due = stale.filter((row) => {
    const def = QUEST_CONTENT.quests[row.questId]
    return def && row.periodKey < periodKey(def.period, now) && row.progress >= def.target
  })
  if (due.length === 0) return 0

  return db.transaction(async (tx) => {
    await lockUser(tx, userId)
    const names: string[] = []
    const rewards: QuestReward[] = []
    for (const row of due) {
      const taken = await tx
        .update(questProgress)
        .set({ claimedAt: new Date(now), autoClaimed: true, updatedAt: new Date(now) })
        .where(
          and(
            eq(questProgress.userId, userId),
            eq(questProgress.questId, row.questId),
            eq(questProgress.periodKey, row.periodKey),
            sql`${questProgress.claimedAt} IS NULL`,
          ),
        )
        .returning({ questId: questProgress.questId })
      if (taken.length === 0) continue
      const def = QUEST_CONTENT.quests[row.questId]!
      rewards.push(def.rewards)
      names.push(def.name)
    }
    if (rewards.length === 0) return 0
    await sendMail(
      userId,
      {
        kind: "reward",
        title: "任务奖励补发",
        body: `这些任务在重置前完成了，但没来得及领取，奖励随这封邮件发给你：\n${names.join("、")}`,
        attachment: asAttachment(mergeQuestRewards(rewards)),
      },
      tx,
    )
    return rewards.length
  })
}
