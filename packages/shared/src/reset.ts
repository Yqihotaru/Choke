/**
 * 重置时间（北京时间）：日常和签到每天 4:00，周常周一 4:00，月常每月 1 日 4:00。
 * 北京时间没有夏令时，所以直接按固定的 UTC+8 算；做法是把时间往后挪 4 小时，
 * 这样「4:00 换日」就变成了普通的「0:00 换日」，再用 UTC 的日期函数数天数。
 */

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** 把「北京时间 4:00」对到「UTC 0:00」需要往后挪的时间：UTC 20:00 + 4h = 24:00 */
const SHIFT = 4 * HOUR

export type ResetPeriod = "daily" | "weekly" | "monthly"

function shifted(now: number): Date {
  return new Date(now + SHIFT)
}

/** 现在属于哪个「重置日」，格式 YYYY-MM-DD；每天 4:00 换日。日常地图的种子用它 */
export function resetDayKey(now: number): string {
  return shifted(now).toISOString().slice(0, 10)
}

/** 下一次重置的时间戳（毫秒）；恰好在重置那一刻算作新的一段，返回的是之后的那次 */
export function nextReset(period: ResetPeriod, now: number): number {
  const date = shifted(now)
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  if (period === "daily") return dayStart + DAY - SHIFT
  if (period === "weekly") {
    const sinceMonday = (date.getUTCDay() + 6) % 7
    return dayStart + (7 - sinceMonday) * DAY - SHIFT
  }
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - SHIFT
}
