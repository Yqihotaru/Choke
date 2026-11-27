/**
 * 在线状态：前端每隔 20–40 秒发一次心跳，服务端据此判断玩家在不在线
 * （以后聊天室、在线换卡会用到）。
 *
 * 判定规则：
 * - 最后一次心跳距现在不超过 ONLINE_TIMEOUT_MS，就算在线；
 * - 多个标签页同时发心跳也没关系，只是更新同一个“最后在线时间”。
 */

/** 心跳间隔的随机范围：每个客户端每次在这个区间里随机取，避免所有人同一秒发 */
export const HEARTBEAT_MIN_MS = 20_000
export const HEARTBEAT_MAX_MS = 40_000
/**
 * 超过这么久没收到心跳，就判为离线。比最长间隔 40 秒大得多，是因为浏览器会把后台标签页的
 * 定时器降频到大约每分钟一次，不能把挂在后台的玩家误判成离线。
 */
export const ONLINE_TIMEOUT_MS = 120_000

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
