import { nextHeartbeatDelay } from "@choke/shared/presence"

/**
 * 在线心跳：打开页面就发一次，之后每 20–40 秒随机发一次（见 @choke/shared/presence）。
 * 服务端靠它判断你在不在线。
 * 不依赖任何页面：桌面、战斗、远征挂着都算在线；关掉标签页就不会再有请求，服务端超时后判离线。
 */

const BEAT_URL = "/api/presence/beat"
/** 没登录时放慢：登录一般会整页跳转重新加载，这里只是兜底 */
const LOGGED_OUT_RETRY_MS = 90_000
/** 切回标签页时，距上次心跳超过这么久就立刻补一次 */
const RESUME_BEAT_AFTER_MS = 15_000

let started = false
let timer: number | null = null
let lastBeatAt = 0
let loggedOut = false

async function beat() {
  lastBeatAt = Date.now()
  let delay = nextHeartbeatDelay()
  try {
    const res = await fetch(BEAT_URL, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
    loggedOut = res.status === 401
    if (loggedOut) delay = LOGGED_OUT_RETRY_MS
  } catch {
    // 断网等：照常等下一次，网络恢复后自然续上
  }
  schedule(delay)
}

function schedule(delay: number) {
  if (timer != null) window.clearTimeout(timer)
  timer = window.setTimeout(() => void beat(), delay)
}

/** 启动心跳；重复调用无效 */
export function startHeartbeat() {
  if (started || typeof window === "undefined") return
  started = true
  void beat()
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return
    if (Date.now() - lastBeatAt >= RESUME_BEAT_AFTER_MS) void beat()
  })
}

/** 刚登录成功时可以调用，不用等下一轮 */
export function beatNow() {
  if (started) void beat()
}
