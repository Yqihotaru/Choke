import { useCallback, useEffect, useState } from "react"

import { GuestLoginButton } from "@/desk/login/GuestLoginButton"
import { fetchMe, fetchStamina, type StaminaState } from "@/desk/session/api"
import type { ExpeditionSettlement, ExpeditionView } from "@choke/shared/expedition/view"

import {
  abandonExpedition,
  fetchCurrentExpedition,
  fetchExpeditionMaps,
  resumeExpedition,
  settleExpedition,
  suspendExpedition,
  type MapListing,
} from "./api"
import { RewardChips, errorText, useExpeditionTheme } from "./common"
import { Fight, LineupPicker } from "./ExpeditionBattle"
import { MapSelect } from "./MapSelect"
import { Prepare } from "./Prepare"
import { RunView } from "./RunView"
import "./expedition.css"

type Screen =
  | { name: "select" }
  | { name: "prepare"; map: MapListing }
  | { name: "run"; view: ExpeditionView }
  | { name: "settled"; result: ExpeditionSettlement }

const END_TEXT: Record<ExpeditionSettlement["end"], string> = {
  cleared: "通关结算",
  early: "到此结算",
  abandoned: "已放弃",
  expired: "到期结算",
}

export function ExpeditionPage() {
  const [theme, toggleTheme] = useExpeditionTheme()
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [maps, setMaps] = useState<MapListing[]>([])
  const [stamina, setStamina] = useState<StaminaState | null>(null)
  const [screen, setScreen] = useState<Screen>({ name: "select" })
  /** 登录后发现还有没结束的出征：先让玩家决定继续、结算还是放弃 */
  const [unfinished, setUnfinished] = useState<ExpeditionView | null>(null)
  const [userName, setUserName] = useState("")
  /** 站在战斗格上点了"进入战斗"：整屏换成战斗界面，打完点"继续前进"或"返回地图"回来 */
  const [inBattle, setInBattle] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (id: string) => {
    const [list, stam] = await Promise.all([fetchExpeditionMaps(id), fetchStamina(id).catch(() => null)])
    setMaps(list)
    setStamina(stam)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const me = await fetchMe()
        if (cancelled) return
        setUserId(me.id)
        setUserName(me.username)
        const current = await fetchCurrentExpedition(me.id)
        if (cancelled) return
        setUnfinished(current)
        await refresh(me.id)
      } catch (reason) {
        if (!cancelled) {
          // 没登录时 fetchMe 会报错，走登录提示
          setLoadError(errorText(reason))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const guard = async (job: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await job()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const goSettled = async (result: ExpeditionSettlement) => {
    setUnfinished(null)
    setInBattle(false)
    setScreen({ name: "settled", result })
    if (userId) await refresh(userId).catch(() => undefined)
  }

  const resume = (view: ExpeditionView) =>
    guard(async () => {
      const next = view.status === "suspended" ? await resumeExpedition(userId!) : view
      setUnfinished(null)
      setScreen({ name: "run", view: next })
    })
  const settle = () => guard(async () => goSettled(await settleExpedition(userId!)))
  const abandon = () => {
    if (!window.confirm("放弃后不会有任何奖励，体力会全部退回。确定放弃这次出征吗？")) return
    return guard(async () => goSettled(await abandonExpedition(userId!)))
  }
  const suspend = () =>
    guard(async () => {
      await suspendExpedition(userId!)
      setInBattle(false)
      setScreen({ name: "select" })
      await refresh(userId!)
    })

  let body
  if (loading) {
    body = <div className="ex-center">正在读取出征……</div>
  } else if (!userId) {
    body = (
      <div className="ex-center">
        <h1>需要先登录</h1>
        <p>{loadError ?? "远征要读取你账号里的卡。"}</p>
        <div className="ex-actions">
          <a className="ex-btn ex-btn--primary" href="/auth/osu">
            用 osu! 登录
          </a>
          <GuestLoginButton className="ex-btn" label="以游客身份进入" />
          <a className="ex-btn" href="/">
            回桌面
          </a>
        </div>
      </div>
    )
  } else if (screen.name === "prepare") {
    body = (
      <Prepare
        userId={userId}
        map={screen.map}
        onBack={() => setScreen({ name: "select" })}
        onStarted={(view) => {
          setScreen({ name: "run", view })
          void refresh(userId).catch(() => undefined)
        }}
      />
    )
  } else if (screen.name === "run") {
    body = (
      <RunView
        userId={userId}
        view={screen.view}
        onView={(view) => setScreen({ name: "run", view })}
        menu={{ busy, error, onSuspend: suspend, onSettle: settle, onAbandon: abandon }}
        onEnterBattle={() => setInBattle(true)}
      />
    )
  } else if (screen.name === "settled") {
    const { result } = screen
    body = (
      <>
        <h1 className="ex-title">{END_TEXT[result.end]}</h1>
        <p className="ex-sub">
          星数 {result.stars} / {result.maxStars}
          {result.tier > 1 ? ` · ${result.tier} 档` : ""}
        </p>
        <div className="ex-box" style={{ maxWidth: 520 }}>
          <h4>获得</h4>
          <RewardChips reward={result.rewards} />
          {result.viaMail && <p className="ex-sub" style={{ marginTop: 8 }}>奖励已通过邮件发放。</p>}
          {result.objectives.length > 0 && (
            <>
              <h4 style={{ marginTop: 12 }}>通关目标</h4>
              {result.objectives.map((o) => (
                <div className="ex-row" key={o.text}>
                  <span>{o.text}</span>
                  <b>{o.met ? "达成" : "未达成"}</b>
                </div>
              ))}
            </>
          )}
          {(result.staminaSpent > 0 || result.staminaRefunded > 0) && (
            <div className="ex-row" style={{ marginTop: 8 }}>
              <span>体力</span>
              <b>
                {result.staminaSpent > 0 ? `扣了 ${result.staminaSpent}` : `退回 ${result.staminaRefunded}`}
              </b>
            </div>
          )}
          <button type="button" className="ex-btn ex-btn--primary" style={{ marginTop: 12 }} onClick={() => setScreen({ name: "select" })}>
            回到选图
          </button>
        </div>
      </>
    )
  } else {
    body = (
      <>
        {error && <div className="ex-note ex-note--error" style={{ marginBottom: 10 }}>{error}</div>}
        <MapSelect maps={maps} staminaValue={stamina?.value ?? null} onPick={(map) => setScreen({ name: "prepare", map })} />
      </>
    )
  }

  const battleView = screen.name === "run" ? screen.view.battle : null
  if (userId && screen.name === "run" && inBattle && battleView) {
    const view = screen.view
    const onView = (next: ExpeditionView) => setScreen({ name: "run", view: next })
    const back = () => setInBattle(false)
    if (battleView.lineup.length === 0) {
      return (
        <div className="ex" data-theme={theme}>
          <div className="ex-frame">
            <main className="ex-main">
              <LineupPicker userId={userId} view={view} onView={onView} onBack={back} />
            </main>
          </div>
        </div>
      )
    }
    return (
      <Fight
        key={`${battleView.nodeId}:${battleView.seed}`}
        userId={userId}
        userName={userName}
        view={view}
        onView={onView}
        onExit={back}
        onSettle={settle}
        onAbandon={abandon}
      />
    )
  }

  return (
    <div className="ex" data-theme={theme}>
      <div className="ex-frame">
        <main className={`ex-main${userId && screen.name === "run" ? " ex-main--run" : ""}`}>{body}</main>
        <nav className="ex-nav" aria-label="远征导航">
          <div className="ex-nav__brand">
            <b>CHOKE!</b>
            <span>
              远征{stamina ? ` · 体力 ${stamina.value}/${stamina.max}` : ""}
            </span>
          </div>
          <div className="ex-nav__items">
            <button
              type="button"
              className="ex-nav__btn"
              aria-current={screen.name === "select" || screen.name === "prepare"}
              onClick={() => screen.name !== "run" && setScreen({ name: "select" })}
            >
              <i aria-hidden>⚑</i>出征
            </button>
            <a className="ex-nav__btn" href="/">
              <i aria-hidden>⌂</i>桌面
            </a>
            <button type="button" className="ex-nav__btn" onClick={toggleTheme}>
              <i aria-hidden>{theme === "dark" ? "☀" : "☾"}</i>
              {theme === "dark" ? "浅色" : "深色"}
            </button>
          </div>
        </nav>
      </div>

      {unfinished && userId && (
        <div className="ex-modal" role="dialog" aria-modal="true" aria-label="未完成的出征">
          <div className="ex-dialog">
            <h2>还有一次没完成的出征</h2>
            <p>
              「{unfinished.map.name}」{unfinished.status === "suspended" ? "已保存退出" : "还在进行中"}，已攒下的奖励：
            </p>
            <RewardChips reward={unfinished.pending} />
            {error && <div className="ex-note ex-note--error">{error}</div>}
            <div className="ex-actions">
              <button type="button" className="ex-btn ex-btn--danger" disabled={busy} onClick={abandon}>
                放弃
              </button>
              <button type="button" className="ex-btn" disabled={busy} onClick={settle}>
                {unfinished.atEnd ? "通关结算" : "到此结算"}
              </button>
              <button type="button" className="ex-btn ex-btn--primary" disabled={busy} onClick={() => resume(unfinished)}>
                继续出征
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
