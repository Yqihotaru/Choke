/**
 * 在线状态与挂机包：前端每隔 20–40 秒发一次心跳，服务端据此判断玩家在不在线，
 * 并把"在线秒数"累计成挂机包。
 *
 * 判定规则：
 * - 两次心跳间隔不超过 ONLINE_TIMEOUT_MS，就认为这段时间一直在线，按实际间隔计入；
 * - 超过就认为中间离线了，这次不计时，不会把离线时间补发；
 * - 多个标签页同时发心跳也没关系：间隔是按服务端上一次心跳算的，总量不会超过真实时间。
 */

/** 心跳间隔的随机范围：每个客户端每次在这个区间里随机取，避免所有人同一秒发 */
export const HEARTBEAT_MIN_MS = 20_000
export const HEARTBEAT_MAX_MS = 40_000
/**
 * 超过这么久没收到心跳，就判为离线。比最长间隔 40 秒大得多，是因为浏览器会把后台标签页的
 * 定时器降频到大约每分钟一次，不能把挂在后台的玩家误判成离线。
 */
export const ONLINE_TIMEOUT_MS = 120_000

/** 每在线多少秒累计 1 个挂机包 */
export const IDLE_SECONDS_PER_PACK = 60
/** 每天最多能领的挂机包数（北京时间每天 4:00 重置）。经济演算后再定，范围 60–180 */
export const IDLE_PACKS_DAILY_LIMIT = 60

/** 当前这个重置日累计的在线秒数，折成已累计的挂机包数（封顶到每日额度） */
export function idlePacksEarned(onlineSeconds: number, dailyLimit = IDLE_PACKS_DAILY_LIMIT): number {
  const packs = Math.floor(Math.max(0, onlineSeconds) / IDLE_SECONDS_PER_PACK)
  return Math.min(dailyLimit, packs)
}

/** 最后一次心跳到现在没超时，就算在线 */
export function isOnline(lastBeatAt: number | Date | null | undefined, now: number): boolean {
  if (lastBeatAt == null) return false
  const at = typeof lastBeatAt === "number" ? lastBeatAt : lastBeatAt.getTime()
  return now - at <= ONLINE_TIMEOUT_MS
}

/** 下一次心跳等多久（毫秒）；random 默认 Math.random，测试里可以注入 */
export function nextHeartbeatDelay(random: () => number = Math.random): number {
  return Math.round(HEARTBEAT_MIN_MS + random() * (HEARTBEAT_MAX_MS - HEARTBEAT_MIN_MS))
}
