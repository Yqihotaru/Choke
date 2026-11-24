import { z } from "zod"

import type { MailAttachmentLine } from "./mail"
import { periodKey, type ResetPeriod } from "./reset"
import { RARITIES } from "./types"

/**
 * 任务与签到的内容格式和纯规则。内容写在 content/quests.json，进度由服务端在各个动作里记账。
 * 这里不 import 内容（items / packs），引用是否存在由 content/schema.ts 统一核对。
 */

/** 会定时重置的周期 */
export const QUEST_PERIODS = ["daily", "weekly", "monthly"] as const satisfies readonly ResetPeriod[]
/** 任务可以属于的周期：再加上不重置、只领一次的一次性成就 */
export const QUEST_ALL_PERIODS = [...QUEST_PERIODS, "once"] as const
export type QuestPeriod = (typeof QUEST_ALL_PERIODS)[number]
export type ResettingPeriod = (typeof QUEST_PERIODS)[number]

export const PERIOD_LABEL: Record<QuestPeriod, string> = {
  daily: "日常",
  weekly: "周常",
  monthly: "月常",
  once: "成就",
}

/** 进度表里一次性任务统一用的周期编号 */
export const ONCE_KEY = "once"

/** 任务现在这一轮的周期编号；一次性成就永远是同一个 */
export function questPeriodKey(period: QuestPeriod, now: number): string {
  return period === "once" ? ONCE_KEY : periodKey(period, now)
}

/** 服务端会记账的事件；新增事件要同时在对应的服务端动作里加一行 recordQuestEvent */
export const QUEST_EVENTS = [
  "sign-in",
  "pack-open",
  "feed",
  "fuse",
  "dismantle",
  "dungeon-run",
  "market-buy",
  "market-sell",
  "expedition-win",
  "expedition-clear",
  "expedition-perfect",
  "expedition-tier",
  "card-obtain",
  "card-level",
  "constellation",
  "player-level",
] as const
export type QuestEvent = (typeof QUEST_EVENTS)[number]

/**
 * 「取最大值」的事件：进度不是累加，而是记到目前为止达到过的最高值（等级、命座、难度档位）。
 * 记账时传 value；进度 = max(原进度, value)。
 */
export const QUEST_MAX_EVENTS = [
  "expedition-tier",
  "card-level",
  "constellation",
  "player-level",
] as const satisfies readonly QuestEvent[]

export function isMaxEvent(event: QuestEvent): boolean {
  return (QUEST_MAX_EVENTS as readonly string[]).includes(event)
}

export const QUEST_EVENT_LABEL: Record<QuestEvent, string> = {
  "sign-in": "签到",
  "pack-open": "开卡包（每包 1 次）",
  feed: "喂养（每次 1 次）",
  fuse: "融合（每次 1 次）",
  dismantle: "分解（每张卡 1 次）",
  "dungeon-run": "通关副本",
  "market-buy": "市场买入",
  "market-sell": "市场卖出",
  "expedition-win": "远征里打赢一场战斗",
  "expedition-clear": "远征走到终点通关（到此结算不算）",
  "expedition-perfect": "远征通关且拿到最高星级",
  "expedition-tier": "远征通关时的难度档位（取最高，1–5）",
  "card-obtain": "获得一张卡（可限定稀有度）",
  "card-level": "一张卡的等级（取最高）",
  constellation: "一张卡的命座（取最高）",
  "player-level": "玩家等级（取最高）",
}

/** 只有远征类事件可以限定地图种类。和 expedition/content.ts 的 MAP_KINDS 一致，测试里核对 */
export const QUEST_MAP_KINDS = ["main", "season", "weekly", "daily"] as const
export type QuestMapKind = (typeof QUEST_MAP_KINDS)[number]

/** 签到固定用的任务 id：进度表里用它存签到记录，所以不能被普通任务占用 */
export const SIGN_IN_ID = "sign-in"

const amount = z.number().int().min(1).max(1_000_000)
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, "id 只能用字母、数字和连字符")

