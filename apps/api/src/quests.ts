import { and, eq, inArray, like, or, sql, type SQL } from "drizzle-orm"

import { ITEMS } from "@choke/shared/items"
import type { MailAttachment, MailAttachmentLine } from "@choke/shared/mail"
import {
  PERIOD_LABEL,
  POINTS_ROW_PREFIX,
  QUEST_ALL_PERIODS,
  QUEST_PERIODS,
  SIGN_IN_ID,
  activityCap,
  chestRowId,
  daysInMonthKey,
  mergeQuestRewards,
  parseChestRowId,
  pointsRowId,
  questPeriodKey,
  signInRewardFor,
  type ActivityView,
  type QuestPeriod,
  type QuestReward,
  type QuestView,
  type QuestsOverview,
  type ResettingPeriod,
} from "@choke/shared/quests"
import { nextReset, periodKey, resetMonthDay, resetMonthKey } from "@choke/shared/reset"

import { QUEST_CONTENT } from "./content"
import { db } from "./db/client"
import { questProgress, users } from "./db/schema"
import { MYSTERY_PACK, PACKS } from "./gacha/packs"
import { sendMail } from "./mail"
import type { LedgerSource } from "./ledger"
import { addPlayerExperience } from "./player-exp"
import { QUESTS, recordQuestEvent } from "./quest-events"
import { grantAttachment } from "./rewards"
import { TxAbort, lockUser, type Tx } from "./tx"

type Exec = Tx | typeof db

const EXPIRED_SWEEP_LIMIT = 200

/** 奖励在 schema 里已经核对过物品和卡包都存在，这里只是换成发奖函数认的类型 */
const asAttachment = (reward: QuestReward) => reward as MailAttachment

/** 发任务奖励：玩家经验直接加到账号上（不进邮件附件和流水），其余走发奖函数 */
async function grantQuestReward(tx: Tx, userId: string, reward: QuestReward, origin: LedgerSource, now: number) {
  const { playerExp = 0, ...rest } = reward
  if (Object.keys(rest).length > 0) await grantAttachment(tx, userId, asAttachment(rest), origin)
  await addPlayerExperience(tx, userId, playerExp, now)
}

const chestsOf = (period: ResettingPeriod) => QUEST_CONTENT.activity[period] ?? []

// ---------- 进度行的规则 ----------

/** 进度表里一行的含义：普通任务、活跃点计数、活跃度宝箱，三种行共用一张表 */
interface RowRule {
  period: QuestPeriod
  /** 进度到这个数才算完成；活跃点计数行永远不算完成 */
  target: number
  /** 领取时发的奖励；活跃点计数行没有 */
  reward: QuestReward | null
  name: string
}

function ruleOf(questId: string): RowRule | null {
  const def = QUEST_CONTENT.quests[questId]
  if (def) return { period: def.period, target: def.target, reward: def.rewards, name: def.name }
  if (questId.startsWith(POINTS_ROW_PREFIX)) {
    const period = questId.slice(POINTS_ROW_PREFIX.length)
    return (QUEST_PERIODS as readonly string[]).includes(period)
      ? { period: period as ResettingPeriod, target: Number.POSITIVE_INFINITY, reward: null, name: "" }
      : null
  }
  const chestId = parseChestRowId(questId)
  const chest = chestId && chestsOf(chestId.period).find((c) => c.at === chestId.at)
  if (chestId && chest) {
    return { period: chestId.period, target: 1, reward: chest.rewards, name: `${PERIOD_LABEL[chestId.period]}活跃宝箱（${chest.at} 点）` }
  }
  return null
}

/** 这一行的周期已经过去了：一次性成就永远不过期 */
const isExpired = (rule: RowRule, row: { periodKey: string }, now: number) =>
  rule.period !== "once" && row.periodKey < questPeriodKey(rule.period, now)

// ---------- 读取 ----------

type Row = typeof questProgress.$inferSelect

/** 一个周期里用到的全部进度行 id：任务 + 活跃点计数 + 宝箱 */
function rowIdsOf(period: QuestPeriod): string[] {
  const ids = QUESTS.filter(([, def]) => def.period === period).map(([questId]) => questId)
  if (period === "once") return ids
  return [...ids, pointsRowId(period), ...chestsOf(period).map((c) => chestRowId(period, c.at))]
}

