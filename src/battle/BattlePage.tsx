import { useEffect, useRef, useState } from "react"

import {
  fetchDeck,
  fetchEncounter,
  fetchEncounters,
  fetchMe,
  fetchUserCards,
  toFace,
  type ApiDeck,
  type ApiUserCard,
} from "@/desk/api"
import { GuestLoginButton } from "@/desk/GuestLoginButton"
import { advanceTutorial, useTutorialProgress } from "@/tutorial/store"

import { createBattle } from "@choke/shared/battle/engine"
import { withAction, type BattleAction } from "@choke/shared/battle/actions"
import { TUTORIAL_ENCOUNTER_ID, type EncounterSpec, type EncounterSummary } from "@choke/shared/battle/content"
import type { BattleState } from "@choke/shared/battle/types"
import { randomSeed } from "@choke/shared/rng"
import { BattleStage } from "./view/BattleStage"
import "./battle.css"

interface ApiUser {
  id: string
  username: string
}

export function BattlePage() {
  const [user, setUser] = useState<ApiUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [deck, setDeck] = useState<ApiDeck | null>(null)
  const [extraCards, setExtraCards] = useState<ApiUserCard[]>([])
  const [error, setError] = useState<string | null>(null)
  const [battle, setBattle] = useState<BattleState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const searchParams = new URLSearchParams(window.location.search)
  const tutorialMode = searchParams.get("tutorial") === "1"
  const [stageId, setStageId] = useState<string | null>(searchParams.get("stage"))
  const [encounters, setEncounters] = useState<EncounterSummary[] | null>(null)
  const [encounter, setEncounter] = useState<EncounterSpec | null>(null)

  const progress = useTutorialProgress(user?.id ?? null)
  const tutorialRun = tutorialMode && progress.tutorialStep === "battle-view"
  const tutorialFinished = tutorialMode && progress.tutorialStep === "battle-result"
  const rewarded = useRef(false)
  /** 本场已执行的合法操作；第 4 步上传给服务端复算 */
  const actions = useRef<BattleAction[]>([])

  // 链接里的 stage 不存在时回落到列表第一场
  const listed = encounters?.filter((e) => e.listed) ?? []
  const encounterId = tutorialRun
    ? TUTORIAL_ENCOUNTER_ID
    : (listed.find((e) => e.id === stageId) ?? listed[0])?.id ?? null

  useEffect(() => {
    let cancelled = false
    fetchMe()
      .then((data) => {
        if (cancelled) return
        setUser({ id: data.id, username: data.username })
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
    Promise.all([
      fetchDeck(user.id),
      fetchUserCards(user.id, { sort: "rarity", limit: 20 }).catch(() => ({
        rows: [] as ApiUserCard[],
        total: 0,
        limit: 20,
        offset: 0,
      })),
    ])
      .then(([deckData, cardPage]) => {
        if (cancelled) return
        setDeck(deckData)
        setExtraCards(cardPage.rows)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "加载卡组失败")
      })
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    let cancelled = false
    fetchEncounters()
      .then((list) => {
        if (!cancelled) setEncounters(list)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "加载关卡失败")
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!encounterId) return
    let cancelled = false
    fetchEncounter(encounterId)
      .then((spec) => {
        if (!cancelled) setEncounter(spec)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "加载关卡失败")
      })
    return () => {
      cancelled = true
    }
  }, [encounterId])

  // 教学战结束（胜负都算）后直接把教程推进到“结算”步骤
  useEffect(() => {
    if (!tutorialRun || !battle || rewarded.current) return
    if (battle.phase !== "won" && battle.phase !== "lost") return
    rewarded.current = true
    advanceTutorial("battle-view")
  }, [battle, tutorialRun])

  // 普通 PvE 暂不发玩家经验：战斗还在客户端结算，服务端无法校验（第 3 步战斗引擎进 shared 后由服务端复算发放）

  if (loading) return <div className="battle-page battle-page--center">加载中…</div>
  if (!user) {
    return (
      <div className="battle-page battle-page--center">
        <div className="battle-gate">
          <span>CHOKE! · BATTLE</span>
          <h1>需要先登录</h1>
          <p>战斗读取你账号里保存的出战卡组与替补席。</p>
          <a href="/auth/osu">用 osu! 登录</a>
          <GuestLoginButton className="battle-guest" label="以游客身份进入" />
        </div>
      </div>
    )
  }
  if (error) return <div className="battle-page battle-page--center">{error}</div>
  if (!deck) return <div className="battle-page battle-page--center">加载卡组…</div>
  // 战前切关时等新遭遇到手再渲染，避免用旧关卡开战；已开战则不受影响（如教学战结束后教程步骤变化）
  if (!encounter || (!battle && encounter.id !== encounterId)) {
    return <div className="battle-page battle-page--center">加载关卡…</div>
  }

  const cards = deck.slots.flatMap((slot) => (slot.card ? [slot.card] : []))
  const deckCardUids = new Set(cards.map((c) => c.userCardId))
  const benchCards = extraCards.filter((c) => !deckCardUids.has(c.userCardId)).slice(0, 8)

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
    actions.current = []
    setBattle(
      createBattle(
        encounter,
        cards.map((card) => ({
          uid: card.userCardId,
          cardId: card.id,
          face: toFace(card),
        })),
        {
          // 第 4 步改为服务端下发种子；现在本地试玩先在前端生成
          seed: randomSeed(),
          bench: benchCards.map((card) => ({
            uid: card.userCardId,
            cardId: card.id,
            face: toFace(card),
          })),
        },
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

  const act = (action: BattleAction) => {
    if (!battle) return
    const { state: next, error } = withAction(battle, action)
    if (!error) {
      actions.current.push(action)
      setBattle(next)
    }
    setActionError(error)
  }

  const play = (card: number, skill: string) => act({ type: "skill", card, skill })
  const defend = (tier?: number) => act({ type: "defend", tier })
  const swap = (slot: number, benchUid: number) => act({ type: "swap", slot, benchUid })
  const finishTurn = () => act({ type: "endTurn" })

  return (
    <BattleStage
      battle={battle}
      playerName={user?.username ?? "玩家"}
      deck={cards.map(toFace)}
      encounter={encounter}
      encounters={listed}
      tutorial={tutorialRun}
      actionError={actionError}
      onSelectStage={(nextId) => setStageId(nextId)}
      onStart={start}
      onPlay={play}
      onDefend={defend}
      onSwap={swap}
      onEndTurn={finishTurn}
      onRestart={start}
    />
  )
}
