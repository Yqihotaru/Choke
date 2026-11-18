import { useEffect, useRef, useState } from "react"

import { fetchDeck, toFace, type ApiDeck } from "@/desk/api"
import { GuestLoginButton } from "@/desk/GuestLoginButton"
import { advanceTutorial, grantExp, useTutorialProgress } from "@/tutorial/store"

import { cloneBattle, createBattle, endTurn, playSkill, raiseDefense } from "./engine"
import { BattleStage } from "./BattleStage"
import type { BattleState } from "./types"
import "./battle.css"

interface ApiUser {
  id: string
  username: string
}

export function BattlePage() {
  const [user, setUser] = useState<ApiUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [deck, setDeck] = useState<ApiDeck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [battle, setBattle] = useState<BattleState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const tutorialMode =
    new URLSearchParams(window.location.search).get("tutorial") === "1"
  const progress = useTutorialProgress(user?.id ?? null)
  const tutorialRun = tutorialMode && progress.tutorialStep === "battle-view"
  const tutorialFinished =
    tutorialMode && progress.tutorialStep === "battle-result"
  const tutorialBattle = tutorialRun || tutorialFinished
  const rewarded = useRef(false)
  const normalRewarded = useRef(false)

  useEffect(() => {
    let cancelled = false
    fetch("/auth/me", { credentials: "include" })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return
        if (data.ok) setUser({ id: data.data.id, username: data.data.username })
        else setUser(null)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    fetchDeck(user.id)
      .then((data) => {
        if (!cancelled) setDeck(data)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "加载卡组失败")
      })
    return () => {
      cancelled = true
    }
  }, [user])

  // 教学战结束（胜负都算）后直接把教程推进到“结算”步骤
  useEffect(() => {
    if (!tutorialRun || !battle || rewarded.current) return
    if (battle.phase !== "won" && battle.phase !== "lost") return
    rewarded.current = true
    advanceTutorial("battle-result", 70)
  }, [battle, tutorialRun])

  // 普通 PvE 也给玩家等级经验，保证教程后仍能继续升级
  useEffect(() => {
    if (tutorialBattle || !battle || normalRewarded.current) return
    if (battle.phase !== "won" && battle.phase !== "lost") return
    normalRewarded.current = true
    grantExp(battle.phase === "won" ? 20 : 8)
  }, [battle, tutorialBattle])

  if (loading) return <div className="battle-page battle-page--center">加载中…</div>
  if (!user) {
    return (
      <div className="battle-page battle-page--center">
        <div className="battle-gate">
          <span>CHOKE! · BATTLE</span>
          <h1>需要先登录</h1>
          <p>战斗读取你账号里保存的出战卡组。</p>
          <a href="/auth/osu">用 osu! 登录</a>
          <GuestLoginButton className="battle-guest" label="以游客身份进入" />
        </div>
      </div>
    )
  }
  if (error) return <div className="battle-page battle-page--center">{error}</div>
  if (!deck) return <div className="battle-page battle-page--center">加载卡组…</div>

  const cards = deck.slots.flatMap((slot) => (slot.card ? [slot.card] : []))

  if (cards.length === 0) {
    return (
      <div className="battle-page battle-page--center">
        <div className="battle-gate">
          <span>CHOKE! · BATTLE</span>
          <h1>卡组里还没有卡</h1>
          <p>回桌面，把卡拖进卡组；至少 1 张就能出战。</p>
          <a href="/">回桌面</a>
        </div>
      </div>
    )
  }

  const start = () => {
    setActionError(null)
    normalRewarded.current = false
    setBattle(
      createBattle(
        cards.map((card) => ({
          uid: card.userCardId,
          cardId: card.id,
          face: toFace(card),
        })),
        { tutorial: tutorialRun },
      ),
    )
  }

  if (tutorialFinished && !battle) {
    return (
      <div className="battle-page battle-page--center">
        <div className="battle-gate">
          <span>TUTORIAL · CLEARED</span>
          <h1>教学战已经完成了</h1>
          <p>回桌面继续教程结算吧。</p>
          <a href="/">回桌面</a>
        </div>
      </div>
    )
  }

  const enemy = battle?.enemy ?? createBattle([], { tutorial: tutorialRun }).enemy

  const play = (index: number, skillId: string) => {
    if (!battle) return
    const next = cloneBattle(battle)
    const message = playSkill(next, index, skillId)
    setBattle(next)
    setActionError(message)
  }

  const defend = (tier: number) => {
    if (!battle) return
    const next = cloneBattle(battle)
    const message = raiseDefense(next, tier)
    setBattle(next)
    setActionError(message)
  }

  const finishTurn = () => {
    if (!battle) return
    const next = cloneBattle(battle)
    const message = endTurn(next)
    setBattle(next)
    setActionError(message)
  }

  return (
    <BattleStage
      battle={battle}
      deck={cards.map(toFace)}
      enemyName={enemy.name}
      enemyElement={enemy.element}
      enemyHp={enemy.hpMax}
      tutorial={tutorialRun}
      actionError={actionError}
      onStart={start}
      onPlay={play}
      onDefend={defend}
      onEndTurn={finishTurn}
      onRestart={start}
    />
  )
}
