import { useEffect, useState, type CSSProperties } from "react"

import { playSfx } from "@/audio/sfx"
import { STAGE_PRESETS, TUTORIAL_ENEMY_HP } from "@/battle/engine"
import { battlePower } from "@/card/data"
import { DUNGEONS } from "@choke/shared/dungeons"
import { useTutorialProgress } from "@/tutorial/store"

import {
  fetchDeck,
  fetchStamina,
  runDungeon,
  toFace,
  type ApiDeck,
  type StaminaState,
} from "./api"
import { Pages } from "./BookPages"
import { emitDeskData } from "./events"
import { GuestLoginButton } from "./GuestLoginButton"
import { useGameConfig } from "./useGameConfig"
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
  const [stamina, setStamina] = useState<StaminaState | null>(null)
  const [dungeonBusy, setDungeonBusy] = useState<string | null>(null)
  const [dungeonMessage, setDungeonMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [reload, setReload] = useState(0)
  const config = useGameConfig()

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    fetchStamina(userId, controller.signal)
      .then((data) => setStamina(data))
      .catch(() => {})
    return () => controller.abort()
  }, [userId])

  const runDungeonById = async (dungeonId: string) => {
    if (!userId || dungeonBusy) return
    setDungeonBusy(dungeonId)
    setDungeonMessage(null)
    try {
      const result = await runDungeon(userId, dungeonId)
      setStamina(result.stamina)
      const parts: string[] = []
      if (result.rewards.essence) parts.push(`精华 +${result.rewards.essence}`)
      if (result.rewards.coins) parts.push(`金币 +${result.rewards.coins}`)
      if (result.rewards.packs) parts.push(`普通卡包 +${result.rewards.packs}`)
      playSfx(result.rewards.packs ? "levelup" : "success")
      setDungeonMessage({ text: `通关：${parts.join(" · ")}` })
      emitDeskData("packs")
    } catch (reason) {
      playSfx("error")
      setDungeonMessage({
        text: reason instanceof Error ? reason.message : "副本失败",
        error: true,
      })
    } finally {
      setDungeonBusy(null)
    }
  }

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
        <div className="battle-stages">
          {STAGE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`bk-btn battle-stage ${preset.id === activePreset.id ? "bk-btn--main" : "bk-btn--ghost"}`}
              aria-pressed={preset.id === activePreset.id}
              onClick={() => {
                if (preset.id === activePreset.id) return
                playSfx("click")
                setSelectedStageId(preset.id)
              }}
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

          <hr className="bk-divider" />

          <div className="dungeon-head">
            <span className="bk-label">资源副本</span>
            <b className="bk-num">
              {stamina ? `${stamina.value} / ${stamina.max}` : "—"}
            </b>
          </div>
          <div
            className="bk-bar dungeon-stamina"
            style={{ "--p": stamina ? (stamina.value / Math.max(1, stamina.max)) * 100 : 0 } as CSSProperties}
            role="progressbar"
            aria-label="体力"
            aria-valuemin={0}
            aria-valuemax={stamina?.max ?? 0}
            aria-valuenow={stamina?.value ?? 0}
          >
            <i />
          </div>
          {stamina && stamina.value < stamina.max && (
            <p className="bk-note">
              下一点体力：{Math.ceil(stamina.nextIn / 60000)} 分钟后
            </p>
          )}

          <div className="dungeon-list">
            {DUNGEONS.map((dungeon) => {
              const disabled =
                !stamina || stamina.value < dungeon.cost || dungeonBusy !== null
              return (
                <div className="dungeon-row" key={dungeon.id}>
                  <div className="dungeon-row__text">
                    <b>{dungeon.name}</b>
                    <span>{dungeon.summary}</span>
                  </div>
                  <button
                    type="button"
                    className="bk-btn bk-btn--sm"
                    disabled={disabled}
                    onClick={() => void runDungeonById(dungeon.id)}
                  >
                    {dungeonBusy === dungeon.id ? "挑战中…" : `${dungeon.cost} 体力`}
                  </button>
                </div>
              )
            })}
          </div>

          {dungeonMessage && (
            <div
              className={`bk-box dungeon-message ${dungeonMessage.error ? "bk-error" : ""}`}
              role={dungeonMessage.error ? "alert" : "status"}
            >
              {dungeonMessage.text}
            </div>
          )}
        </>
      }
    />
  )
}
