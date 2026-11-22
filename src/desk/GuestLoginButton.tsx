import { useEffect, useState } from "react"

/**
 * 游客入口：跳过 osu! OAuth，直接创建一个 guest-xxxx 账号进入桌面。
 * 登录由 API 的 GET /auth/guest 完成，随后重定向回桌面。
 */
export function GuestLoginButton({
  className = "bk-btn",
  label = "游客账户",
}: {
  className?: string
  label?: string
}) {
  const [busy, setBusy] = useState(false)

  // 从 bfcache 返回时页面状态是旧的：把「进入中」复位
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false)
    }
    window.addEventListener("pageshow", reset)
    return () => window.removeEventListener("pageshow", reset)
  }, [])

  return (
    <a
      className={className}
      href="/auth/guest"
      title="不绑定 osu!，直接试用桌面；游客没有本体卡"
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      style={busy ? { pointerEvents: "none", opacity: 0.7 } : undefined}
      onClick={(event) => {
        if (busy) {
          event.preventDefault()
          return
        }
        setBusy(true)
      }}
    >
      {busy ? "进入中…" : label}
    </a>
  )
}