/** 现在这一轮（今天 / 本周 / 本月 / 成就）的进度行 */
async function currentRows(exec: Exec, userId: string, now: number, lock = false): Promise<Row[]> {
  const groups: SQL[] = []
  for (const period of QUEST_ALL_PERIODS) {
    const ids = rowIdsOf(period)
    if (ids.length === 0) continue
    groups.push(and(inArray(questProgress.questId, ids), eq(questProgress.periodKey, questPeriodKey(period, now)))!)
  }
  if (groups.length === 0) return []
  const query = exec
    .select()
    .from(questProgress)
    .where(and(eq(questProgress.userId, userId), or(...groups)))
  return lock ? query.for("update") : query
}

/**
 * 玩家等级升级的地方有好几处，不逐个埋点：读任务和领奖前，把当前等级补记一笔（等级只增不减，补记不会漏）。
 */
async function syncPlayerLevel(exec: Exec, userId: string, now: number): Promise<void> {
  if (!QUESTS.some(([, def]) => def.event === "player-level")) return
  const [row] = await exec.select({ level: users.playerLevel }).from(users).where(eq(users.id, userId)).limit(1)
  if (row) await recordQuestEvent(exec, userId, "player-level", { value: row.level, now })
}

function rewardLines(reward: QuestReward): MailAttachmentLine[] {
  const lines: MailAttachmentLine[] = []
  if (reward.coins) lines.push({ kind: "coins", label: "金币", count: reward.coins })
  if (reward.essence) lines.push({ kind: "essence", label: "闪卡精华", count: reward.essence })
  if (reward.playerExp) lines.push({ kind: "playerExp", label: "玩家经验", count: reward.playerExp })
  for (const { itemId, count } of reward.items ?? []) {
    lines.push({ kind: "item", label: ITEMS[itemId as keyof typeof ITEMS]?.name ?? itemId, count })
  }
  for (const { pool, count } of reward.packs ?? []) {
    const name = pool === MYSTERY_PACK.id ? MYSTERY_PACK.name : ((PACKS as Record<string, { name: string }>)[pool]?.name ?? pool)
    lines.push({ kind: "pack", label: name, count })
  }
  return lines
}

