import { useState } from "react"

import { playSfx } from "@/audio/sfx"

import { emailLogin, emailRegister } from "@/desk/session/api"
import { GuestLoginButton } from "@/desk/login/GuestLoginButton"
import "@/desk/book.css"
import "@/desk/login/login-page.css"

type Mode = "login" | "register"

/** 独立登录页：osu! / 邮箱 / 游客三条入口。osu! 是主入口，只有它带本体卡 */
export function LoginPage() {
  const [mode, setMode] = useState<Mode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 每次出错加一，让错误条重新挂载、再抖一次 */
  const [errorSeq, setErrorSeq] = useState(0)

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
      playSfx("success")
      // 注册后还要走一次新手引导（领新手包）
      window.location.href = "/"
    } catch (reason) {
      playSfx("error")
      setError(reason instanceof Error ? reason.message : "登录失败")
      setErrorSeq((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <main className="login-card">
        <header className="login-head">
          <img className="login-logo login-logo--dark" src="/brand/choke-lockup-horizontal-light.svg" alt="Choke!" />
          <img className="login-logo login-logo--light" src="/brand/choke-lockup-horizontal.svg" alt="" aria-hidden />
          <p className="login-sub">把 osu! 玩家数据做成卡牌</p>
        </header>

        <section className="login-block">
          <a className="bk-btn bk-btn--main login-big" href="/auth/osu" data-sfx="send">
            用 osu! 登录
          </a>
          <p className="bk-note login-hint">首次登录会自动建号，并拿到你自己的本体卡。</p>
        </section>

        <div className="login-divider" role="separator">
          <span>或者用邮箱</span>
        </div>

        <section className="login-block">
          <div className="login-tabs" role="tablist" aria-label="邮箱登录或注册" data-mode={mode}>
            {(["login", "register"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
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
              <label className="login-field login-field--new">
                <span className="bk-label">昵称（可选）</span>
                <input
                  className="bk-input"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  maxLength={24}
                  placeholder="不填就用邮箱前缀"
                />
              </label>
            )}
            <label className="login-field">
              <span className="bk-label">邮箱</span>
              <input
                className="bk-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </label>
            <label className="login-field">
              <span className="bk-label">密码</span>
              <input
                className="bk-input"
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
              <p key={errorSeq} className="login-error" role="alert">
                {error}
              </p>
            )}

            {/* 成败各有专属音效，按下去这一下不再叠默认的按键音 */}
            <button
              type="submit"
              className="bk-btn login-big"
              disabled={busy}
              aria-busy={busy || undefined}
              data-sfx="none"
            >
              {busy ? (mode === "register" ? "注册中…" : "登录中…") : mode === "register" ? "注册并进入" : "登录"}
            </button>
          </form>
        </section>

        <footer className="login-foot">
          <GuestLoginButton className="bk-btn bk-btn--ghost login-big" label="先以游客试玩" />
          <p className="bk-note login-hint">游客可以开包和战斗，但不能用市场；邮箱或 osu! 账号才可以交易。</p>
          <a className="login-back" href="/">
            <span aria-hidden>‹</span> 返回桌面
          </a>
        </footer>
      </main>
    </div>
  )
}
