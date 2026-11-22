import { useState } from "react"

import { emailLogin, emailRegister } from "./api"
import { GuestLoginButton } from "./GuestLoginButton"
import "./login-page.css"

type Mode = "login" | "register"

/** 独立登录页：osu! / 邮箱 / 游客三条入口。 */
export function LoginPage() {
  const [mode, setMode] = useState<Mode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const switchMode = (next: Mode) => {
    if (next === mode) return
    setMode(next)
    setError(null)
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (mode === "register") {
        await emailRegister(email, password, username || undefined)
      } else {
        await emailLogin(email, password)
      }
      // 注册后还要走一次新手引导（领新手包）
      window.location.href = "/"
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <img className="login-logo" src="/brand/choke-lockup-horizontal-light.svg" alt="Choke!" />
        <p className="login-sub">把 osu! 玩家数据做成卡牌</p>

        <div className="login-tabs" role="tablist" aria-label="登录方式">
          {(["login", "register"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              data-active={mode === value ? "true" : undefined}
              disabled={busy}
              onClick={() => switchMode(value)}
            >
              {value === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          {mode === "register" && (
            <label>
              <span>昵称（可选）</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                maxLength={24}
                placeholder="不填就用邮箱前缀"
              />
            </label>
          )}
          <label>
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </label>
          <label>
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              minLength={8}
              placeholder="至少 8 位"
              required
            />
          </label>

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="login-submit" disabled={busy} aria-busy={busy || undefined}>
            {busy ? (mode === "register" ? "注册中…" : "登录中…") : mode === "register" ? "注册并进入" : "登录"}
          </button>
        </form>

        <div className="login-divider">
          <span>或</span>
        </div>

        <div className="login-other">
          <a className="login-osu" href="/auth/osu">
            用 osu! 登录
          </a>
          <GuestLoginButton className="login-guest" label="游客试用（不能用市场）" />
        </div>

        <p className="login-note">
          游客账号可以体验开包与战斗，但无法使用市场；邮箱或 osu! 账号才可以交易。
        </p>

        <a className="login-back" href="/">
          ← 返回桌面
        </a>
      </div>
    </div>
  )
}