/** 奖励：和邮件附件同一套字段（不含卡牌），领取时直接走发奖函数 */
export const questRewardSchema = z
  .strictObject({
    coins: amount.optional(),
    essence: amount.optional(),
    stamina: amount.optional(),
    items: z.array(z.strictObject({ itemId: z.string(), count: amount })).min(1).max(20).optional(),
    packs: z.array(z.strictObject({ pool: z.string(), count: amount })).min(1).max(20).optional(),
  })
  .refine((reward) => Object.keys(reward).length > 0, "奖励不能是空的")

export type QuestReward = z.infer<typeof questRewardSchema>

export const questSchema = z.strictObject({
  period: z.enum(QUEST_ALL_PERIODS),
  name: z.string().min(1).max(20),
  desc: z.string().min(1).max(60),
  /** 前端分组用的小标题（成就页分栏），不影响规则 */
  group: z.string().min(1).max(10).optional(),
  event: z.enum(QUEST_EVENTS),
  target: z.number().int().min(1).max(100_000),
  /** 只记这种地图上的远征；只能配在 expedition-* 事件上 */
  mapKind: z.enum(QUEST_MAP_KINDS).optional(),
  /** 只记这张具体地图；只能配在 expedition-* 事件上，地图要存在 */
  mapId: id.optional(),
  /** 只记这个稀有度及以上的卡；只能配在 card-obtain 事件上 */
  minRarity: z.enum(RARITIES).optional(),
  rewards: questRewardSchema,
  /** 领奖后给的活跃点，用来解锁活跃度宝箱；一次性成就必须是 0 */
  points: z.number().int().min(0).max(1000),
})

export type QuestDef = z.infer<typeof questSchema>

/** 活跃度宝箱：活跃点到了 at 就能领 */
export const activityChestSchema = z.strictObject({
  at: z.number().int().min(1).max(1000),
  rewards: questRewardSchema,
})

export type ActivityChest = z.infer<typeof activityChestSchema>

const chestList = z.array(activityChestSchema).min(1).max(10)

export const questsSchema = z.strictObject({
  signIn: z.strictObject({
    /** 平时每天的签到奖励 */
    base: questRewardSchema,
    /** 「本月第几天」的特别奖励：写了的那天用它，代替 base */
    bonus: z.record(z.string().regex(/^(?:[1-9]|[12]\d|3[01])$/, "键是 1–31 的日期"), questRewardSchema),
  }),
  /** 每个周期各自一排活跃度宝箱；没写的周期没有宝箱。at 必须从小到大 */
  activity: z
    .strictObject({
      daily: chestList.optional(),
      weekly: chestList.optional(),
      monthly: chestList.optional(),
    })
    .default({}),
  quests: z.record(id, questSchema),
})

export type QuestsContent = z.infer<typeof questsSchema>

// ---------- 纯规则 ----------

/** 一次事件带的附加信息：用来匹配任务上的限定条件 */
export interface QuestEventContext {
  mapKind?: string
  mapId?: string
  rarity?: string
}

/** 这个事件（和地图、稀有度）算不算这条任务的进度 */
export function questCounts(def: QuestDef, event: QuestEvent, context: QuestEventContext = {}): boolean {
  if (def.event !== event) return false
  if (def.mapKind !== undefined && def.mapKind !== context.mapKind) return false
  if (def.mapId !== undefined && def.mapId !== context.mapId) return false
  if (def.minRarity !== undefined) {
    const rank = RARITIES.indexOf(context.rarity as (typeof RARITIES)[number])
    if (rank < RARITIES.indexOf(def.minRarity)) return false
  }
  return true
}

// ---------- 活跃度 ----------
// 活跃点和宝箱都存在进度表里，用 @ 开头的假任务 id（普通任务 id 不允许以 @ 开头）：
//   @points-daily       当期已经攒到的活跃点（封顶在最大一档宝箱）
//   @chest-daily-40     已经解锁的 40 点宝箱；claimed_at 有值就是领过了

export const POINTS_ROW_PREFIX = "@points-"
export const CHEST_ROW_PREFIX = "@chest-"

