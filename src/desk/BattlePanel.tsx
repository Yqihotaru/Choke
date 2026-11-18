import { useEffect, useState } from "react"

import { STAGE_PRESETS, TUTORIAL_ENEMY_HP } from "@/battle/engine"
import { battlePower } from "@/card/data"
import { useTutorialProgress } from "@/tutorial/store"

import { fetchDeck, toFace, type ApiDeck } from "./api"
import { Pages } from "./BookPages"
import { GuestLoginButton } from "./GuestLoginButton"
import "./battle-panel.css"

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
  const [selectedStageId, setSelectedStageId] = useState<string>(STAGE_PRESETS[0]!.id)

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
  }, [userId])

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
          <div className={`bk-empty ${error ? "bk-error" : ""}`}>
            {error ?? "加载卡组…"}
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
  const activePreset =
    STAGE_PRESETS.find((s) => s.id === selectedStageId) ?? STAGE_PRESETS[0]!
  const enemyHp = tutorialBattleStep ? TUTORIAL_ENEMY_HP : activePreset.hp

  const enemy = (
    <div className="bk-box battle-enemy">
      <span className="bk-label">
        {tutorialBattleStep ? "教学对手" : activePreset.title}
      </span>
      <b className="battle-enemy__name">
        {tutorialBattleStep ? "谱面幽灵（教学）" : activePreset.name}
      </b>
      <div className="bk-stat">
        <b>{enemyHp.toLocaleString("en-US")}</b>
        <span>敌人 HP</span>
      </div>
      {!tutorialBattleStep && (
        <div style={{ display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
          {STAGE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`bk-btn ${preset.id === activePreset.id ? "bk-btn--main" : "bk-btn--ghost"}`}
              style={{ padding: "3px 8px", fontSize: "12px" }}
              onClick={() => setSelectedStageId(preset.id)}
            >
              {preset.name}
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
                {cards.length} <small>/ 7</small>
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
            cards.length > 0 ? (
              <>
                <p className="bk-note">教学战 · 不计排名，不会掉 pp。</p>
                <a
                  className="bk-btn bk-btn--main bk-btn--block battle-start"
                  data-tutorial-id="battle-tutorial-start"
                  href="/battle?tutorial=1"
                >
                  进入教学对战
                </a>
              </>
            ) : (
              <>
                <p className="bk-note">
                  教学战至少需要 1 张卡，先去卡组上阵再回来。
                </p>
                <button
                  type="button"
                  className="bk-btn bk-btn--main bk-btn--block"
                  data-tutorial-id="battle-go-deck"
                  onClick={onOpenDeck}
                >
                  去卡组上阵
                </button>
              </>
            )
          ) : (
            <a
              className="bk-btn bk-btn--main bk-btn--block battle-start"
              href={`/battle?stage=${activePreset.id}`}
            >
              进入战斗（{activePreset.name}）
            </a>
          )}
        </>
      }
    />
  )
}
