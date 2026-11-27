import { useCallback, useEffect, useState } from "react"

import { ApiError, request } from "@/desk/session/api"
import { emitDeskData } from "@/desk/session/events"
import { IDLE_SECONDS_PER_PACK } from "@choke/shared/presence"
import "@/presence/idle-pack-card.css"

interface IdleStatus {
  dailyLimit: number
  onlineSeconds: number
  earned: number
  claimedToday: number
  claimable: number
  remaining: number
  count: number
}

/** 隔多久向服务端校准一次；中间靠本地每秒估算 */
const REFRESH_MS = 30_000

function useIdleStatus(userId: string) {
  const [state, setState] = useState<{ userId: string; status: IdleStatus; at: number } | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(
    (signal?: AbortSignal) =>
      request<IdleStatus>(`/api/users/${userId}/packs/idle`, { signal })
        .then((status) => {
          setState({ userId, status, at: Date.now() })
          setFailed(false)
        })
        .catch((err) => {
          if (signal?.aborted) return
          setFailed(true)
          if (err instanceof ApiError && err.code === "unauthorized") setState(null)
        }),
    [userId],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(controller.signal)
    }, REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(controller.signal)
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [load])

  return { state: state?.userId === userId ? state : null, failed, reload: load }
}

/**
 * 挂机包：在线每满 1 分钟攒 1 个，每天北京时间 4:00 重新计。
 * 数字以服务端为准（每 30 秒校准一次），两次校准之间本地按秒估算，让进度条是动的。
 */
export function IdlePackCard({ userId }: { userId: string }) {
  const { state, failed, reload } = useIdleStatus(userId)
  const [now, setNow] = useState(() => Date.now())
  const [claiming, setClaiming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  if (!state) {
    return (
      <div className="idle-card" aria-busy={!failed}>
        <b className="idle-card__title">挂机包</b>
        <span className="idle-card__hint">{failed ? "加载失败，稍后自动重试" : "加载中…"}</span>
      </div>
    )
  }

  const { status } = state
  const capSeconds = status.dailyLimit * IDLE_SECONDS_PER_PACK
  const full = status.onlineSeconds >= capSeconds
  // 页面在前台才估算；后台标签页的计时不会算进去，等下次校准
  const elapsed = document.visibilityState === "visible" ? Math.max(0, Math.floor((now - state.at) / 1000)) : 0
  const seconds = full ? capSeconds : Math.min(capSeconds, status.onlineSeconds + elapsed)
  const earned = Math.floor(seconds / IDLE_SECONDS_PER_PACK)
  const claimable = Math.max(0, earned - status.claimedToday)
  const dayDone = status.claimedToday >= status.dailyLimit
  const atCap = earned >= status.dailyLimit
  const progress = atCap ? 1 : (seconds % IDLE_SECONDS_PER_PACK) / IDLE_SECONDS_PER_PACK

  const claim = async () => {
    if (claiming || claimable <= 0) return
    setClaiming(true)
    setMessage(null)
    try {
      const res = await request<{ claimed: number }>(`/api/users/${userId}/packs/idle/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      setMessage(`领到了 ${res.claimed} 个挂机包`)
      emitDeskData("packs")
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "领取失败，请稍后再试")
    } finally {
      await reload()
      setClaiming(false)
    }
  }

  return (
    <div className="idle-card">
      <div className="idle-card__head">
        <b className="idle-card__title">挂机包</b>
        <span className={`idle-card__dot ${failed ? "is-off" : ""}`} title={failed ? "连接不上服务器" : "在线累计中"}>
          {failed ? "连接中断" : "在线累计中"}
        </span>
      </div>
      <div
        className="idle-card__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={status.dailyLimit}
        aria-valuenow={Math.min(earned, status.dailyLimit)}
        aria-label="今日挂机包累计"
      >
        <i style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <div className="idle-card__row">
        <span>
          今日已累计 <b>{Math.min(earned, status.dailyLimit)}</b> / {status.dailyLimit}
        </span>
        <span>已领 {status.claimedToday}</span>
      </div>
      <button type="button" className="bk-btn bk-btn--main idle-card__claim" disabled={claiming || claimable <= 0} onClick={claim}>
        {claiming ? "领取中…" : claimable > 0 ? `领取 ${claimable} 个` : dayDone ? "今天领满了" : "再等一会儿"}
      </button>
      <span className="idle-card__hint">
        {dayDone
          ? "每天北京时间 4:00 重新开始累计"
          : atCap
            ? "今天累计满了，领完等 4:00 重置"
            : `下一个还差 ${IDLE_SECONDS_PER_PACK - (seconds % IDLE_SECONDS_PER_PACK)} 秒 · 离线不累计`}
      </span>
      {message ? (
        <span className="idle-card__hint" role="status">
          {message}
        </span>
      ) : null}
    </div>
  )
}
