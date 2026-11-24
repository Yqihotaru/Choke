import { prettifyError, z } from "zod"

import { deriveStream, nextRandom } from "./rng"
import { nextReset } from "./reset"

/**
 * 每日推荐谱面：内容格式、轮换规则和判定规则。内容写在 content/osu-daily.json。
 * 只认 osu! standard。成绩从 osu! 公开接口读，服务端判定，这里只放纯规则。
 */

/** 评级从低到高；官方的 X / XH（SS / 银 SS）算 SS，SH（银 S）算 S */
export const OSU_RANKS = ["D", "C", "B", "A", "S", "SS"] as const
export type OsuRank = (typeof OSU_RANKS)[number]

const RANK_ALIAS: Record<string, OsuRank> = { D: "D", C: "C", B: "B", A: "A", S: "S", SH: "S", X: "SS", XH: "SS" }

/** osu! 接口返回的评级字符串 → 我们的评级；认不出来返回 null */
export function normalizeOsuRank(apiRank: string): OsuRank | null {
  return RANK_ALIAS[apiRank] ?? null
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
const DAY = 24 * 60 * 60 * 1000

const isRealDate = (key: string) => DAY_KEY.test(key) && new Date(`${key}T00:00:00Z`).toISOString().slice(0, 10) === key

export const osuDailyEntrySchema = z.strictObject({
  beatmapId: z.number().int().min(1).max(1_000_000_000),
  /** 给玩家看的名字，比如「曲名 [难度名]」 */
  title: z.string().min(1).max(80),
  /** 可选：最低准度，写百分数（95 就是 95%）。不写就不限 */
  minAccuracy: z.number().min(1).max(100).optional(),
  /** 可选：最低评级。不写就不限 */
  minRank: z.enum(OSU_RANKS).optional(),
})

export type OsuDailyEntry = z.infer<typeof osuDailyEntrySchema>

export const osuDailySchema = z.strictObject({
  /** 候选池：按日期种子洗牌，一圈用完之前不会重复 */
  pool: z.array(osuDailyEntrySchema).max(500),
  /** 手动指定某天用哪张（键是重置日 YYYY-MM-DD，值是池子里的 beatmapId）；没写的天自动轮换 */
  schedule: z.record(z.string(), z.number().int()).default({}),
})

export type OsuDailyContent = z.infer<typeof osuDailySchema>

/** 校验 content/osu-daily.json：格式、谱面不重复、schedule 的日期合法且指向池子里的谱面 */
export function parseOsuDailyContent(raw: unknown): OsuDailyContent {
  const result = osuDailySchema.safeParse(raw)
  if (!result.success) throw new Error(`content/osu-daily.json 校验失败：\n${prettifyError(result.error)}`)
  const content = result.data

  const problems: string[] = []
  const seen = new Set<number>()
  for (const [i, entry] of content.pool.entries()) {
    if (seen.has(entry.beatmapId)) problems.push(`pool[${i}]：谱面 ${entry.beatmapId} 重复`)
    seen.add(entry.beatmapId)
  }
  for (const [day, beatmapId] of Object.entries(content.schedule)) {
    if (!isRealDate(day)) problems.push(`schedule.${day}：键必须是 YYYY-MM-DD 的真实日期`)
    if (!seen.has(beatmapId)) problems.push(`schedule.${day}：谱面 ${beatmapId} 不在 pool 里`)
  }
  if (problems.length > 0) {
    throw new Error(`content/osu-daily.json 校验失败：\n${problems.map((p) => `  ${p}`).join("\n")}`)
  }
  return content
}

// ---------- 轮换 ----------

function shuffledOrder(length: number, cycle: number): number[] {
  const order = Array.from({ length }, (_, i) => i)
  let stream = deriveStream("osu-daily", `cycle-${cycle}`)
  for (let i = length - 1; i > 0; i -= 1) {
    const [next, roll] = nextRandom(stream)
    stream = next
    const j = Math.floor(roll * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  return order
}

/**
 * 某个重置日（YYYY-MM-DD）的推荐谱面；池子是空的返回 null。
 * 先看 schedule 有没有手动指定，没有就按「天数 → 第几圈第几位」轮换：
 * 每一圈把池子按种子洗一遍，一圈用完前不会重复；相邻两圈的交界处也不会连着出同一张。
 * 不存数据库：同一份内容、同一天，任何时候算出来都一样。
 */
export function osuDailyFor(content: OsuDailyContent, dayKey: string): OsuDailyEntry | null {
  const { pool } = content
  if (pool.length === 0) return null
  const scheduled = content.schedule[dayKey]
  if (scheduled !== undefined) return pool.find((entry) => entry.beatmapId === scheduled) ?? null

  const length = pool.length
  const dayNumber = Math.floor(new Date(`${dayKey}T00:00:00Z`).getTime() / DAY)
  const cycle = Math.floor(dayNumber / length)
  const position = dayNumber - cycle * length

  // 池子只有 1–2 张时每圈用同一个顺序，自然就是交替；3 张以上才需要洗牌，并避开上一圈的最后一张
  if (length <= 2) return pool[shuffledOrder(length, 0)[position]!]!
  const order = shuffledOrder(length, cycle)
  const previousLast = shuffledOrder(length, cycle - 1).at(-1)
  if (order[0] === previousLast) [order[0], order[1]] = [order[1]!, order[0]!]
  return pool[order[position]!]!
}

// ---------- 判定 ----------

/** osu! 接口里一条成绩里我们用到的字段 */
export interface OsuScore {
  id: number
  passed: boolean
  /** ISO 时间 */
  ended_at: string
  /** 0–1 */
  accuracy: number
  rank: string
  /** 0 = osu! standard */
  ruleset_id: number
}

/** 这一天（北京时间 4:00 起）的时间范围，成绩必须结束在这个范围里 */
export function dayWindow(now: number): { from: number; to: number } {
  const to = nextReset("daily", now)
  return { from: to - DAY, to }
}

export type ScoreVerdict = "ok" | "wrong-mode" | "failed" | "not-today" | "low-accuracy" | "low-rank"

/**
 * 一条成绩算不算今天的推荐谱面通过：只认 standard、必须 Pass（挂 NF 等任何 mod 都行）、
 * 结束时间在今天（4:00 起）；条件（准度、评级）写了才判断。
 */
export function judgeScore(score: OsuScore, entry: OsuDailyEntry, window: { from: number; to: number }): ScoreVerdict {
  if (score.ruleset_id !== 0) return "wrong-mode"
  if (!score.passed) return "failed"
  const endedAt = Date.parse(score.ended_at)
  if (!Number.isFinite(endedAt) || endedAt < window.from || endedAt >= window.to) return "not-today"
  if (entry.minAccuracy !== undefined && score.accuracy * 100 + 1e-9 < entry.minAccuracy) return "low-accuracy"
  if (entry.minRank !== undefined) {
    const rank = normalizeOsuRank(score.rank)
    if (rank === null || OSU_RANKS.indexOf(rank) < OSU_RANKS.indexOf(entry.minRank)) return "low-rank"
  }
  return "ok"
}

// ---------- 给前端的视图 ----------

export interface OsuDailyView {
  /** 今天的重置日 */
  day: string
  /** 今天没有推荐谱面（池子是空的）时为 null */
  beatmap: {
    beatmapId: number
    title: string
    /** 打开谱面页面的链接 */
    url: string
    /** 最低准度（百分数）；没有限制时不出现 */
    minAccuracy?: number
    minRank?: OsuRank
  } | null
  /** 今天已经通过了 */
  passed: boolean
  /** 距离下次可以点「检查」还要几秒；0 表示现在可以 */
  cooldownSeconds: number
  /** 下一次换谱面的时间（ISO） */
  resetsAt: string
}

export type OsuDailyCheckResult =
  | { passed: true; alreadyPassed: boolean }
  | {
      passed: false
      /** no-score：今天还没找到这张谱面的成绩；not-good-enough：找到了但没达到条件 */
      reason: "no-score" | "not-good-enough"
      /** 今天找到的 standard Pass 成绩条数 */
      found: number
    }

export const OSU_CHECK_COOLDOWN_SECONDS = 60
