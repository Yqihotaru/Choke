import { useState, type CSSProperties } from "react"

import { ElementGlyph } from "@/card/CardFace"
import { GameCardFace } from "@/card/GameCardFace"
import { ELEMENT_COLOR, ELEMENT_LABEL, battlePower } from "@/card/data"
import type { CardFaceData, Element } from "@/card/types"

import { enemyDamageTier, teamHpOf } from "./engine"
import type { BattleState } from "./types"
import "./choke-battle.css"

/** 视觉预留 10 格；真正可用上限读 battle.apMax（默认 7）。 */
const AP_SLOTS = 10
const ROMAN = ["0", "I", "II", "III", "IV"] as const

interface Props {
  battle: BattleState | null
  deck: CardFaceData[]
  enemyName: string
  enemyElement: string
  enemyHp: number
  tutorial: boolean
  actionError: string | null
  onStart: () => void
  onPlay: (cardIndex: number, skillId: string) => void
  onDefend: (tier: number) => void
  onEndTurn: () => void
  onRestart: () => void
}

function elementColor(element: string) {
  return ELEMENT_COLOR[element as Element] ?? "#8a9099"
}

function elementLabel(element: string) {
  return ELEMENT_LABEL[element as Element] ?? element
}

export function BattleStage({
  battle,
  deck,
  enemyName,
  enemyElement,
  enemyHp,
  tutorial,
  actionError,
  onStart,
  onPlay,
  onDefend,
  onEndTurn,
  onRestart,
}: Props) {
  const [selected, setSelected] = useState<number | null>(null)
  const [previewAp, setPreviewAp] = useState(0)
  const [logOpen, setLogOpen] = useState(false)
  const apMax = battle?.apMax ?? 7

  if (!battle) {
    const totalBp = deck.reduce((sum, card) => sum + battlePower(card), 0)
    return (
      <div className="choke-viewport">
        <div className="choke-stage" data-phase="prepare" data-production="true">
          <section className="choke-boss-zone">
            <div className="choke-boss-backdrop" aria-hidden />
            <div className="choke-tapes choke-tapes--left" aria-hidden>
              <span className="choke-tape">WARNING &nbsp; WARNING &nbsp; WARNING &nbsp; WARNING</span>
              <span className="choke-tape choke-tape--sub">WARNING &nbsp; WARNING &nbsp; WARNING &nbsp; WARNING</span>
            </div>
            <div className="choke-tapes choke-tapes--right" aria-hidden>
              <span className="choke-tape">WARNING &nbsp; WARNING &nbsp; WARNING &nbsp; WARNING</span>
              <span className="choke-tape choke-tape--sub">WARNING &nbsp; WARNING &nbsp; WARNING &nbsp; WARNING</span>
            </div>
            <div className="choke-top-tools">
              <a className="choke-tool-btn" href="/">
                <b>‹</b>
                <span>桌面</span>
              </a>
            </div>
            <div className="choke-vs-giant" aria-hidden>
              VS
            </div>
            <div
              className="choke-boss-emblem"
              style={{ "--el": elementColor(enemyElement) } as CSSProperties}
              aria-hidden
            >
              <ElementGlyph element={enemyElement as Element} />
            </div>
            <div className="choke-prep-title">{enemyName}</div>
            <div className="choke-prep-badge">{tutorial ? "教学战斗" : "准备战斗"}</div>
            <div className="choke-outcome-box">
              <div className="choke-outcome-head">战斗结果决定路线分支</div>
              <div className="choke-outcome-row">
                <span>胜利</span>
                <b>前进</b>
              </div>
              <div className="choke-outcome-row">
                <span>败北</span>
                <b>撤退</b>
              </div>
            </div>
          </section>

          <section className="choke-hud-band">
            <div className="choke-hud-meta">
              <div className="choke-side-info choke-side-info--boss">
                <div className="choke-army-silhouette choke-army-silhouette--boss" aria-hidden />
                <div className="choke-side-name">{enemyName}</div>
                <div className="choke-hp-num">
                  <i>Hp</i>
                  <b>{enemyHp.toLocaleString("en-US")}</b>
                </div>
              </div>
              <div className="choke-center-meta">
                <div className="choke-weakness">
                  <span>{elementLabel(enemyElement)}</span>
                </div>
              </div>
              <div className="choke-side-info choke-side-info--party">
                <div className="choke-army-silhouette choke-army-silhouette--party" aria-hidden />
                <div className="choke-side-name">出战卡组</div>
                <div className="choke-hp-num">
                  <i>BP</i>
                  <b>{totalBp.toLocaleString("en-US")}</b>
                </div>
              </div>
            </div>
            <div className="choke-gauges">
              <div className="choke-gauge choke-gauge--boss">
                <div className="choke-gauge-track">
                  <div className="choke-gauge-fill" style={{ width: "100%" }} />
                </div>
              </div>
              <button type="button" className="choke-center-orb" onClick={onStart}>
                <span className="choke-orb-start">战斗开始</span>
              </button>
              <div className="choke-gauge choke-gauge--party">
                <div className="choke-gauge-track">
                  <div className="choke-gauge-fill" style={{ width: "100%" }} />
                </div>
              </div>
            </div>
            <div className="choke-sub-hud">
              <div className="choke-status-strip choke-status-strip--boss" />
              <div className="choke-ap-bar">
                <span className="choke-ap-label">Ap</span>
                <div className="choke-ap-gems">
                  {Array.from({ length: AP_SLOTS }, (_, i) => (
                    <span className="choke-ap-gem" data-locked={i + 1 > apMax ? "true" : undefined} key={i}>
                      {i + 1}
                    </span>
                  ))}
                </div>
              </div>
              <div className="choke-status-strip choke-status-strip--party">
                <span className="choke-buff-pill">{deck.length} / 7 张</span>
              </div>
            </div>
          </section>

          <section className="choke-deck">
            <aside className="choke-wing choke-wing--left">
              <div className="choke-btn-panel">
                <span>{tutorial ? "教学编队" : "出战编队"}</span>
                <small>确认后开战</small>
              </div>
              <a className="choke-btn-menu" href="/">
                返回桌面
              </a>
            </aside>
            <div className="choke-party-grid">
              {deck.map((card) => (
                <div className="choke-card-slot" key={card.id}>
                  <div className="choke-card-frame">
                    <GameCardFace card={card} eager />
                  </div>
                </div>
              ))}
            </div>
            <aside className="choke-wing choke-wing--right">
              <button type="button" className="choke-btn-end" onClick={onStart}>
                战斗开始
              </button>
              <a className="choke-btn-menu" href="/">
                桌面
              </a>
            </aside>
          </section>

          <footer className="choke-footer">
            <span className="choke-ticker">
              {tutorial ? "教学对手不会掉 pp，正常出牌就能赢。" : "确认卡组后点击中央【战斗开始】。"}
            </span>
          </footer>
        </div>
      </div>
    )
  }

  const team = teamHpOf(battle)
  const bossPct = Math.max(0, Math.min(100, (battle.enemy.hp / battle.enemy.hpMax) * 100))
  const partyPct = Math.max(0, Math.min(100, (team.hp / Math.max(1, team.max)) * 100))
  const hasTank = battle.cards.some((card) => !card.down && card.subjob.tags.includes("tank"))
  const playerTurn = battle.phase === "player"
  const maxAp = apMax

  const canAct = (index: number) => {
    const card = battle.cards[index]
    return Boolean(playerTurn && card && !card.acted && !card.down)
  }

  return (
    <div className="choke-viewport">
      <div className="choke-stage" data-phase={battle.phase === "player" ? "battle" : battle.phase} data-production="true">
        <section className="choke-boss-zone">
          <div className="choke-boss-backdrop" aria-hidden />
          <div
            className="choke-boss-emblem"
            style={{ "--el": elementColor(battle.enemy.element) } as CSSProperties}
            aria-hidden
          >
            <ElementGlyph element={battle.enemy.element as Element} />
          </div>

          <div className="choke-top-tools">
            <a className="choke-tool-btn" href="/">
              <b>‹</b>
              <span>桌面</span>
            </a>
          </div>

          <div className="choke-traits">
            {battle.enemy.intents.map((intent) => (
              <div
                className="choke-trait"
                key={intent.id}
                title={`${intent.label} · ${elementLabel(intent.element)} · ${enemyDamageTier(intent)}`}
              >
                <span
                  className="choke-trait-icon"
                  style={{ "--el": elementColor(intent.element) } as CSSProperties}
                >
                  <ElementGlyph element={intent.element as Element} />
                </span>
                <span className="choke-trait-name">{intent.label}</span>
                <span className="choke-trait-lock">{enemyDamageTier(intent)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="choke-hud-band">
          <div className="choke-hud-meta">
            <div className="choke-side-info choke-side-info--boss">
              <div className="choke-army-silhouette choke-army-silhouette--boss" aria-hidden />
              <div className="choke-side-name">{battle.enemy.name}</div>
              <div className="choke-hp-num">
                <i>Hp</i>
                <b>{battle.enemy.hp.toLocaleString("en-US")}</b>
              </div>
            </div>

            <div className="choke-center-meta">
              <div className="choke-weakness">
                <span>意图 ▶▶</span>
                <div className="choke-weakness-icons">
                  {battle.enemy.intents.map((intent) => (
                    <span
                      key={intent.id}
                      className="choke-weak-el"
                      title={`${intent.label} · ${enemyDamageTier(intent)}`}
                      style={{ "--el": elementColor(intent.element) } as CSSProperties}
                    >
                      <ElementGlyph element={intent.element as Element} />
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="choke-side-info choke-side-info--party">
              <div className="choke-army-silhouette choke-army-silhouette--party" aria-hidden />
              <div className="choke-side-name">你的队伍</div>
              <div className="choke-hp-num">
                <i>Hp</i>
                <b>{team.hp.toLocaleString("en-US")}</b>
              </div>
            </div>
          </div>

          <div className="choke-gauges">
            <div className="choke-gauge choke-gauge--boss">
              <div className="choke-gauge-track">
                <div className="choke-gauge-fill" style={{ width: `${bossPct}%` }} />
              </div>
            </div>
            <button type="button" className="choke-center-orb" disabled>
              <i className="choke-orb-round">Round</i>
              <b className="choke-orb-num">{battle.turn}</b>
              <span className="choke-orb-vs">VS</span>
            </button>
            <div className="choke-gauge choke-gauge--party">
              <div className="choke-gauge-track">
                <div className="choke-gauge-fill" style={{ width: `${partyPct}%` }} />
              </div>
            </div>
          </div>

          <div className="choke-sub-hud">
            <div className="choke-status-strip choke-status-strip--boss">
              {battle.enemy.statuses.map((status) => (
                <span className="choke-buff-pill choke-buff-pill--bad" key={status.id}>
                  {status.name} {status.turns}
                </span>
              ))}
            </div>
            <div className="choke-ap-bar">
              <span className="choke-ap-label">Ap</span>
              <div className="choke-ap-gems">
                {Array.from({ length: AP_SLOTS }, (_, i) => {
                  const n = i + 1
                  const active = n <= battle.ap
                  const locked = n > maxAp
                  const previewConsume = active && previewAp > 0 && n > battle.ap - previewAp
                  return (
                    <span
                      key={n}
                      className="choke-ap-gem"
                      data-active={active ? "true" : undefined}
                      data-locked={locked ? "true" : undefined}
                      data-preview={previewConsume ? "true" : undefined}
                    >
                      {n}
                    </span>
                  )
                })}
              </div>
            </div>
            <div className="choke-status-strip choke-status-strip--party">
              <span className="choke-buff-pill">COMBO {battle.combo}</span>
              <span className="choke-buff-pill">防御 {ROMAN[battle.defenseTier] ?? "0"}</span>
              {battle.supports.map((support) => (
                <span className="choke-buff-pill" key={support.id} title={`${elementLabel(support.element)} 支援`}>
                  {support.name}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="choke-deck">
          <aside className="choke-wing choke-wing--left">
            <div className="choke-btn-panel">
              <span>卡组</span>
              <small>{battle.cards.filter((card) => !card.down).length} / {battle.cards.length} 存活</small>
            </div>
            <button type="button" className="choke-btn-mini" onClick={() => setLogOpen((open) => !open)}>
              战报
            </button>
            <a className="choke-btn-menu" href="/">
              桌面
            </a>
          </aside>

          <div className="choke-party-grid">
            {battle.cards.map((card, index) => {
              const hpPct = (card.stats.hp / Math.max(1, card.stats.hpMax)) * 100
              const isSelected = selected === index
              const skills = card.skills.filter((skill) => !skill.passive)
              return (
                <div
                  className="choke-card-slot"
                  key={card.uid}
                  data-selected={isSelected ? "true" : undefined}
                  data-acted={card.acted ? "true" : undefined}
                  data-down={card.down ? "true" : undefined}
                  onClick={() => setSelected(isSelected ? null : index)}
                  title={`HP ${card.stats.hp}/${card.stats.hpMax} · ATK ${card.stats.atk} · DEF ${card.stats.def} · INT ${card.stats.int}`}
                >
                  <div className="choke-card-frame">
                    <GameCardFace card={card.face} eager />
                    {card.down && <div className="choke-card-tag" data-down="true">DOWN</div>}
                    {!card.down && card.acted && <div className="choke-card-tag">已行动</div>}
                  </div>

                  <div className="choke-card-meta">
                    <div className="choke-card-hp choke-card-hp--inline">
                      <i style={{ width: `${hpPct}%` }} />
                    </div>
                    <div className="choke-card-nums">
                      <span>{card.stats.hp}/{card.stats.hpMax}</span>
                      <span>
                        A<b>{card.stats.atk}</b> D<b>{card.stats.def}</b> I<b>{card.stats.int}</b>
                      </span>
                    </div>
                  </div>

                  {playerTurn && isSelected && !card.acted && !card.down && skills.length > 0 && (
                    <div
                      className="choke-card-overlay-skills choke-overlay--production"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {skills.map((skill) => {
                        const used = Boolean(skill.once && card.usedOnce.includes(skill.id))
                        const disabled = !canAct(index) || battle.ap < skill.ap || used
                        return (
                          <button
                            type="button"
                            key={skill.id}
                            className="choke-overlay-skill-btn"
                            disabled={disabled}
                            onMouseEnter={() => !disabled && setPreviewAp(skill.ap)}
                            onMouseLeave={() => setPreviewAp(0)}
                            onClick={() => {
                              setPreviewAp(0)
                              onPlay(index, skill.id)
                            }}
                            title={skill.desc}
                          >
                            <i>{skill.ap}</i>
                            <span>{used ? "已用" : skill.name}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <aside className="choke-wing choke-wing--right">
            <div className="choke-defense">
              <span>防御</span>
              <div className="choke-tier-row">
                {[1, 2, 3, 4].map((tier) => (
                  <button
                    type="button"
                    className="choke-tier-btn"
                    key={tier}
                    data-active={battle.defenseTier === tier ? "true" : undefined}
                    disabled={
                      !playerTurn ||
                      tier <= battle.defenseTier ||
                      battle.ap < tier - battle.defenseTier ||
                      (tier === 4 && !hasTank)
                    }
                    onClick={() => onDefend(tier)}
                    title={tier === 4 && !hasTank ? "需要存活坦克" : `防御档位 ${ROMAN[tier]}`}
                  >
                    {ROMAN[tier]}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="choke-btn-end" onClick={onEndTurn} disabled={!playerTurn}>
              结束该轮
            </button>
          </aside>
        </section>

        <footer className="choke-footer">
          <span className="choke-ticker">{actionError ?? battle.log[0] ?? "战斗开始"}</span>
          <button type="button" className="choke-log-toggle" onClick={() => setLogOpen((open) => !open)}>
            {logOpen ? "▼ LOG ▼" : "▲ LOG ▲"}
          </button>
        </footer>

        {logOpen && (
          <div className="choke-log-drawer">
            {battle.log.map((line, index) => (
              <div className="choke-log-line" key={`${index}-${line}`}>
                {line}
              </div>
            ))}
          </div>
        )}

        {(battle.phase === "won" || battle.phase === "lost") && (
          <div className="choke-result-layer">
            <div className="choke-result-card">
              <b>{battle.phase === "won" ? "战斗胜利" : "战斗失败"}</b>
              <p>
                {battle.phase === "won"
                  ? `用了 ${battle.turn} 回合击败 ${battle.enemy.name}。`
                  : `队伍在第 ${battle.turn} 回合倒下。`}
              </p>
              <div className="choke-result-actions">
                <button type="button" onClick={onRestart}>
                  再来一场
                </button>
                <a href="/">回桌面</a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
