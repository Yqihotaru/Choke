import { and, eq } from "drizzle-orm"

import {
  OSU_CHECK_COOLDOWN_SECONDS,
  dayWindow,
  judgeScore,
  osuDailyFor,
  type OsuDailyCheckResult,
  type OsuDailyView,
} from "@choke/shared/osu-daily"
import { nextReset, resetDayKey } from "@choke/shared/reset"

import { OSU_DAILY_CONTENT } from "./content"
import { db } from "./db/client"
import { osuScoreClaims, users } from "./db/schema"
import { OsuApiError, osuApi } from "./osu-api"
import { recordQuestEvent } from "./quest-events"
import { TxAbort, lockUser } from "./tx"

/** 全服每分钟最多向 osu! 发多少次成绩请求（官方限频约 60 次，留出余量） */
const API_BUDGET_PER_MINUTE = 40

/** 每个玩家上次点「检查」的时间；只在内存里，重启后清空也无妨 */
const lastCheck = new Map<string, number>()
let apiCalls: number[] = []

/** 测试用：清空冷却和限频记录 */
export function resetOsuDailyState(): void {
  lastCheck.clear()
  apiCalls = []
}

function cooldownLeft(userId: string, now: number): number {
  const last = lastCheck.get(userId)
  if (last === undefined) return 0
  return Math.max(0, Math.ceil((last + OSU_CHECK_COOLDOWN_SECONDS * 1000 - now) / 1000))
}

async function passedToday(userId: string, dayKey: string): Promise<boolean> {
  const rows = await db
    .select({ scoreId: osuScoreClaims.scoreId })
    .from(osuScoreClaims)
    .where(and(eq(osuScoreClaims.userId, userId), eq(osuScoreClaims.dayKey, dayKey)))
    .limit(1)
  return rows.length > 0
}

/** 今天的推荐谱面、有没有通过、还要等多久才能再点「检查」 */
export async function getOsuDaily(userId: string, now = Date.now()): Promise<OsuDailyView> {
  const day = resetDayKey(now)
  const entry = osuDailyFor(OSU_DAILY_CONTENT, day)
  return {
    day,
    beatmap: entry && {
      beatmapId: entry.beatmapId,
      title: entry.title,
      url: `https://osu.ppy.sh/beatmaps/${entry.beatmapId}`,
      ...(entry.minAccuracy !== undefined ? { minAccuracy: entry.minAccuracy } : {}),
      ...(entry.minRank !== undefined ? { minRank: entry.minRank } : {}),
    },
    passed: entry ? await passedToday(userId, day) : false,
    cooldownSeconds: cooldownLeft(userId, now),
    resetsAt: new Date(nextReset("daily", now)).toISOString(),
  }
}

/**
 * 玩家点「检查」：去 osu! 读他在今天这张谱面上的成绩，达标就记一次 osu-daily-pass，
 * 目前没有成就挂在这个事件上，奖励（外观）以后再接。同一条成绩只能用一次；一天只算一次通过。
 */
export async function checkOsuDaily(userId: string, now = Date.now()): Promise<OsuDailyCheckResult> {
  const day = resetDayKey(now)
  const entry = osuDailyFor(OSU_DAILY_CONTENT, day)
  if (!entry) throw new TxAbort(404, "no_osu_daily", "今天没有推荐谱面")

  const [user] = await db.select({ osuId: users.osuId }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new TxAbort(404, "not_found", "没有这个玩家")
  if (user.osuId == null) throw new TxAbort(400, "osu_not_linked", "需要用 osu! 账号登录才能检查成绩")

  if (await passedToday(userId, day)) return { passed: true, alreadyPassed: true }

  const left = cooldownLeft(userId, now)
  if (left > 0) throw new TxAbort(429, "cooldown", `请 ${left} 秒后再检查`, { cooldownSeconds: left })
  apiCalls = apiCalls.filter((at) => at > now - 60_000)
  if (apiCalls.length >= API_BUDGET_PER_MINUTE) {
    throw new TxAbort(429, "osu_busy", "查询的人太多了，请稍后再试", { cooldownSeconds: 10 })
  }
  apiCalls.push(now)
  lastCheck.set(userId, now)

  let scores
  try {
    scores = await osuApi.userScoresOnBeatmap(entry.beatmapId, user.osuId)
  } catch (error) {
    if (!(error instanceof OsuApiError)) throw error
    // 没查成不算一次检查，别让玩家白等冷却
    lastCheck.delete(userId)
    throw new TxAbort(503, "osu_unavailable", "暂时连不上 osu!，请稍后再试")
  }

  const window = dayWindow(now)
  const verdicts = scores.map((score) => ({ score, verdict: judgeScore(score, entry, window) }))
  const found = verdicts.filter(({ verdict }) => ["ok", "low-accuracy", "low-rank"].includes(verdict)).length
  const good = verdicts.filter(({ verdict }) => verdict === "ok")
  if (good.length === 0) return { passed: false, reason: found > 0 ? "not-good-enough" : "no-score", found }

  return db.transaction(async (tx): Promise<OsuDailyCheckResult> => {
    await lockUser(tx, userId)
    const existing = await tx
      .select({ scoreId: osuScoreClaims.scoreId })
      .from(osuScoreClaims)
      .where(and(eq(osuScoreClaims.userId, userId), eq(osuScoreClaims.dayKey, day)))
      .limit(1)
    if (existing.length > 0) return { passed: true, alreadyPassed: true }

    for (const { score } of good) {
      const inserted = await tx
        .insert(osuScoreClaims)
        .values({ scoreId: score.id, userId, beatmapId: entry.beatmapId, dayKey: day })
        .onConflictDoNothing()
        .returning({ scoreId: osuScoreClaims.scoreId })
      if (inserted.length === 0) continue
      await recordQuestEvent(tx, userId, "osu-daily-pass", { now })
      return { passed: true, alreadyPassed: false }
    }
    // 达标的成绩都已经被用过了
    return { passed: false, reason: "not-good-enough", found }
  })
}
