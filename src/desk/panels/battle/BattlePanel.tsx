import { useEffect, useState } from "react"

import { playSfx } from "@/audio/sfx"
import { battlePower } from "@/card/data"
import { TUTORIAL_ENCOUNTER_ID, type EncounterSummary } from "@choke/shared/battle/content"
import { useTutorialProgress } from "@/tutorial/store"

import {
  fetchDeck,
  fetchEncounters,
  toFace,
  type ApiDeck,
} from "@/desk/session/api"
import { Pages } from "@/desk/shell/BookPages"
import { GuestLoginButton } from "@/desk/login/GuestLoginButton"
import { useGameConfig } from "@/desk/session/useGameConfig"
import "@/desk/panels/battle/battle-panel.css"

export function BattlePanel({
  userId,
  onOpenDeck,
}: {
  userId: string | null
  onOpenDeck: () => void
}) {
  const tutorial = useTutorialProgress(userId)
  const [deck, setDeck] = useState<ApiDeck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null)
  const [encounters, setEncounters] = useState<EncounterSummary[] | null>(null)
  const [reload, setReload] = useState(0)
  const config = useGameConfig()

  useEffect(() => {
    let cancelled = false
    fetchEncounters()
      .then((list) => {
        if (!cancelled) setEncounters(list)
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "加载遭遇列表失败")
        }
      })
    return () => {
      cancelled = true
    }
  }, [reload])

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    fetchDeck(userId, controller.signal)
      .then((data) => setDeck(data))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return
        setError(reason instanceof Error ? reason.message : "加载卡组失败")
      })
    return () => controller.abort()
  }, [userId, reload])

  if (!userId) {
    return (
      <Pages
        left={<p className="bk-note">带上卡组，和练习对手打一场。</p>}
        right={
          <div className="bk-empty">
            <span>登录后开始战斗</span>
            <div className="login-actions">
              <a className="bk-btn bk-btn--main" href="/auth/osu">
                用 osu! 登录
              </a>
              <GuestLoginButton className="bk-btn bk-btn--ghost" />
            </div>
          </div>
        }
      />
    )
  }
  if (error || !deck) {
    return (
      <Pages
        left={<p className="bk-note">带上卡组，和练习对手打一场。</p>}
        right={
          <div className={`bk-empty ${error ? "bk-error" : ""}`} role={error ? "alert" : "status"}>
            <span>{error ?? "加载卡组…"}</span>
            {error && (
              <button
                type="button"
                className="bk-btn bk-btn--sm"
                onClick={() => {
                  setError(null)
                  setReload((value) => value + 1)
                }}
              >
                重试
              </button>
            )}
          </div>
        }
      />
    )
  }

  const cards = deck.slots.flatMap((slot) => (slot.card ? [slot.card] : []))
  const totalBp = cards.reduce(
    (sum, card) => sum + battlePower(toFace(card)),
    0
  )
  const tutorialBattleStep = tutorial.tutorialStep === "battle-view"
  const listed = encounters?.filter((e) => e.listed) ?? []
  const activeEncounter = tutorialBattleStep
    ? encounters?.find((e) => e.id === TUTORIAL_ENCOUNTER_ID)
    : (listed.find((e) => e.id === selectedStageId) ?? listed[0])

  const enemy = (
    <div className="bk-box battle-enemy">
      <span className="bk-label">
        {tutorialBattleStep ? "教学对手" : (activeEncounter?.title ?? "对手")}
      </span>
      <b className="battle-enemy__name">{activeEncounter?.name ?? "加载中…"}</b>
      <div className="bk-stat">
        <b>{activeEncounter ? activeEncounter.hp.toLocaleString("en-US") : "—"}</b>
        <span>敌人 HP</span>
      </div>
      {!tutorialBattleStep && (
        <div className="battle-stages">
          {listed.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`bk-btn battle-stage ${entry.id === activeEncounter?.id ? "bk-btn--main" : "bk-btn--ghost"}`}
              aria-pressed={entry.id === activeEncounter?.id}
              onClick={() => {
                if (entry.id === activeEncounter?.id) return
                playSfx("click")
                setSelectedStageId(entry.id)
              }}
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  if (cards.length === 0 && !tutorialBattleStep) {
    return (
      <Pages
        left={
          <div className="bk-empty">
            <span>卡组里还没有卡</span>
            <button
              type="button"
              className="bk-btn bk-btn--main"
              onClick={onOpenDeck}
            >
              去卡组
            </button>
          </div>
        }
        right={
          <>
            {enemy}
            <p className="bk-note">至少放 1 张卡进卡组才能出战。</p>
          </>
        }
      />
    )
  }

  return (
    <Pages
      left={
        <>
          <div className="battle-stats">
            <div className="bk-stat">
              <b>
                {cards.length} <small>/ {config?.deckSize ?? deck.slots.length}</small>
              </b>
              <span>出战卡牌</span>
            </div>
            <div className="bk-stat">
              <b>{totalBp.toLocaleString("en-US")}</b>
              <span>总战力</span>
            </div>
          </div>
          <div className="bk-list">
            {cards.map((card, index) => (
              <div className="bk-row" key={card.userCardId}>
                <span className="battle-row__no bk-num">{index + 1}</span>
                <span className="battle-row__name">{card.name}</span>
                <span className="bk-num">
                  {battlePower(toFace(card)).toLocaleString("en-US")}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="bk-btn bk-btn--ghost battle-edit"
            onClick={onOpenDeck}
          >
            调整卡组
          </button>
        </>
      }
      right={
        <>
          {enemy}
          <p className="bk-note">
            开局 2 AP，靠 Combo、防御档位和技能应对敌方预告的意图。技能按 14
            个子职业分池，卡组不满也可以出战。
          </p>
          {tutorialBattleStep ? (
            <>
              <p className="bk-note">
                教学战 · 不计排名，不会掉 pp。系统会自动为你挑最合适的前排上阵。
              </p>
              <a
                className="bk-btn bk-btn--main bk-btn--block battle-start"
                data-tutorial-id="battle-tutorial-start"
                href="/battle?tutorial=1"
              >
                进入教学对战
              </a>
            </>
          ) : activeEncounter ? (
            <a
              className="bk-btn bk-btn--main bk-btn--block battle-start"
              href={`/battle?stage=${encodeURIComponent(activeEncounter.id)}`}
            >
              进入战斗（{activeEncounter.name}）
            </a>
          ) : (
            <span className="bk-btn bk-btn--main bk-btn--block battle-start" aria-disabled="true">
              加载对手…
            </span>
          )}

          {!tutorialBattleStep && (
            <>
              <hr className="bk-divider" />
              <span className="bk-label">远征</span>
              <p className="bk-note">走地图、做选择、连打几场战斗，奖励攒到最后一次结算。</p>
              <a className="bk-btn bk-btn--block" data-tutorial-id="expedition-entry" href="/expedition">
                进入远征
              </a>
            </>
          )}
        </>
      }
    />
  )
}
