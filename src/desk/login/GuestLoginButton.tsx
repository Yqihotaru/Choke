import { useEffect, useState } from "react"

import { createGuest } from "@/desk/session/api"

/**
 * 游客入口：跳过 osu! OAuth，直接创建一个 guest-xxxx 账号进入桌面。
 * 用 POST：带副作用的 GET 会被预取 / 跨站导航触发，等于替访问者切换登录态。
 */
export function GuestLoginButton({
  className = "bk-btn",
  label = "游客账户",
}: {
  className?: string
  label?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 从 bfcache 返回时页面状态是旧的：把「进入中」复位
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setBusy(false)
        setError(null)
      }
    }
    window.addEventListener("pageshow", reset)
    return () => window.removeEventListener("pageshow", reset)
  }, [])

  const start = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await createGuest()
      window.location.href = "/"
    } catch (reason) {
      setBusy(false)
      setError(reason instanceof Error ? reason.message : "游客登录失败，请稍后再试")
    }
  }

  return (
    <button
      type="button"
      className={className}
      title={error ?? "不绑定 osu!，直接试用桌面；游客没有本体卡"}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      style={busy ? { pointerEvents: "none", opacity: 0.7 } : undefined}
      onClick={() => void start()}
    >
      {busy ? "进入中…" : error ? "进入失败，点此重试" : label}
    </button>
  )
}