/** 总览：任务 + 活跃度宝箱 + 签到 + 重置时间。读之前先把过期没领的奖励发到邮箱 */
export async function getQuests(userId: string, now = Date.now()): Promise<QuestsOverview> {
  try {
    await mailExpiredRewards(userId, now)
  } catch (error) {
    console.warn(`[quests] 过期任务奖励转邮件失败，下次再试：`, error)
  }
  await syncPlayerLevel(db, userId, now)

  const rows = await currentRows(db, userId, now)
  const byQuest = new Map(rows.map((row) => [row.questId, row]))

  const points = Object.fromEntries(QUEST_PERIODS.map((p) => [p, { earned: 0, total: 0 }])) as QuestsOverview["points"]
  const quests: QuestView[] = QUESTS.map(([questId, def]) => {
    const row = byQuest.get(questId)
    const progress = Math.min(def.target, row?.progress ?? 0)
    const claimed = row?.claimedAt != null
    if (def.period !== "once") {
      points[def.period].total += def.points
      if (claimed) points[def.period].earned += def.points
    }
    return {
      id: questId,
      period: def.period,
      name: def.name,
      desc: def.desc,
      ...(def.group ? { group: def.group } : {}),
      target: def.target,
      progress,
      claimable: !claimed && progress >= def.target,
      claimed,
      rewards: rewardLines(def.rewards),
      points: def.points,
    }
  })

  const activity = Object.fromEntries(
    QUEST_PERIODS.map((period): [ResettingPeriod, ActivityView] => [
      period,
      {
        earned: byQuest.get(pointsRowId(period))?.progress ?? 0,
        cap: activityCap(QUEST_CONTENT, period),
        chests: chestsOf(period).map((chest) => {
          const row = byQuest.get(chestRowId(period, chest.at))
          const claimed = row?.claimedAt != null
          return { at: chest.at, rewards: rewardLines(chest.rewards), claimable: row != null && !claimed, claimed }
        }),
      },
    ]),
  ) as QuestsOverview["activity"]

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
    activity,
    claimable:
      quests.filter((quest) => quest.claimable).length +
      QUEST_PERIODS.reduce((sum, p) => sum + activity[p].chests.filter((chest) => chest.claimable).length, 0),
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

function questOrThrow(questId: string) {
  const def = QUEST_CONTENT.quests[questId]
  if (!def) throw new TxAbort(404, "not_found", "没有这个任务")
  return def
}

/**
 * 领一条任务后给活跃点；点数攒到的宝箱立刻生成一行「待领取」。
 * 点数封顶在最大一档宝箱，多出来的作废。一次性成就和没有宝箱的周期不记。
 */
async function addActivity(tx: Tx, userId: string, period: QuestPeriod, points: number, key: string): Promise<void> {
  if (period === "once" || points <= 0) return
  const cap = activityCap(QUEST_CONTENT, period)
  if (cap === 0) return
  const [counter] = await tx
    .insert(questProgress)
    .values({ userId, questId: pointsRowId(period), periodKey: key, progress: Math.min(cap, points) })
    .onConflictDoUpdate({
      target: [questProgress.userId, questProgress.questId, questProgress.periodKey],
      set: { progress: sql`LEAST(${cap}::int, ${questProgress.progress} + ${points})`, updatedAt: sql`now()` },
    })
    .returning({ progress: questProgress.progress })
  for (const chest of chestsOf(period)) {
    if (chest.at > counter!.progress) continue
    await tx
      .insert(questProgress)
      .values({ userId, questId: chestRowId(period, chest.at), periodKey: key, progress: 1 })
      .onConflictDoNothing()
  }
}

async function claimRow(tx: Tx, userId: string, questId: string, row: Row, now: number): Promise<QuestReward> {
  const def = QUEST_CONTENT.quests[questId]!
  await grantQuestReward(tx, userId, def.rewards, { source: "quest", sourceRef: `${questId}@${row.periodKey}` }, now)
  await tx
    .update(questProgress)
    .set({ claimedAt: new Date(now), updatedAt: new Date(now) })
    .where(and(eq(questProgress.userId, userId), eq(questProgress.questId, questId), eq(questProgress.periodKey, row.periodKey)))
  await addActivity(tx, userId, def.period, def.points, row.periodKey)
  return def.rewards
}

/** 领一个宝箱：把这一行标成已领并发奖 */
async function claimChestRow(tx: Tx, userId: string, row: Row, now: number): Promise<QuestReward> {
  const rule = ruleOf(row.questId)
  if (!rule?.reward) throw new TxAbort(404, "not_found", "没有这个宝箱")
  await grantQuestReward(tx, userId, rule.reward, { source: "quest-chest", sourceRef: `${row.questId}@${row.periodKey}` }, now)
  await tx
    .update(questProgress)
    .set({ claimedAt: new Date(now), updatedAt: new Date(now) })
    .where(and(eq(questProgress.userId, userId), eq(questProgress.questId, row.questId), eq(questProgress.periodKey, row.periodKey)))
  return rule.reward
}

/** 领一条任务的奖励：事务里先锁用户再查进度，重复点、同时点都只会发一次 */
export async function claimQuest(userId: string, questId: string, now = Date.now()) {
  const def = questOrThrow(questId)
  await syncPlayerLevel(db, userId, now)
  return db.transaction(async (tx) => {
    await lockUser(tx, userId)
    const [row] = await tx
      .select()
      .from(questProgress)
      .where(
        and(
          eq(questProgress.userId, userId),
          eq(questProgress.questId, questId),
          eq(questProgress.periodKey, questPeriodKey(def.period, now)),
        ),
      )
      .for("update")
    if (!row || row.progress < def.target) throw new TxAbort(400, "not_done", "这个任务还没完成")
    if (row.claimedAt) throw new TxAbort(400, "already_claimed", "这个任务的奖励已经领过了")
    const reward = await claimRow(tx, userId, questId, row, now)
    return { questId, rewards: rewardLines(reward) }
  })
}

/** 领一个活跃度宝箱：点数不够（宝箱还没生成）、已经领过都会拒绝 */
export async function claimChest(userId: string, period: ResettingPeriod, at: number, now = Date.now()) {
  if (!chestsOf(period).some((chest) => chest.at === at)) throw new TxAbort(404, "not_found", "没有这个宝箱")
  const rowId = chestRowId(period, at)
  return db.transaction(async (tx) => {
    await lockUser(tx, userId)
    const [row] = await tx
      .select()
      .from(questProgress)
      .where(and(eq(questProgress.userId, userId), eq(questProgress.questId, rowId), eq(questProgress.periodKey, periodKey(period, now))))
      .for("update")
    if (!row) throw new TxAbort(400, "not_done", "活跃点还不够")
    if (row.claimedAt) throw new TxAbort(400, "already_claimed", "这个宝箱已经领过了")
    const reward = await claimChestRow(tx, userId, row, now)
    return { period, at, rewards: rewardLines(reward) }
  })
}

/** 一键全领：先领完所有完成了没领的任务（领任务会攒活跃点、解锁宝箱），再领所有解锁了没领的宝箱；任何一条失败整批回滚 */
export async function claimAllQuests(userId: string, now = Date.now()) {
  await syncPlayerLevel(db, userId, now)
  return db.transaction(async (tx) => {
    await lockUser(tx, userId)
    const claimed: string[] = []
    const chests: string[] = []
    const rewards: QuestReward[] = []
    for (const row of await currentRows(tx, userId, now, true)) {
      const def = QUEST_CONTENT.quests[row.questId]
      if (!def || row.claimedAt || row.progress < def.target) continue
      rewards.push(await claimRow(tx, userId, row.questId, row, now))
      claimed.push(row.questId)
    }
    for (const row of await currentRows(tx, userId, now, true)) {
      const chest = parseChestRowId(row.questId)
      if (!chest || row.claimedAt) continue
      rewards.push(await claimChestRow(tx, userId, row, now))
      chests.push(`${chest.period}-${chest.at}`)
    }
    return { claimed, chests, rewards: rewardLines(mergeQuestRewards(rewards)) }
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
    await grantQuestReward(tx, userId, reward, { source: "sign-in", sourceRef: dayKey }, now)
    await recordQuestEvent(tx, userId, "sign-in", { now })
    return { day, rewards: rewardLines(reward) }
  })
}

// ---------- 过期未领 ----------

/**
 * 周期结束时已完成但没领的奖励（任务和活跃度宝箱），合成一封邮件发到邮箱（读任务时顺便做，不用定时任务）。
 * 先在事务里把这些行抢成「已领取」再发信：并发读取只有一个能抢到，奖励不会发两次。
 * 没完成的进度、过期的活跃点计数直接作废。一次性成就不会过期。
 */
export async function mailExpiredRewards(userId: string, now = Date.now()): Promise<number> {
  const stale = await db
    .select()
    .from(questProgress)
    .where(and(eq(questProgress.userId, userId), sql`${questProgress.claimedAt} IS NULL`))
    .limit(EXPIRED_SWEEP_LIMIT)

  // 过了期还没完成的进度、和已从内容里删掉的任务留下的行，都没有用了：顺手清掉，免得越积越多
  const useless = stale.filter((row) => {
    const rule = ruleOf(row.questId)
    return !rule || (isExpired(rule, row, now) && row.progress < rule.target)
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
    const rule = ruleOf(row.questId)
    return rule?.reward && isExpired(rule, row, now) && row.progress >= rule.target
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
      const rule = ruleOf(row.questId)!
      rewards.push(rule.reward!)
      names.push(rule.name)
    }
    if (rewards.length === 0) return 0
    const batchBuckets: { rewards: QuestReward[]; names: string[] }[] = []
    let curRewards: QuestReward[] = []
    let curNames: string[] = []
    for (let i = 0; i < rewards.length; i += 1) {
      const r = rewards[i]!
      const n = names[i]!
      const candidate = [...curRewards, r]
      const merged = mergeQuestRewards(candidate)
      const tooManyCoins = (merged.coins ?? 0) > 1_000_000
      const tooManyEssence = (merged.essence ?? 0) > 1_000_000
      const tooManyItems = Object.keys(merged.items ?? {}).length > 20
      const tooManyPacks = Object.keys(merged.packs ?? {}).length > 20
      if (curRewards.length > 0 && (tooManyCoins || tooManyEssence || tooManyItems || tooManyPacks)) {
        batchBuckets.push({ rewards: curRewards, names: curNames })
        curRewards = [r]
        curNames = [n]
      } else {
        curRewards = candidate
        curNames.push(n)
      }
    }
    if (curRewards.length > 0) batchBuckets.push({ rewards: curRewards, names: curNames })

    let totalPlayerExp = 0
    for (const bucket of batchBuckets) {
      const { playerExp = 0 } = mergeQuestRewards(bucket.rewards)
      totalPlayerExp += playerExp
    }
    await addPlayerExperience(tx, userId, totalPlayerExp, now)

    for (let idx = 0; idx < batchBuckets.length; idx += 1) {
      const bucket = batchBuckets[idx]!
      const { playerExp = 0, ...attachment } = mergeQuestRewards(bucket.rewards)
      await sendMail(
        userId,
        {
          kind: "reward",
          title: batchBuckets.length > 1 ? `任务奖励补发 (${idx + 1}/${batchBuckets.length})` : "任务奖励补发",
          body: `这些任务在重置前完成了，但没来得及领取，奖励随这封邮件发给你：\n${bucket.names.join("、")}${
            playerExp > 0 ? `\n另有 ${playerExp} 点玩家经验已直接加到账号上。` : ""
          }`,
          attachment: asAttachment(attachment),
        },
        tx,
      )
    }
    return rewards.length
  })
}