export const pointsRowId = (period: ResettingPeriod) => `${POINTS_ROW_PREFIX}${period}`
export const chestRowId = (period: ResettingPeriod, at: number) => `${CHEST_ROW_PREFIX}${period}-${at}`

export function parseChestRowId(rowId: string): { period: ResettingPeriod; at: number } | null {
  const match = /^@chest-(daily|weekly|monthly)-(\d+)$/.exec(rowId)
  return match ? { period: match[1] as ResettingPeriod, at: Number(match[2]) } : null
}

/** 这个周期的活跃点上限 = 最大一档宝箱；没有宝箱的周期返回 0 */
export function activityCap(content: Pick<QuestsContent, "activity">, period: ResettingPeriod): number {
  const chests = content.activity[period] ?? []
  return chests.reduce((max, chest) => Math.max(max, chest.at), 0)
}

/** 某个月有几天；monthKey 形如 2026-11 */
export function daysInMonthKey(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number)
  return new Date(Date.UTC(year!, month!, 0)).getUTCDate()
}

/** 本月第 day 天的签到奖励 */
export function signInRewardFor(signIn: QuestsContent["signIn"], day: number): QuestReward {
  return signIn.bonus[String(day)] ?? signIn.base
}

/** 把多份奖励合成一份：同种道具、同种卡包数量相加 */
export function mergeQuestRewards(rewards: readonly QuestReward[]): QuestReward {
  const out: QuestReward = {}
  const items = new Map<string, number>()
  const packs = new Map<string, number>()
  for (const reward of rewards) {
    if (reward.coins) out.coins = (out.coins ?? 0) + reward.coins
    if (reward.essence) out.essence = (out.essence ?? 0) + reward.essence
    if (reward.stamina) out.stamina = (out.stamina ?? 0) + reward.stamina
    for (const { itemId, count } of reward.items ?? []) items.set(itemId, (items.get(itemId) ?? 0) + count)
    for (const { pool, count } of reward.packs ?? []) packs.set(pool, (packs.get(pool) ?? 0) + count)
  }
  if (items.size > 0) out.items = [...items].map(([itemId, count]) => ({ itemId, count }))
  if (packs.size > 0) out.packs = [...packs].map(([pool, count]) => ({ pool, count }))
  return out
}

// ---------- 给前端的视图 ----------

export interface QuestView {
  id: string
  period: QuestPeriod
  name: string
  desc: string
  /** 成就页的分栏小标题 */
  group?: string
  target: number
  progress: number
  /** 完成了、还没领 */
  claimable: boolean
  claimed: boolean
  rewards: MailAttachmentLine[]
  points: number
}

export interface ActivityChestView {
  /** 要攒到多少活跃点 */
  at: number
  rewards: MailAttachmentLine[]
  /** 点数够了、还没领 */
  claimable: boolean
  claimed: boolean
}

export interface ActivityView {
  /** 当期已经攒到的活跃点（封顶在最大一档宝箱） */
  earned: number
  /** 最大一档宝箱要的点数，进度条的满格；这个周期没有宝箱时为 0 */
  cap: number
  chests: ActivityChestView[]
}

export interface SignInDayView {
  day: number
  rewards: MailAttachmentLine[]
  /** 这一天签到了没有（只有本月已过的天数才可能为 true） */
  signed: boolean
  /** 是不是特别奖励的那几天 */
  special: boolean
}

export interface QuestsOverview {
  now: string
  /** 三个周期下一次重置的时间 */
  resets: Record<ResettingPeriod, string>
  quests: QuestView[]
  /** 各周期已领取任务的活跃点合计 / 满分 */
  points: Record<ResettingPeriod, { earned: number; total: number }>
  /** 各周期的活跃度进度和宝箱 */
  activity: Record<ResettingPeriod, ActivityView>
  /** 可以领的条数（任务 + 宝箱），红点用 */
  claimable: number
  signIn: {
    monthKey: string
    /** 今天是本月第几天 */
    today: number
    signedToday: boolean
    signedDays: number
    days: SignInDayView[]
  }
}
