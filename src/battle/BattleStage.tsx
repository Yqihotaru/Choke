import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import gsap from "gsap"
import {
  GiAngelWings,
  GiBroadsword,
  GiBrokenShield,
  GiCrackedShield,
  GiCrossedSwords,
  GiCrown,
  GiCrystalBars,
  GiCycle,
  GiDaggers,
  GiDrop,
  GiFireball,
  GiFlame,
  GiGears,
  GiHeartPlus,
  GiHornedSkull,
  GiHourglass,
  GiIceBolt,
  GiLightningBow,
  GiMagicPortal,
  GiMusicalNotes,
  GiPadlock,
  GiRoundStar,
  GiShield,
  GiSkullCrossedBones,
  GiSleepy,
  GiStarSwirl,
  GiStunGrenade,
  GiTargetLaser,
  GiThornyVine,
  GiTrophy,
  GiTrumpetFlag,
} from "react-icons/gi"

import { ElementGlyph, JobGlyph } from "@/card/CardFace"
import { GameCardFace } from "@/card/GameCardFace"
import { ELEMENT_COLOR, ELEMENT_LABEL, JOB_LABEL, battlePower } from "@/card/data"
import type { SkillDef } from "@/card/jobs"
import { subjobFor, skillSeed } from "@/card/jobs"
import type { CardFaceData, Element } from "@/card/types"

import {
  ROMAN_TIER,
  STAGE_PRESETS,
  canUseSkillReason,
  comboMultiplier,
  defenseReductionOf,
  effectiveApCost,
  effectiveEnemyDefenseTier,
  effectivePlayerDefenseTier,
  enemyDamageTier,
  evaluateStars,
  hasTankAlive,
  teamHpOf,
} from "./engine"
import { playHit, playLose, playSfx, playTurn, playWin } from "./sfx"
import { MAX_SUPPORT_SLOTS, type BattleState, type EnemyIntent, type SideSupportUnit } from "./types"
import "./choke-battle.css"

const AP_SLOTS = 10

interface Props {
  battle: BattleState | null
  deck: CardFaceData[]
  stageId: string
  tutorial: boolean
  actionError: string | null
  onSelectStage: (stageId: string) => void
  onStart: () => void
  onPlay: (cardIndex: number, skillId: string) => void
  onDefend: (tier?: number) => void
  onSwap: (activeSlotIndex: number, benchUid: number) => void
  onEndTurn: () => void
  onRestart: () => void
}

function elementColor(element: string) {
  return ELEMENT_COLOR[element as Element] ?? "#8a9099"
}

function elementLabel(element: string) {
  return ELEMENT_LABEL[element as Element] ?? element
}

function costTagLabel(tag: SkillDef["costTag"]): string | null {
  if (tag === "fatigue") return "疲惫"
  if (tag === "accumulate") return "累积"
  if (tag === "once") return "单次"
  return null
}

function IntentIcon({ kind }: { kind: EnemyIntent["kind"] }) {
  switch (kind) {
    case "attack":
      return <GiBroadsword />
    case "magic":
      return <GiFireball />
    case "heavy_phys":
      return <GiCrossedSwords />
    case "heavy_magic":
      return <GiStarSwirl />
    case "debuff":
      return <GiHornedSkull />
    case "buff":
      return <GiCrown />
    case "add_support":
      return <GiMagicPortal />
    case "break_support":
      return <GiBrokenShield />
    default:
      return <GiBroadsword />
  }
}

function SupportKindIcon({ unit }: { unit: SideSupportUnit }) {
  switch (unit.kind) {
    case "defense":
    case "armor":
      return <GiShield />
    case "thorns":
      return <GiThornyVine />
    case "charge":
      return <GiFlame />
    case "aura":
      return <GiTrumpetFlag />
    case "attack":
    default:
      return unit.job ? <JobGlyph job={unit.job} /> : <GiCrossedSwords />
  }
}

export function BattleStage({
  battle,
  deck,
  stageId,
  tutorial,
  actionError,
  onSelectStage,
  onStart,
  onPlay,
  onDefend,
  onSwap,
  onEndTurn,
  onRestart,
}: Props) {
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null)
  const [hoveredSkill, setHoveredSkill] = useState<{
    slotIndex: number
    skill: SkillDef
    actualAp: number
    reason: string | null
  } | null>(null)
  const [hoveredIntent, setHoveredIntent] = useState<EnemyIntent | null>(null)
  const [previewAp, setPreviewAp] = useState(0)
  const [logOpen, setLogOpen] = useState(false)
  const [swapOpen, setSwapOpen] = useState(false)
  const [swapOutIdx, setSwapOutIdx] = useState(0)
  const [speedHigh, setSpeedHigh] = useState(false)

  // 兰斯10 实时演出横幅与特效状态
  const [cutinBanner, setCutinBanner] = useState<{
    actor: "card" | "support" | "preemptive" | "enemy"
    title: string
    subtitle: string
    element: Element
  } | null>(null)
  const [slashKey, setSlashKey] = useState(0)
  const [laserTargets, setLaserTargets] = useState<number[]>([])
  const [guardChipSlot, setGuardChipSlot] = useState<number | null>(null)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const bossRef = useRef<HTMLElement | null>(null)
  const comboRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const lastSeq = useRef(0)
  const fxTimers = useRef<number[]>([])

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    fxTimers.current.push(id)
    return id
  }, [])

  useEffect(() => {
    const timers = fxTimers.current
    return () => {
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [])

  const popup = useCallback(
    (
      parent: HTMLElement | null,
      text: string,
      variant: "enemy" | "card",
      subLabel?: string,
      kind?: "heal" | "miss" | "wake" | "interrupt",
      crit?: boolean,
      isWeak?: boolean,
    ) => {
      if (!parent) return
      const node = document.createElement("div")
      node.className = `choke-popup choke-popup--${variant}`
      node.textContent = text
      if (kind) node.dataset.kind = kind
      if (crit) node.dataset.crit = "true"
      if (isWeak) node.dataset.weak = "true"
      if (subLabel) {
        const em = document.createElement("em")
        em.textContent = subLabel
        node.appendChild(em)
      }
      parent.appendChild(node)
      later(() => node.remove(), speedHigh ? 600 : 950)
    },
    [later, speedHigh],
  )

  const flash = useCallback(() => {
    const parent = stageRef.current
    if (!parent) return
    const node = document.createElement("div")
    node.className = "choke-hit-flash"
    parent.appendChild(node)
    later(() => node.remove(), 180)
  }, [later])

  const turnBanner = useCallback(
    (owner: "player" | "enemy", round: number) => {
      const parent = stageRef.current
      if (!parent) return
      const node = document.createElement("div")
      node.className = "choke-turn-banner"
      node.dataset.owner = owner
      node.textContent = owner === "player" ? `ROUND ${round} · PLAYER TURN` : "ENEMY TURN"
      parent.appendChild(node)
      later(() => node.remove(), speedHigh ? 550 : 850)
    },
    [later, speedHigh],
  )

  // 事件序列器：将 engine 产生的结构化事件按时间轴依次播放，还原兰斯10演出节奏
  useEffect(() => {
    if (!battle) {
      lastSeq.current = 0
      return
    }
    if (battle.actionSeq === lastSeq.current) return
    lastSeq.current = battle.actionSeq

    const stepGap = speedHigh ? 130 : 220
    battle.events.forEach((event, idx) => {
      const delay = idx * stepGap
      later(() => {
        if (event.type === "cutin") {
          setCutinBanner({
            actor: event.actor,
            title: event.title,
            subtitle: event.subtitle,
            element: event.element,
          })
          if (event.cardIndex != null) {
            const node = cardRefs.current[event.cardIndex]
            if (node) {
              gsap.fromTo(
                node,
                { y: 0, scale: 1 },
                {
                  y: -12,
                  scale: 1.05,
                  duration: 0.14,
                  yoyo: true,
                  repeat: 1,
                  ease: "power2.out",
                  onComplete: () => gsap.set(node, { clearProps: "transform" }),
                },
              )
            }
          }
          later(() => setCutinBanner(null), speedHigh ? 520 : 820)
          return
        }

        if (event.type === "laser") {
          setLaserTargets(event.targetSlots)
          if (event.guardedSlot != null) {
            setGuardChipSlot(event.guardedSlot)
          }
          later(() => {
            setLaserTargets([])
            setGuardChipSlot(null)
          }, speedHigh ? 450 : 700)
          return
        }

        if (event.type === "damage") {
          if (event.target === "enemy") {
            setSlashKey((k) => k + 1)
            flash()
            const tag = event.crit ? "CRITICAL!" : event.isWeak ? "WEAK!" : undefined
            popup(
              bossRef.current,
              `-${event.amount.toLocaleString("en-US")}`,
              "enemy",
              tag,
              undefined,
              Boolean(event.crit),
              Boolean(event.isWeak),
            )
            if (bossRef.current) {
              gsap.fromTo(
                bossRef.current,
                { x: 0, y: 0 },
                {
                  x: 6,
                  y: -4,
                  duration: 0.045,
                  repeat: 5,
                  yoyo: true,
                  ease: "power1.inOut",
                  onComplete: () => gsap.set(bossRef.current, { x: 0, y: 0 }),
                },
              )
            }
            if (comboRef.current) {
              gsap.fromTo(
                comboRef.current,
                { scale: 1.35 },
                { scale: 1, duration: 0.22, ease: "back.out(2)" },
              )
            }
            playHit(event.combo ?? battle.combo, Boolean(event.crit))
          } else {
            const targetNode = cardRefs.current[event.cardIndex ?? -1] ?? stageRef.current
            popup(targetNode, `-${event.amount.toLocaleString("en-US")}`, "card", event.source)
            playSfx("hit", { rate: 0.88 })
          }
          return
        }

        if (event.type === "heal") {
          popup(stageRef.current, `+${event.amount.toLocaleString("en-US")}`, "card", event.source, "heal")
          playSfx("heal")
          return
        }

        if (event.type === "miss") {
          popup(
            cardRefs.current[event.cardIndex ?? -1] ?? stageRef.current,
            "MISS",
            "card",
            "COMBO -50%",
            "miss",
          )
          playSfx("miss")
          return
        }

        if (event.type === "interrupt_roll") {
          popup(
            bossRef.current,
            event.success ? "BREAK!" : "RESIST",
            "enemy",
            `${event.intentLabel}${event.reason ? ` (${event.reason})` : ""}`,
            "interrupt",
            event.success,
          )
          playSfx(event.success ? "crit" : "miss")
          return
        }

        if (event.type === "wake_up") {
          popup(bossRef.current, "WAKE UP!", "enemy", "受击解除硬控", "wake")
          playSfx("guard")
          return
        }

        if (event.type === "down") {
          popup(cardRefs.current[event.cardIndex] ?? stageRef.current, "DOWN!", "card", event.cardName, "miss")
          playSfx("lose", { rate: 1.25 })
          return
        }

        if (event.type === "revive") {
          popup(cardRefs.current[event.cardIndex] ?? stageRef.current, "REVIVE!", "card", event.cardName, "heal")
          playSfx("heal")
          return
        }

        if (event.type === "guard") {
          playSfx("guard")
          return
        }

        if (event.type === "turn") {
          turnBanner(event.owner, event.round)
          playTurn()
          return
        }

        if (event.type === "won") playWin()
        if (event.type === "lost") playLose()
      }, delay)
    })
  }, [battle, flash, later, popup, speedHigh, turnBanner])

  const startBattle = () => {
    playSfx("click")
    onStart()
  }

  // ==================== 1. 战前准备画面 ====================
  if (!battle) {
    const preset = STAGE_PRESETS.find((s) => s.id === stageId) ?? STAGE_PRESETS[0]!
    const enemyName = tutorial ? "谱面幽灵（教学）" : preset.name
    const enemyElement = tutorial ? "dark" : preset.element
    const enemyHp = tutorial ? 3600 : preset.hp
    const weaknesses = tutorial ? (["light", "physical"] as Element[]) : preset.weaknesses
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

            <div className="choke-prep-title">
              <small>{tutorial ? "TUTORIAL STAGE" : preset.title}</small>
              <div>{enemyName}</div>
            </div>
            <div className="choke-prep-badge">{tutorial ? "教学战斗" : "准备战斗"}</div>

            {/* 非教学模式下可切换讨伐目标（普通 / 高T精锐开罐关 / 魔人BOSS） */}
            {!tutorial && (
              <div className="choke-stage-selector">
                <span className="choke-stage-selector__label">
                  <GiTargetLaser /> 选择讨伐目标
                </span>
                <div className="choke-stage-selector__btns">
                  {STAGE_PRESETS.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      className="choke-stage-pill"
                      data-active={st.id === preset.id ? "true" : undefined}
                      onClick={() => {
                        playSfx("click")
                        onSelectStage(st.id)
                      }}
                    >
                      <b>{st.name}</b>
                      <small>
                        {st.tier === "boss" ? "BOSS" : st.tier === "elite" ? "高T精英" : "常规"} · HP{" "}
                        {st.hp.toLocaleString("en-US")}
                      </small>
                    </button>
                  ))}
                </div>
                <p className="choke-stage-selector__desc">{preset.summary}</p>
              </div>
            )}

            <div className="choke-outcome-box">
              <div className="choke-outcome-head">战斗评价与路线条件</div>
              <div className="choke-outcome-row">
                <span>★1 速通</span>
                <b>≤ {Math.max(1, Math.ceil((tutorial ? 4 : preset.parTurns) * 0.6))} 回合</b>
              </div>
              <div className="choke-outcome-row">
                <span>★2 无伤</span>
                <b>无人被 DOWN</b>
              </div>
              <div className="choke-outcome-row">
                <span>★3 高效</span>
                <b>累计 AP ≤ {Math.ceil((tutorial ? 8 : preset.parAp) * 0.8)}</b>
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
                  <span>弱点属性 ▶▶</span>
                  <div className="choke-weakness-icons">
                    {weaknesses.map((w) => (
                      <span
                        key={w}
                        className="choke-weak-el"
                        title={elementLabel(w)}
                        style={{ "--el": elementColor(w) } as CSSProperties}
                      >
                        <ElementGlyph element={w} />
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="choke-side-info choke-side-info--party">
                <div className="choke-army-silhouette choke-army-silhouette--party" aria-hidden />
                <div className="choke-side-name">出战讨伐队</div>
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
              <button type="button" className="choke-center-orb" onClick={startBattle}>
                <span className="choke-orb-start">战斗开始</span>
              </button>
              <div className="choke-gauge choke-gauge--party">
                <div className="choke-gauge-track">
                  <div className="choke-gauge-fill" style={{ width: "100%" }} />
                </div>
              </div>
            </div>

            <div className="choke-sub-hud">
              <div className="choke-status-strip choke-status-strip--boss">
                <span className="choke-buff-pill choke-buff-pill--bad">
                  属性：{elementLabel(enemyElement)}
                </span>
              </div>
              <div className="choke-ap-bar">
                <span className="choke-ap-label">Ap</span>
                <div className="choke-ap-gems">
                  {Array.from({ length: AP_SLOTS }, (_, i) => (
                    <span
                      className="choke-ap-gem"
                      data-active={i < 2 ? "true" : undefined}
                      data-locked={i + 1 > 7 ? "true" : undefined}
                      key={i}
                    >
                      {i + 1}
                    </span>
                  ))}
                </div>
              </div>
              <div className="choke-status-strip choke-status-strip--party">
                <span className="choke-buff-pill">主队 {deck.length} / 7 张</span>
              </div>
            </div>
          </section>

          <section className="choke-deck">
            <aside className="choke-wing choke-wing--left">
              <div className="choke-btn-panel">
                <span>{tutorial ? "教学编队" : "讨伐编队"}</span>
                <small>全队共享大血条</small>
              </div>
              <a className="choke-btn-menu" href="/">
                返回桌面
              </a>
            </aside>
            <div className="choke-party-grid">
              {deck.map((card) => {
                const subjob = subjobFor(skillSeed(card.id), card.job)
                return (
                  <div className="choke-card-slot" key={card.id}>
                    <span className="choke-subjob-badge">{subjob.label}</span>
                    <div className="choke-card-frame">
                      <GameCardFace card={card} eager />
                    </div>
                  </div>
                )
              })}
            </div>
            <aside className="choke-wing choke-wing--right">
              <button type="button" className="choke-btn-end" onClick={startBattle}>
                战斗开始
              </button>
              <a className="choke-btn-menu" href="/">
                桌面
              </a>
            </aside>
          </section>

          <footer className="choke-footer">
            <span className="choke-ticker">
              {tutorial
                ? "教学战：熟悉 0 费平刀铺 Combo、AP 继承、右侧侧面支援与防御档位。"
                : "确认讨伐目标与编队后，点击中央【战斗开始】进入兰斯10回合制战斗。"}
            </span>
          </footer>
        </div>
      </div>
    )
  }

  // ==================== 2. 正式战斗画面 ====================
  const team = teamHpOf(battle)
  const bossPct = Math.max(0, Math.min(100, (battle.enemy.hp / Math.max(1, battle.enemy.hpMax)) * 100))
  const partyPct = Math.max(0, Math.min(100, (team.hp / Math.max(1, team.max)) * 100))
  const tankPresent = hasTankAlive(battle.cards)
  const maxDefenseTier = tankPresent ? 4 : 3
  const nextDefenseTier = Math.min(maxDefenseTier, battle.defenseTier + 1)
  const canRaiseDefense =
    battle.phase === "player" &&
    battle.defenseTier < maxDefenseTier &&
    battle.ap >= 1
  const currentDefTier = effectivePlayerDefenseTier(battle)
  const currentDefRedPct = Math.round(defenseReductionOf(currentDefTier, tankPresent) * 100)
  const nextDefRedPct = Math.round(defenseReductionOf(nextDefenseTier, tankPresent) * 100)
  const enemyArmorTier = effectiveEnemyDefenseTier(battle)
  const playerTurn = battle.phase === "player"
  const apMax = battle.apMax
  const comboPct = Math.round((comboMultiplier(battle.combo) - 1) * 100)
  const stars = evaluateStars(battle)

  const activeSlotIndex = hoveredSlot ?? selectedSlot

  return (
    <div className="choke-viewport">
      <div
        className="choke-stage"
        data-phase={battle.phase === "player" ? "battle" : battle.phase}
        data-production="true"
        ref={stageRef}
      >
        {/* ================= 1. 上半区：BOSS 战区 + 左右对称 7 格侧面支援栏 ================= */}
        <section className="choke-boss-zone" ref={bossRef}>
          <div
            className="choke-boss-backdrop"
            key={slashKey}
            data-slashed={slashKey > 0 ? "true" : undefined}
            data-dead={battle.enemy.hp <= 0 ? "true" : undefined}
            aria-hidden
          />

          {slashKey > 0 && <div className="choke-slash-fx" key={`slash-${slashKey}`} aria-hidden />}

          {/* 敌方攻击红激光靶线 */}
          {laserTargets.length > 0 && (
            <svg className="choke-laser-svg" viewBox="0 0 100 56.25" preserveAspectRatio="none" aria-hidden>
              {laserTargets.map((slotIdx) => {
                const targetX = 11.4 + (slotIdx + 0.5) * (77.2 / Math.max(1, battle.cards.length))
                return (
                  <g key={slotIdx}>
                    <line x1="50" y1="18" x2={targetX} y2="42" className="choke-laser-glow" />
                    <line x1="50" y1="18" x2={targetX} y2="42" className="choke-laser-core" />
                  </g>
                )
              })}
            </svg>
          )}

          {/* 中央 BOSS 属性徽记与硬控状态提示 */}
          <div
            className="choke-boss-emblem"
            style={{ "--el": elementColor(battle.enemy.element) } as CSSProperties}
            aria-hidden
          >
            <ElementGlyph element={battle.enemy.element} />
          </div>

          {battle.enemy.hardControl && (
            <div className="choke-boss-cc-banner">
              {battle.enemy.hardControl === "sleep" ? <GiSleepy /> : <GiStunGrenade />}
              <div>
                <b>{battle.enemy.hardControl === "sleep" ? "眠咒催眠中" : "粉碎击晕中"}</b>
                <small>本回合敌方行动全部作废 · 注意：任何攻击命中将立刻将其【打醒】！</small>
              </div>
            </div>
          )}

          {/* 顶部工具栏 */}
          <div className="choke-top-tools">
            <button
              type="button"
              className="choke-tool-btn"
              onClick={() => {
                playSfx("click")
                onRestart()
              }}
              title="重新开始本场战斗"
            >
              <b>↻</b>
              <span>重开</span>
            </button>
            <a className="choke-tool-btn" href="/">
              <b>‹</b>
              <span>桌面</span>
            </a>
          </div>

          {/* 左侧竖排 7 格：敌方侧面支援栏（§8.1 敌方支援在左侧，上限 7 个） */}
          <div className="choke-side-supports choke-side-supports--enemy">
            <div className="choke-side-supports__head">
              <span>敌方侧面支援</span>
              <small>
                {battle.enemySupports.length}/{MAX_SUPPORT_SLOTS}
              </small>
            </div>
            {Array.from({ length: MAX_SUPPORT_SLOTS }, (_, i) => {
              const unit = battle.enemySupports[i]
              if (!unit) {
                return (
                  <div className="choke-support-slot choke-support-slot--empty" key={`e-empty-${i}`}>
                    <span className="choke-support-slot__idx">{i + 1}</span>
                    <span className="choke-support-slot__placeholder">空支援槽</span>
                  </div>
                )
              }
              return (
                <div
                  className="choke-support-slot choke-support-slot--enemy"
                  key={unit.id}
                  data-kind={unit.kind}
                  style={{ "--el": elementColor(unit.element) } as CSSProperties}
                  title={`${unit.name} · ${unit.roleText}`}
                >
                  <span className="choke-support-slot__icon">
                    <SupportKindIcon unit={unit} />
                  </span>
                  <div className="choke-support-slot__body">
                    <b>{unit.name}</b>
                    <small>{unit.roleText}</small>
                  </div>
                  {unit.locked && (
                    <span className="choke-support-slot__lock" title="锁定支援（不可拆毁）">
                      <GiPadlock />
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* 右侧竖排 7 格：我方侧面支援栏（§8.1 我方支援在右侧，上限 7 个，主动防御占 1 格） */}
          <div className="choke-side-supports choke-side-supports--party">
            <div className="choke-side-supports__head">
              <span>我方侧面支援</span>
              <small>
                {battle.playerSupports.length}/{MAX_SUPPORT_SLOTS}
              </small>
            </div>
            {Array.from({ length: MAX_SUPPORT_SLOTS }, (_, i) => {
              const unit = battle.playerSupports[i]
              if (!unit) {
                return (
                  <div
                    className="choke-support-slot choke-support-slot--empty choke-support-slot--party-empty"
                    key={`p-empty-${i}`}
                  >
                    <span className="choke-support-slot__idx">{i + 1}</span>
                    <span className="choke-support-slot__placeholder">
                      {i === 0 && battle.defenseTier === 0 ? "防御/支援待命" : "空支援槽"}
                    </span>
                  </div>
                )
              }
              return (
                <div
                  className="choke-support-slot choke-support-slot--party"
                  key={unit.id}
                  data-kind={unit.kind}
                  data-active={unit.triggered ? "true" : undefined}
                  style={{ "--el": elementColor(unit.element) } as CSSProperties}
                  title={`${unit.name} · ${unit.roleText}`}
                >
                  <span className="choke-support-slot__icon">
                    <SupportKindIcon unit={unit} />
                  </span>
                  <div className="choke-support-slot__body">
                    <b>{unit.name}</b>
                    <small>{unit.roleText}</small>
                  </div>
                  {unit.locked && (
                    <span className="choke-support-slot__lock" title="圣印锁定保护">
                      <GiPadlock />
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* 兰斯10 技能 / 支援 / 抢攻 Cut-in 横幅 */}
          {cutinBanner && (
            <div
              className={`choke-skill-banner ${cutinBanner.actor === "support" || cutinBanner.actor === "preemptive" ? "choke-skill-banner--support" : ""}`}
              style={{ "--el": elementColor(cutinBanner.element) } as CSSProperties}
            >
              <span className="choke-banner-tag">
                {cutinBanner.actor === "support"
                  ? "SUPPORT"
                  : cutinBanner.actor === "preemptive"
                    ? "SWIFT"
                    : cutinBanner.actor === "enemy"
                      ? "ENEMY"
                      : "SKILL"}
              </span>
              <b>{cutinBanner.title}</b>
              <span>{cutinBanner.subtitle}</span>
            </div>
          )}

          {/* 右下角斜体 COMBO 计数器 + 当前加成倍率 */}
          {battle.combo > 0 && (
            <div className="choke-combo-counter" ref={comboRef}>
              <b>{battle.combo}</b>
              <div className="choke-combo-meta">
                <span>COMBO!</span>
                <em>伤害 +{comboPct}%</em>
              </div>
            </div>
          )}
        </section>

        {/* ================= 2. 中轴区：双部队剪影 + 弱点与意图预告队列 + 斜切双血条 + AP ================= */}
        <section className="choke-hud-band">
          <div className="choke-hud-meta">
            <div className="choke-side-info choke-side-info--boss">
              <div className="choke-army-silhouette choke-army-silhouette--boss" aria-hidden />
              <div className="choke-side-name">
                {battle.enemy.name}
                {enemyArmorTier > 0 && (
                  <span className="choke-inline-armor">
                    <GiShield /> 装甲 {ROMAN_TIER[enemyArmorTier]}
                  </span>
                )}
              </div>
              <div className="choke-hp-num">
                <i>Hp</i>
                <b>{battle.enemy.hp.toLocaleString("en-US")}</b>
              </div>
            </div>

            {/* 中央：弱点属性 + 敌方本回合完整意图预告队列（§12.2 意图预告是战斗 UI 的主角） */}
            <div className="choke-center-meta">
              <div className="choke-weakness">
                <span>弱点 ▶</span>
                <div className="choke-weakness-icons">
                  {battle.enemy.weaknesses.map((w) => (
                    <span
                      key={w}
                      className="choke-weak-el"
                      title={`弱点：${elementLabel(w)} (+30%)`}
                      style={{ "--el": elementColor(w) } as CSSProperties}
                    >
                      <ElementGlyph element={w} />
                    </span>
                  ))}
                </div>
              </div>

              <div className="choke-intents">
                <span className="choke-intents__label">敌方意图 ▶</span>
                {battle.enemy.intents.map((intent, idx) => {
                  const tierLabel = enemyDamageTier(intent)
                  const disabledByCC = Boolean(battle.enemy.hardControl)
                  return (
                    <div
                      key={intent.id}
                      className="choke-intent-box"
                      data-interrupted={intent.interrupted ? "true" : undefined}
                      data-uninterruptible={intent.uninterruptible ? "true" : undefined}
                      data-cc={disabledByCC ? "true" : undefined}
                      data-down={intent.causesDown ? "true" : undefined}
                      style={{ "--el": elementColor(intent.element) } as CSSProperties}
                      onMouseEnter={() => setHoveredIntent(intent)}
                      onMouseLeave={() => setHoveredIntent(null)}
                    >
                      <span className="choke-intent-box__icon">
                        <IntentIcon kind={intent.kind} />
                      </span>
                      <i className="choke-intent-box__order">{idx + 1}</i>
                      <em className="choke-intent-box__tier">{tierLabel}</em>
                      {intent.uninterruptible && (
                        <b className="choke-intent-box__lock" title="招牌技：无法打断">
                          <GiPadlock />
                        </b>
                      )}
                      {intent.interrupted && <span className="choke-intent-box__break">✕</span>}
                    </div>
                  )
                })}

                {hoveredIntent && (
                  <div className="choke-tooltip choke-tooltip--intent">
                    <div className="choke-tooltip-title">
                      {hoveredIntent.label}
                      {hoveredIntent.interrupted && "（已打断取消）"}
                    </div>
                    <div className="choke-tooltip-sub">
                      {elementLabel(hoveredIntent.element)}属性 · 威胁度：{enemyDamageTier(hoveredIntent)}
                      {hoveredIntent.causesDown ? " · ⚠️ 附带 DOWN 击倒" : ""}
                      {hoveredIntent.uninterruptible ? " · 🔒 无法打断" : " · 可被刺客打断"}
                    </div>
                    <div className="choke-tooltip-desc">{hoveredIntent.desc}</div>
                  </div>
                )}
              </div>
            </div>

            <div className="choke-side-info choke-side-info--party">
              <div className="choke-army-silhouette choke-army-silhouette--party" aria-hidden />
              <div className="choke-side-name">
                讨伐队总生命
                {currentDefTier > 0 && (
                  <span className="choke-inline-armor choke-inline-armor--party">
                    <GiShield /> 防御 {ROMAN_TIER[currentDefTier]} (−{currentDefRedPct}%)
                  </span>
                )}
              </div>
              <div className="choke-hp-num">
                <i>Hp</i>
                <b>{team.hp.toLocaleString("en-US")}</b>
                <small>/ {team.max.toLocaleString("en-US")}</small>
              </div>
            </div>
          </div>

          <div className="choke-gauges">
            <div className="choke-gauge choke-gauge--boss">
              <div className="choke-gauge-track choke-gauge-track--double">
                <div className="choke-gauge-ghost" style={{ width: `${bossPct}%` }} />
                <div className="choke-gauge-fill" style={{ width: `${bossPct}%` }} />
              </div>
            </div>
            <button type="button" className="choke-center-orb" disabled>
              <i className="choke-orb-round">Round</i>
              <b className="choke-orb-num">{battle.turn}</b>
              <span className="choke-orb-vs">VS</span>
            </button>
            <div className="choke-gauge choke-gauge--party">
              <div className="choke-gauge-track choke-gauge-track--double">
                <div className="choke-gauge-ghost" style={{ width: `${partyPct}%` }} />
                <div className="choke-gauge-fill" style={{ width: `${partyPct}%` }} />
              </div>
            </div>
          </div>

          <div className="choke-sub-hud">
            {/* 左侧：敌方异常状态条 */}
            <div className="choke-status-strip choke-status-strip--boss">
              {battle.enemy.statuses.map((status) => (
                <span
                  className={`choke-buff-pill ${status.isDebuff !== false ? "choke-buff-pill--bad" : ""}`}
                  key={status.id}
                >
                  {status.id === "armor_break" && <GiCrackedShield />}
                  {status.id === "burn" && <GiFlame />}
                  {status.id === "poison" && <GiDrop />}
                  {status.id === "freeze" && <GiIceBolt />}
                  {status.id === "shock" && <GiLightningBow />}
                  {status.id === "vulnerable" && <GiBrokenShield />}
                  {status.id === "vigilant" && <GiPadlock />}
                  {status.name}
                  {status.stacks && status.stacks > 1 ? `×${status.stacks}` : ""} ({status.turns})
                </span>
              ))}
            </div>

            {/* 中央：10 格 AP 宝石条（支持继承与消耗预览） */}
            <div className="choke-ap-bar">
              <span className="choke-ap-label">Ap</span>
              <div className="choke-ap-gems">
                {Array.from({ length: AP_SLOTS }, (_, i) => {
                  const n = i + 1
                  const active = n <= battle.ap
                  const locked = n > apMax
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

            {/* 右侧：我方队伍状态条 */}
            <div className="choke-status-strip choke-status-strip--party">
              {battle.teamStatuses.map((status) => (
                <span
                  className={`choke-buff-pill ${status.isDebuff ? "choke-buff-pill--bad" : ""}`}
                  key={status.id}
                >
                  {status.name}
                  {status.stacks && status.stacks > 1 ? `×${status.stacks}` : ""} ({status.turns})
                </span>
              ))}
              {battle.cards.some((c) => !c.down && c.subjob.tags.includes("ap")) && (
                <span className="choke-buff-pill" title="舞者在场：每回合基础 AP 恢复 2 → 3">
                  <GiMusicalNotes /> 舞者 +1 AP/轮
                </span>
              )}
            </div>
          </div>
        </section>

        {/* ================= 3. 下半区：7 卡指令台（无单卡血条，纯正兰斯10操作流） ================= */}
        <section className="choke-deck">
          <aside className="choke-wing choke-wing--left">
            <button
              type="button"
              className="choke-btn-panel"
              disabled={!playerTurn || battle.bench.length === 0}
              onClick={() => {
                playSfx("click")
                setSwapOpen((v) => !v)
              }}
              title="从替补席更换场上人员（未出牌前或替换 DOWN 卡片）"
            >
              <span>
                <GiCycle /> {swapOpen ? "关闭替补" : "更换人员"}
              </span>
              <small>
                {battle.swapCooldown > 0
                  ? `冷却 ${battle.swapCooldown} 回合`
                  : `替补席 ${battle.bench.filter((b) => !b.down).length} 张`}
              </small>
            </button>

            <div className="choke-wing-toggles">
              <button
                type="button"
                className="choke-btn-mini"
                onClick={() => setSpeedHigh((v) => !v)}
              >
                <GiHourglass /> {speedHigh ? "高速" : "常速"}
              </button>
              <button
                type="button"
                className="choke-btn-mini"
                onClick={() => setLogOpen((open) => !open)}
              >
                战报
              </button>
            </div>

            <a className="choke-btn-menu" href="/">
              桌面
            </a>
          </aside>

          <div className="choke-party-grid">
            {battle.cards.map((card, index) => {
              const isOpen = activeSlotIndex === index && !swapOpen
              const actives = card.skills.filter((skill) => !skill.passive)
              const passives = card.skills.filter((skill) => skill.passive)
              const tooltipInfo =
                hoveredSkill && hoveredSkill.slotIndex === index ? hoveredSkill : null

              return (
                <div
                  className="choke-card-slot"
                  key={card.uid}
                  ref={(node) => {
                    cardRefs.current[index] = node
                  }}
                  data-selected={selectedSlot === index ? "true" : undefined}
                  data-hovered={hoveredSlot === index ? "true" : undefined}
                  data-acted={card.acted ? "true" : undefined}
                  data-down={card.down ? "true" : undefined}
                  data-boost={card.trigger && !card.acted && !card.down ? card.trigger : undefined}
                  data-guarding={guardChipSlot === index ? "true" : undefined}
                  data-swap-target={swapOpen && swapOutIdx === index ? "true" : undefined}
                  onClick={() => {
                    if (swapOpen) {
                      setSwapOutIdx(index)
                    } else {
                      setSelectedSlot(selectedSlot === index ? null : index)
                    }
                  }}
                  onMouseEnter={() => setHoveredSlot(index)}
                  onMouseLeave={() => {
                    setHoveredSlot(null)
                    setHoveredSkill(null)
                    setPreviewAp(0)
                  }}
                >
                  {/* 悬浮技能详情 Tooltip */}
                  {tooltipInfo && (
                    <div className="choke-tooltip choke-tooltip--skill">
                      <div className="choke-tooltip-title">
                        {tooltipInfo.skill.name}
                        {costTagLabel(tooltipInfo.skill.costTag) && (
                          <span className="choke-tooltip-badge">
                            {costTagLabel(tooltipInfo.skill.costTag)}
                          </span>
                        )}
                      </div>
                      <div className="choke-tooltip-sub">
                        {elementLabel(tooltipInfo.skill.element)} · 消耗 {tooltipInfo.actualAp} AP
                        {tooltipInfo.skill.mp ? ` + ${tooltipInfo.skill.mp} MP` : ""}
                        {tooltipInfo.skill.hits && tooltipInfo.skill.hits > 1
                          ? ` · ${tooltipInfo.skill.hits} 段连击`
                          : ""}
                      </div>
                      <div className="choke-tooltip-desc">{tooltipInfo.skill.desc}</div>
                      {tooltipInfo.reason && (
                        <div className="choke-tooltip-warn">⚠️ {tooltipInfo.reason}</div>
                      )}
                    </div>
                  )}

                  {/* 顶部特殊触发徽标（§10.1 Boost 1.5× / 必杀 3.0× / 连击 ×2） */}
                  {card.trigger && !card.acted && !card.down && (
                    <span className="choke-boost-tag" data-trigger={card.trigger}>
                      {card.trigger === "critical_art"
                        ? "必杀 3.0×"
                        : card.trigger === "double_cast"
                          ? "连击 ×2"
                          : "BOOST 1.5×"}
                    </span>
                  )}

                  {guardChipSlot === index && <span className="choke-guard-chip">嘲讽援护!</span>}

                  <div className="choke-card-frame">
                    <GameCardFace card={card.face} eager />

                    {/* 子职业与法系 MP 微型角标 */}
                    <div className="choke-card-badges">
                      <span className="choke-card-subjob-pill">{card.subjob.label}</span>
                      {card.stats.mpMax > 0 && (
                        <span className="choke-card-mp-pill" title={`法系专属 MP（每回合 +${card.stats.mpRegen}）`}>
                          <GiCrystalBars /> {card.stats.mp}/{card.stats.mpMax}
                        </span>
                      )}
                    </div>

                    {/* 单卡附着状态角标（嘲讽 / 荆棘 / 异常） */}
                    {(card.taunt || card.statuses.length > 0) && (
                      <div className="choke-card-status-row">
                        {card.taunt && (
                          <span className="choke-card-status-chip choke-card-status-chip--taunt">
                            <GiShield /> 嘲讽
                          </span>
                        )}
                        {card.statuses.map((st) => (
                          <span className="choke-card-status-chip" key={st.id}>
                            {st.id === "thorns" && <GiThornyVine />}
                            {st.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* DOWN 遮罩（可等待 3 回合清醒、治疗抬人、或左翼换替补） */}
                    {card.down && (
                      <div className="choke-card-tag" data-down="true">
                        <GiSkullCrossedBones />
                        <b>DOWN</b>
                        <small>{card.downTurns} 回合苏醒 / 可换人</small>
                      </div>
                    )}

                    {/* 本回合已行动遮罩（下回合自动恢复，无跨回合 CD） */}
                    {!card.down && card.acted && (
                      <div className="choke-card-tag">
                        <b>行动毕</b>
                        <small>下回合恢复</small>
                      </div>
                    )}

                    {/* 兰斯10 卡面悬浮技能指令菜单 */}
                    {playerTurn && isOpen && !card.acted && !card.down && actives.length > 0 && (
                      <div
                        className="choke-card-overlay-skills"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {actives.map((skill) => {
                          const actualAp = effectiveApCost(battle, card, skill)
                          const reason = canUseSkillReason(battle, index, skill.id)
                          const disabled = Boolean(reason)
                          const surcharged = actualAp > skill.ap
                          return (
                            <button
                              type="button"
                              key={skill.id}
                              className="choke-overlay-skill-btn"
                              disabled={disabled}
                              data-surcharged={surcharged ? "true" : undefined}
                              onMouseEnter={() => {
                                setHoveredSkill({ slotIndex: index, skill, actualAp, reason })
                                if (!disabled) setPreviewAp(actualAp)
                              }}
                              onMouseLeave={() => {
                                setHoveredSkill(null)
                                setPreviewAp(0)
                              }}
                              onClick={() => {
                                setPreviewAp(0)
                                setHoveredSkill(null)
                                onPlay(index, skill.id)
                              }}
                            >
                              <i
                                style={
                                  {
                                    "--el": elementColor(skill.element),
                                  } as CSSProperties
                                }
                              >
                                {actualAp}
                              </i>
                              <span>{skill.name}</span>
                              {skill.mp ? <em className="choke-skill-mp">{skill.mp}M</em> : null}
                            </button>
                          )
                        })}
                        {passives.length > 0 && (
                          <div className="choke-overlay-passive" title={passives[0]!.desc}>
                            被动：{passives[0]!.name}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 右翼：兰斯10 四档防御（联动右侧侧面支援栏）+ 结束回合 */}
          <aside className="choke-wing choke-wing--right">
            <div className="choke-defense-box">
              <button
                type="button"
                className="choke-btn-defend"
                disabled={!canRaiseDefense}
                onMouseEnter={() => canRaiseDefense && setPreviewAp(1)}
                onMouseLeave={() => setPreviewAp(0)}
                onClick={() => {
                  setPreviewAp(0)
                  onDefend()
                }}
                title="每点 1 次消耗 1 AP 提升 1 档部队防御（作为侧面支援写入右侧支援栏，本回合生效）"
              >
                <b>
                  <GiShield /> 防御 {battle.defenseTier < maxDefenseTier ? ROMAN_TIER[nextDefenseTier] : "已满"}
                </b>
                <span>
                  {battle.defenseTier < maxDefenseTier
                    ? `1 AP → −${nextDefRedPct}%`
                    : `当前 −${currentDefRedPct}%`}
                </span>
              </button>

              <div className="choke-tier-row">
                {[1, 2, 3, 4].map((tier) => {
                  const cost = tier - battle.defenseTier
                  const locked = tier === 4 && !tankPresent
                  const disabled =
                    !playerTurn || tier <= battle.defenseTier || battle.ap < cost || locked
                  return (
                    <button
                      type="button"
                      className="choke-tier-btn"
                      key={tier}
                      data-active={battle.defenseTier >= tier ? "true" : undefined}
                      disabled={disabled}
                      onMouseEnter={() => !disabled && cost > 0 && setPreviewAp(cost)}
                      onMouseLeave={() => setPreviewAp(0)}
                      onClick={() => {
                        setPreviewAp(0)
                        onDefend(tier)
                      }}
                      title={
                        locked
                          ? "IV 档（−90% 开罐）需存活坦克在场"
                          : `升至防御 ${ROMAN_TIER[tier]}（减伤 ${Math.round(defenseReductionOf(tier, tankPresent) * 100)}%）`
                      }
                    >
                      {ROMAN_TIER[tier]}
                    </button>
                  )
                })}
              </div>
            </div>

            <button
              type="button"
              className="choke-btn-end"
              onClick={onEndTurn}
              disabled={!playerTurn}
            >
              结束该轮
            </button>
          </aside>
        </section>

        {/* ================= 4. 战中替补席换人抽屉（§7.3 主线/全局开放） ================= */}
        {swapOpen && playerTurn && (
          <div className="choke-swap-drawer">
            <div className="choke-swap-head">
              <div>
                <b>
                  <GiCycle /> 部队替补席换人
                </b>
                <span>
                  点击下方备战卡牌，替换当前选中槽位 #{swapOutIdx + 1} 【{battle.cards[swapOutIdx]?.name}
                  {battle.cards[swapOutIdx]?.down ? " (DOWN 救援)" : ""}】
                </span>
              </div>
              <button
                type="button"
                className="choke-swap-close"
                onClick={() => setSwapOpen(false)}
              >
                返回战斗 ✕
              </button>
            </div>

            <div className="choke-swap-targets">
              {battle.cards.map((c, idx) => (
                <button
                  key={c.uid}
                  type="button"
                  className="choke-swap-slot-pill"
                  data-active={swapOutIdx === idx ? "true" : undefined}
                  data-down={c.down ? "true" : undefined}
                  onClick={() => setSwapOutIdx(idx)}
                >
                  <span>#{idx + 1}</span>
                  <b>{c.name}</b>
                  <small>{c.down ? "DOWN" : c.subjob.label}</small>
                </button>
              ))}
            </div>

            <div className="choke-swap-grid">
              {battle.bench.map((b) => (
                <button
                  key={b.uid}
                  type="button"
                  className="choke-bench-item"
                  disabled={
                    b.down ||
                    battle.swapCooldown > 0 ||
                    (battle.hasActedThisTurn && !battle.cards[swapOutIdx]?.down)
                  }
                  onClick={() => {
                    onSwap(swapOutIdx, b.uid)
                    setSwapOpen(false)
                  }}
                >
                  <div className="choke-bench-card">
                    <GameCardFace card={b.face} />
                    {b.down && (
                      <div className="choke-card-tag" data-down="true">
                        <b>DOWN</b>
                      </div>
                    )}
                  </div>
                  <span className="choke-bench-meta">
                    {b.subjob.label} · {JOB_LABEL[b.job]} · LV{b.level}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ================= 5. 最底栏与 LOG 抽屉 ================= */}
        <footer className="choke-footer">
          <span className="choke-ticker">
            {actionError ? `⚠️ ${actionError}` : (battle.log[0] ?? "战斗开始")}
          </span>
          <button
            type="button"
            className="choke-log-toggle"
            onClick={() => setLogOpen((open) => !open)}
          >
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

        {/* ================= 6. 战后结算层（§12.3 三星评价，无宝箱翻牌） ================= */}
        {(battle.phase === "won" || battle.phase === "lost") && (
          <div className="choke-result-layer">
            <div className="choke-result-card">
              <div className="choke-result-badge">
                {battle.phase === "won" ? <GiTrophy /> : <GiSkullCrossedBones />}
              </div>
              <b>{battle.phase === "won" ? "讨伐胜利 · STAGE CLEAR" : "讨伐失败 · DEFEATED"}</b>
              <p>
                {battle.phase === "won"
                  ? `在第 ${battle.turn} 回合击败了【${battle.enemy.name}】（最高 ${battle.maxCombo} Combo）`
                  : `讨伐队在第 ${battle.turn} 回合生命归零。善用右侧侧面防御档位、破甲与打断再试一次吧！`}
              </p>

              {battle.phase === "won" && (
                <div className="choke-stars-grid">
                  <div className="choke-star-item" data-achieved={stars.speedStar ? "true" : undefined}>
                    <GiRoundStar />
                    <b>★1 速通</b>
                    <small>
                      {battle.turn} / {stars.parTurns} 回合内
                    </small>
                  </div>
                  <div className="choke-star-item" data-achieved={stars.noDownStar ? "true" : undefined}>
                    <GiRoundStar />
                    <b>★2 无伤</b>
                    <small>本场 DOWN {battle.downCount} 次</small>
                  </div>
                  <div className="choke-star-item" data-achieved={stars.efficientStar ? "true" : undefined}>
                    <GiRoundStar />
                    <b>★3 高效</b>
                    <small>
                      消耗 {battle.apSpentTotal} / {stars.parAp} AP
                    </small>
                  </div>
                </div>
              )}

              <div className="choke-result-actions">
                <button type="button" onClick={onRestart}>
                  再来一场
                </button>
                <a href="/">返回桌面</a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export { GiAngelWings, GiDaggers, GiGears, GiHeartPlus }
