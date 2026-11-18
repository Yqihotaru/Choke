import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import gsap from "gsap"
import {
  GiBroadsword,
  GiBrokenShield,
  GiCrackedShield,
  GiCrossedSwords,
  GiCrown,
  GiCrystalBars,
  GiCycle,
  GiDrop,
  GiFireball,
  GiFlame,
  GiHornedSkull,
  GiHourglass,
  GiIceBolt,
  GiLightningBow,
  GiMagicPortal,
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
import type { CardFaceData, Element } from "@/card/types"

import {
  STAGE_PRESETS,
  canUseSkillReason,
  comboMultiplier,
  effectiveApCost,
  enemyDamageTier,
  evaluateStars,
  hasTankAlive,
  teamHpOf,
} from "./engine"
import { playHit, playLose, playSfx, playTurn, playWin } from "./sfx"
import type { BattleState, EnemyIntent, SideSupportUnit } from "./types"
import "./choke-battle.css"

const AP_SLOTS = 10

/**
 * 兰斯10 标志性「外低内高」阶梯折线血条 SVG 路径（viewBox="0 0 460 54"）
 * - BOSS 血条（左）：外侧左段处于下方 (y=26..50)，在 x=250..278 处向上 45° 折起，内侧右段处于上方 (y=6..30) 贴合中央 Round 盾章
 * - 我方血条（右）：内侧左段处于上方 (y=6..30)，在 x=182..210 处向下 45° 折落，外侧右段处于下方 (y=26..50)
 */
const BOSS_GAUGE_POLYGON = "4,26 250,26 278,6 456,6 448,30 286,30 258,50 14,50"
const PARTY_GAUGE_POLYGON = "4,6 182,6 210,26 456,26 446,50 202,50 174,30 12,30"

interface HpLossPillar {
  id: number
  side: "boss" | "party"
  /** 扣血区间在对应半侧血条上的百分比起点与宽度（0~100） */
  startPct: number
  widthPct: number
}

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

  // 兰斯10 实时演出横幅与扣血垂直光柱状态
  const [cutinBanner, setCutinBanner] = useState<{
    actor: "card" | "support" | "preemptive" | "enemy"
    title: string
    subtitle: string
    element: Element
  } | null>(null)
  const [slashKey, setSlashKey] = useState(0)
  const [laserTargets, setLaserTargets] = useState<number[]>([])
  const [guardChipSlot, setGuardChipSlot] = useState<number | null>(null)
  const [pillars, setPillars] = useState<HpLossPillar[]>([])

  const stageRef = useRef<HTMLDivElement | null>(null)
  const bossRef = useRef<HTMLElement | null>(null)
  const comboRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const lastSeq = useRef(0)
  const prevBossPctRef = useRef(100)
  const prevPartyPctRef = useRef(100)
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

  // 监听 BOSS 与我方血量百分比变化，生成兰斯10标志性的「扣血段垂直冲顶红白光柱」
  useEffect(() => {
    if (!battle) {
      prevBossPctRef.current = 100
      prevPartyPctRef.current = 100
      return
    }
    const curBossPct = Math.max(
      0,
      Math.min(100, (battle.enemy.hp / Math.max(1, battle.enemy.hpMax)) * 100),
    )
    const team = teamHpOf(battle)
    const curPartyPct = Math.max(0, Math.min(100, (team.hp / Math.max(1, team.max)) * 100))

    if (curBossPct < prevBossPctRef.current - 0.1) {
      const lossWidth = Math.max(1.8, prevBossPctRef.current - curBossPct)
      const id = Date.now() + Math.random()
      setPillars((prev) => [
        ...prev,
        { id, side: "boss", startPct: curBossPct, widthPct: lossWidth },
      ])
      later(() => {
        setPillars((prev) => prev.filter((p) => p.id !== id))
      }, 360)
    }
    prevBossPctRef.current = curBossPct

    if (curPartyPct < prevPartyPctRef.current - 0.1) {
      const lossWidth = Math.max(1.8, prevPartyPctRef.current - curPartyPct)
      const id = Date.now() + Math.random() + 1
      // 我方血条从右侧外沿向左缩减，或从内侧向外缩减：这里与右条左端对齐
      const startFromLeft = 100 - prevPartyPctRef.current
      setPillars((prev) => [
        ...prev,
        { id, side: "party", startPct: startFromLeft, widthPct: lossWidth },
      ])
      later(() => {
        setPillars((prev) => prev.filter((p) => p.id !== id))
      }, 360)
    }
    prevPartyPctRef.current = curPartyPct
  }, [battle, battle?.enemy.hp, battle?.teamHp, later])

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
      later(() => node.remove(), speedHigh ? 520 : 820)
    },
    [later, speedHigh],
  )

  const flash = useCallback(() => {
    const parent = stageRef.current
    if (!parent) return
    const node = document.createElement("div")
    node.className = "choke-hit-flash"
    parent.appendChild(node)
    later(() => node.remove(), 150)
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
      later(() => node.remove(), speedHigh ? 500 : 780)
    },
    [later, speedHigh],
  )

  useEffect(() => {
    if (!battle) {
      lastSeq.current = 0
      return
    }
    if (battle.actionSeq === lastSeq.current) return
    lastSeq.current = battle.actionSeq

    const stepGap = speedHigh ? 110 : 190
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
                  y: -10,
                  scale: 1.04,
                  duration: 0.12,
                  yoyo: true,
                  repeat: 1,
                  ease: "power2.out",
                  onComplete: () => gsap.set(node, { clearProps: "transform" }),
                },
              )
            }
          }
          later(() => setCutinBanner(null), speedHigh ? 480 : 750)
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
          }, speedHigh ? 420 : 650)
          return
        }

        if (event.type === "damage") {
          if (event.target === "enemy") {
            setSlashKey((k) => k + 1)
            flash()
            const tag = event.crit ? "CRITICAL!" : event.isWeak ? "WEAK!" : undefined
            popup(
              bossRef.current,
              `${event.amount.toLocaleString("en-US")}`,
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
                  duration: 0.04,
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
                { scale: 1.38 },
                { scale: 1, duration: 0.2, ease: "back.out(2)" },
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

            <div className="choke-prep-title">
              <small>{tutorial ? "TUTORIAL STAGE" : preset.title}</small>
              <div>{enemyName}</div>
            </div>
            <div className="choke-prep-badge">{tutorial ? "教学战斗" : "准备战斗"}</div>

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

          {/* 准备画面同样采用兰斯10阶梯折线双血条 */}
          <section className="choke-hud-band">
            <div className="choke-hud-upper">
              <div className="choke-side-info choke-side-info--boss">
                <div className="choke-army-silhouette choke-army-silhouette--boss" aria-hidden />
                <div className="choke-side-name">{enemyName}</div>
                <div className="choke-hp-num">
                  <i>Hp</i>
                  <b>{enemyHp.toLocaleString("en-US")}</b>
                </div>
              </div>

              <div className="choke-shelf-left">
                <div className="choke-weakness-ribbon">
                  <span>弱点属性 ▶▶</span>
                  <div className="choke-weakness-icons">
                    {weaknesses.map((w) => (
                      <span
                        key={w}
                        className="choke-weak-el"
                        title={`弱点：${elementLabel(w)}`}
                        style={{ "--el": elementColor(w) } as CSSProperties}
                      >
                        <ElementGlyph element={w} />
                        <em>{elementLabel(w)}</em>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="choke-shelf-right" />

              <div className="choke-side-info choke-side-info--party">
                <div className="choke-army-silhouette choke-army-silhouette--party" aria-hidden />
                <div className="choke-side-name">魔人讨伐队</div>
                <div className="choke-hp-num">
                  <i>BP</i>
                  <b>{totalBp.toLocaleString("en-US")}</b>
                </div>
              </div>
            </div>

            <div className="choke-bent-gauges">
              <svg className="choke-bent-svg choke-bent-svg--boss" viewBox="0 0 460 54" preserveAspectRatio="none">
                <polygon points={BOSS_GAUGE_POLYGON} fill="#140d10" stroke="#b89146" strokeWidth="3" />
                <polygon points={BOSS_GAUGE_POLYGON} fill="url(#bossHpGradPrep)" />
                <defs>
                  <linearGradient id="bossHpGradPrep" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#9c140e" />
                    <stop offset="55%" stopColor="#eb4b1c" />
                    <stop offset="100%" stopColor="#ffd859" />
                  </linearGradient>
                </defs>
              </svg>

              <button type="button" className="choke-center-orb" onClick={startBattle}>
                <span className="choke-orb-start">战斗开始</span>
              </button>

              <svg className="choke-bent-svg choke-bent-svg--party" viewBox="0 0 460 54" preserveAspectRatio="none">
                <polygon points={PARTY_GAUGE_POLYGON} fill="#0d131a" stroke="#b89146" strokeWidth="3" />
                <polygon points={PARTY_GAUGE_POLYGON} fill="url(#partyHpGradPrep)" />
                <defs>
                  <linearGradient id="partyHpGradPrep" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#72f2ff" />
                    <stop offset="48%" stopColor="#1e8de0" />
                    <stop offset="100%" stopColor="#0d3b82" />
                  </linearGradient>
                </defs>
              </svg>

              <div className="choke-ap-pocket">
                <span className="choke-ap-label">Ap</span>
                <div className="choke-ap-gems">
                  {Array.from({ length: 7 }, (_, i) => (
                    <span className="choke-ap-gem" data-active={i < 2 ? "true" : undefined} key={i}>
                      {i + 1}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="choke-deck">
            <aside className="choke-wing choke-wing--left">
              <div className="choke-btn-panel">
                <span>{tutorial ? "教学编队" : "出战编队"}</span>
                <small>{deck.length} / 7 张</small>
              </div>
              <a className="choke-btn-menu" href="/">
                桌面
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
              <button type="button" className="choke-btn-defend" disabled>
                <div className="choke-defend-top">
                  <GiShield />
                  <b>防御</b>
                </div>
                <span className="choke-defend-ap">1 Ap</span>
              </button>
              <button type="button" className="choke-btn-end" onClick={startBattle}>
                战斗开始
              </button>
            </aside>
          </section>

          <footer className="choke-footer">
            <span className="choke-ticker">
              {tutorial
                ? "教学战：熟悉连击 Combo、AP 继承与右侧【防御】侧面支援。"
                : "确认讨伐目标与编队后，点击中央【战斗开始】。"}
            </span>
          </footer>
        </div>
      </div>
    )
  }

  // ==================== 2. 正式战斗画面（1:1 兰斯10 折线血条 + 垂直红白扣血光柱） ====================
  const team = teamHpOf(battle)
  const bossPct = Math.max(0, Math.min(100, (battle.enemy.hp / Math.max(1, battle.enemy.hpMax)) * 100))
  const partyPct = Math.max(0, Math.min(100, (team.hp / Math.max(1, team.max)) * 100))
  const tankPresent = hasTankAlive(battle.cards)
  const maxDefenseTier = tankPresent ? 4 : 2
  const canRaiseDefense =
    battle.phase === "player" &&
    battle.defenseTier < maxDefenseTier &&
    battle.ap >= 1
  const playerTurn = battle.phase === "player"
  const apMax = battle.apMax
  const comboPct = Math.round((comboMultiplier(battle.combo) - 1) * 100)
  const stars = evaluateStars(battle)

  const activeSlotIndex = hoveredSlot ?? selectedSlot
  const bossFillWidth = (452 * bossPct) / 100
  const partyFillWidth = (452 * partyPct) / 100
  const partyFillX = 4 + (452 - partyFillWidth)

  return (
    <div className="choke-viewport">
      <div
        className="choke-stage"
        data-phase={battle.phase === "player" ? "battle" : battle.phase}
        data-production="true"
        ref={stageRef}
      >
        {/* ================= 1. 上半区：BOSS 舞台 + 梯形侧面支援铭牌（仅在有支援时显示，无空表框） ================= */}
        <section className="choke-boss-zone" ref={bossRef}>
          <div
            className="choke-boss-backdrop"
            key={slashKey}
            data-slashed={slashKey > 0 ? "true" : undefined}
            data-dead={battle.enemy.hp <= 0 ? "true" : undefined}
            aria-hidden
          />

          {slashKey > 0 && <div className="choke-slash-fx" key={`slash-${slashKey}`} aria-hidden />}

          {/* 兰斯10 标志性受击花火与 BOSS 剪影舞台 */}
          <div
            className="choke-boss-figure"
            style={{ "--el": elementColor(battle.enemy.element) } as CSSProperties}
            aria-hidden
          >
            <div className="choke-boss-aura" />
            <div className="choke-boss-core">
              <ElementGlyph element={battle.enemy.element} />
            </div>
          </div>

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

          {battle.enemy.hardControl && (
            <div className="choke-boss-cc-banner">
              {battle.enemy.hardControl === "sleep" ? <GiSleepy /> : <GiStunGrenade />}
              <div>
                <b>{battle.enemy.hardControl === "sleep" ? "眠咒催眠中" : "粉碎击晕中"}</b>
                <small>敌方行动全部作废 · 任何攻击命中将立刻将其【打醒】！</small>
              </div>
            </div>
          )}

          {/* 右上角快捷工具 */}
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

          {/* 左侧：敌方侧面支援梯形铭牌（像兰斯10的「知性覚醒(1/4)」一样叠在左侧剪影上方，无空槽框） */}
          {battle.enemySupports.length > 0 && (
            <div className="choke-rance-supports choke-rance-supports--enemy">
              {battle.enemySupports.map((unit) => (
                <div
                  className="choke-rance-support-plate choke-rance-support-plate--enemy"
                  key={unit.id}
                  data-kind={unit.kind}
                  style={{ "--el": elementColor(unit.element) } as CSSProperties}
                  title={`${unit.name}：${unit.roleText}`}
                >
                  <div className="choke-plate-icon">
                    <SupportKindIcon unit={unit} />
                    {unit.defenseTier != null && <i>{unit.defenseTier}</i>}
                    {unit.stacks != null && <i>{unit.stacks}</i>}
                  </div>
                  <div className="choke-plate-text">
                    <b>{unit.name}</b>
                    <small>{unit.roleText}</small>
                  </div>
                  {unit.locked && (
                    <span className="choke-plate-lock" title="锁定支援">
                      <GiPadlock />
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 右侧：我方侧面支援梯形铭牌（点右翼【防御】即在此处追加「防御 Lv1~Lv4」！） */}
          {battle.playerSupports.length > 0 && (
            <div className="choke-rance-supports choke-rance-supports--party">
              {battle.playerSupports.map((unit) => (
                <div
                  className="choke-rance-support-plate choke-rance-support-plate--party"
                  key={unit.id}
                  data-kind={unit.kind}
                  data-active={unit.triggered ? "true" : undefined}
                  style={{ "--el": elementColor(unit.element) } as CSSProperties}
                  title={`${unit.name}：${unit.roleText}`}
                >
                  <div className="choke-plate-icon">
                    <SupportKindIcon unit={unit} />
                    {unit.defenseTier != null && <i>{unit.defenseTier}</i>}
                  </div>
                  <div className="choke-plate-text">
                    <b>{unit.name}</b>
                    <small>{unit.roleText}</small>
                  </div>
                  {unit.locked && (
                    <span className="choke-plate-lock" title="锁定保护">
                      <GiPadlock />
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 技能 / 支援 / 抢攻 Cut-in 横幅 */}
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
        </section>

        {/* ================= 2. 中轴区：兰斯10 阶梯折线双血条 + 冲顶红白扣血光柱 + 弱点/意图台阶 + COMBO 台阶 + 底部内嵌 AP ================= */}
        <section className="choke-hud-band">
          {/* 扣血垂直红白光柱（从被扣减的那一段血条直接冲到屏幕最顶端 y=0 然后闪光消散！） */}
          {pillars.map((pillar) => (
            <div
              key={pillar.id}
              className={`choke-hp-loss-pillar choke-hp-loss-pillar--${pillar.side}`}
              style={
                {
                  "--p-start": `${pillar.startPct}%`,
                  "--p-width": `${pillar.widthPct}%`,
                } as CSSProperties
              }
              aria-hidden
            />
          ))}

          {/* 折线血条上方的四段信息区：左外(BOSS名+HP) | 左内高台(意图+弱点) | 右内高台(COMBO!) | 右外(讨伐队名+HP) */}
          <div className="choke-hud-upper">
            {/* 左外低段上方：红军剪影 + 敌方名 + 大号衬线 HP */}
            <div className="choke-side-info choke-side-info--boss">
              <div className="choke-army-silhouette choke-army-silhouette--boss" aria-hidden />
              <div className="choke-side-name">{battle.enemy.name}</div>
              <div className="choke-hp-num">
                <i>Hp</i>
                <b>{battle.enemy.hp.toLocaleString("en-US")}</b>
              </div>
              {battle.enemy.statuses.length > 0 && (
                <div className="choke-mini-statuses">
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
                      {status.name}
                      {status.stacks && status.stacks > 1 ? `×${status.stacks}` : ""}({status.turns})
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 左内高台上方（紧贴折线抬高段）：上层是黄色方框敌方意图，下层是蓝色弱点属性条 */}
            <div className="choke-shelf-left">
              <div className="choke-intents">
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
                        <b className="choke-intent-box__lock" title="无法打断">
                          !
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
                      {elementLabel(hoveredIntent.element)}属性 · 伤害档位：{enemyDamageTier(hoveredIntent)}
                      {hoveredIntent.causesDown ? " · ⚠️ 附带 DOWN" : ""}
                      {hoveredIntent.uninterruptible ? " · 🔒 无法打断" : " · 可被刺客打断"}
                    </div>
                    <div className="choke-tooltip-desc">{hoveredIntent.desc}</div>
                  </div>
                )}
              </div>

              <div className="choke-weakness-ribbon">
                <span>弱点属性 ▶▶</span>
                <div className="choke-weakness-icons">
                  {battle.enemy.weaknesses.map((w) => (
                    <span
                      key={w}
                      className="choke-weak-el"
                      title={`弱点：${elementLabel(w)} (+30% 伤害)`}
                      style={{ "--el": elementColor(w) } as CSSProperties}
                    >
                      <ElementGlyph element={w} />
                      <em>{elementLabel(w)}</em>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* 右内高台上方（紧贴右折线抬高段）：兰斯10 大号斜体 1 COMBO! */}
            <div className="choke-shelf-right">
              {battle.combo > 0 && (
                <div className="choke-combo-counter" ref={comboRef}>
                  <b>{battle.combo}</b>
                  <div className="choke-combo-meta">
                    <span>COMBO!</span>
                    {comboPct > 0 && <em>+{comboPct}%</em>}
                  </div>
                </div>
              )}
            </div>

            {/* 右外低段上方：蓝军剪影 + 魔人讨伐队 + 大号衬线 HP */}
            <div className="choke-side-info choke-side-info--party">
              <div className="choke-army-silhouette choke-army-silhouette--party" aria-hidden />
              <div className="choke-side-name">魔人讨伐队</div>
              <div className="choke-hp-num">
                <i>Hp</i>
                <b>{team.hp.toLocaleString("en-US")}</b>
              </div>
              {battle.teamStatuses.length > 0 && (
                <div className="choke-mini-statuses choke-mini-statuses--party">
                  {battle.teamStatuses.map((status) => (
                    <span
                      className={`choke-buff-pill ${status.isDebuff ? "choke-buff-pill--bad" : ""}`}
                      key={status.id}
                    >
                      {status.name}({status.turns})
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 兰斯10 阶梯折线双血条 + 中央盾形 Round/VS + 折线凹槽下的 AP 齿轮宝石栏 */}
          <div className="choke-bent-gauges">
            {/* 左：BOSS 阶梯折线血条 */}
            <svg className="choke-bent-svg choke-bent-svg--boss" viewBox="0 0 460 54" preserveAspectRatio="none">
              <defs>
                <clipPath id="bossBentClip">
                  <polygon points={BOSS_GAUGE_POLYGON} />
                </clipPath>
                <linearGradient id="bossHpGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#9c140e" />
                  <stop offset="55%" stopColor="#eb4b1c" />
                  <stop offset="100%" stopColor="#ffd859" />
                </linearGradient>
                <linearGradient id="bossFlashGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="50%" stopColor="#ff94a8" />
                  <stop offset="100%" stopColor="#ff2e4c" />
                </linearGradient>
              </defs>
              {/* 暗色槽底 */}
              <polygon points={BOSS_GAUGE_POLYGON} fill="#140c0e" />
              {/* 扣血瞬间的红白闪光残影条 + 实血条 */}
              <g clipPath="url(#bossBentClip)">
                <rect
                  className="choke-bent-ghost"
                  x="4"
                  y="0"
                  width={bossFillWidth}
                  height="54"
                  fill="url(#bossFlashGrad)"
                />
                <rect
                  className="choke-bent-fill"
                  x="4"
                  y="0"
                  width={bossFillWidth}
                  height="54"
                  fill="url(#bossHpGrad)"
                />
                {/* 顶部玻璃高光带 */}
                <rect x="4" y="6" width={bossFillWidth} height="5" fill="rgba(255,255,255,0.28)" />
              </g>
              {/* 金属折线外框 */}
              <polygon
                points={BOSS_GAUGE_POLYGON}
                fill="none"
                stroke="#c79c4e"
                strokeWidth="2.8"
                strokeLinejoin="bevel"
              />
            </svg>

            {/* 中央：Round N VS 盾章 */}
            <button type="button" className="choke-center-orb" disabled>
              <i className="choke-orb-round">Round</i>
              <b className="choke-orb-num">{battle.turn}</b>
              <span className="choke-orb-vs">VS</span>
            </button>

            {/* 右：我方阶梯折线血条 */}
            <svg className="choke-bent-svg choke-bent-svg--party" viewBox="0 0 460 54" preserveAspectRatio="none">
              <defs>
                <clipPath id="partyBentClip">
                  <polygon points={PARTY_GAUGE_POLYGON} />
                </clipPath>
                <linearGradient id="partyHpGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#72f2ff" />
                  <stop offset="48%" stopColor="#1e8de0" />
                  <stop offset="100%" stopColor="#0d3b82" />
                </linearGradient>
              </defs>
              <polygon points={PARTY_GAUGE_POLYGON} fill="#0b1118" />
              <g clipPath="url(#partyBentClip)">
                <rect
                  className="choke-bent-ghost"
                  x={partyFillX}
                  y="0"
                  width={partyFillWidth}
                  height="54"
                  fill="url(#bossFlashGrad)"
                />
                <rect
                  className="choke-bent-fill"
                  x={partyFillX}
                  y="0"
                  width={partyFillWidth}
                  height="54"
                  fill="url(#partyHpGrad)"
                />
                <rect x={partyFillX} y="6" width={partyFillWidth} height="5" fill="rgba(255,255,255,0.28)" />
              </g>
              <polygon
                points={PARTY_GAUGE_POLYGON}
                fill="none"
                stroke="#c79c4e"
                strokeWidth="2.8"
                strokeLinejoin="bevel"
              />
            </svg>

            {/* 嵌在折线内侧抬高段正下方的 AP 齿轮宝石栏 */}
            <div className="choke-ap-pocket">
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
          </div>
        </section>

        {/* ================= 3. 下半区：7 卡指令台（1:1 兰斯10 左右翼 + 卡面中央 BOOST/行動終了 + 主动被动同款技能条） ================= */}
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
              title="从替补席更换场上人员"
            >
              <div className="choke-btn-panel__top">
                <GiCycle />
                <span>{swapOpen ? "关闭替补" : "更换人员"}</span>
              </div>
              <div className="choke-btn-panel__pill">
                {battle.swapCooldown > 0
                  ? `${battle.swapCooldown} Round后`
                  : `替补 ${battle.bench.filter((b) => !b.down).length} 张`}
              </div>
            </button>

            <div className="choke-wing-toggles">
              <button
                type="button"
                className="choke-btn-mini"
                onClick={() => setSpeedHigh((v) => !v)}
              >
                <GiHourglass />
                <span>速度:{speedHigh ? "高速" : "常速"}</span>
              </button>
              <button
                type="button"
                className="choke-btn-mini"
                onClick={() => setLogOpen((open) => !open)}
              >
                <span>战报</span>
              </button>
            </div>

            <a className="choke-btn-menu" href="/">
              MENU
            </a>
          </aside>

          <div className="choke-party-grid">
            {battle.cards.map((card, index) => {
              const isOpen = activeSlotIndex === index && !swapOpen
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
                  {/* 悬浮技能详情 Tooltip（主动与被动鼠标描上去都有介绍） */}
                  {tooltipInfo && (
                    <div className="choke-tooltip choke-tooltip--skill">
                      <div className="choke-tooltip-title">
                        {tooltipInfo.skill.name}
                        {tooltipInfo.skill.passive ? (
                          <span className="choke-tooltip-badge choke-tooltip-badge--passive">
                            被动常驻
                          </span>
                        ) : (
                          costTagLabel(tooltipInfo.skill.costTag) && (
                            <span className="choke-tooltip-badge">
                              {costTagLabel(tooltipInfo.skill.costTag)}
                            </span>
                          )
                        )}
                      </div>
                      <div className="choke-tooltip-sub">
                        {tooltipInfo.skill.passive
                          ? `${card.subjob.label} · 被动技能（无需点击，自动生效）`
                          : `${elementLabel(tooltipInfo.skill.element)} · 消耗 ${tooltipInfo.actualAp} AP${
                              tooltipInfo.skill.mp ? ` + ${tooltipInfo.skill.mp} MP` : ""
                            }${
                              tooltipInfo.skill.hits && tooltipInfo.skill.hits > 1
                                ? ` · ${tooltipInfo.skill.hits} 段连击`
                                : ""
                            }`}
                      </div>
                      <div className="choke-tooltip-desc">{tooltipInfo.skill.desc}</div>
                      {!tooltipInfo.skill.passive && tooltipInfo.reason && (
                        <div className="choke-tooltip-warn">⚠️ {tooltipInfo.reason}</div>
                      )}
                    </div>
                  )}

                  {guardChipSlot === index && <span className="choke-guard-chip">嘲讽援护!</span>}

                  <div className="choke-card-frame">
                    <GameCardFace card={card.face} eager />

                    {/* 法系专属 MP 小胶囊（仅法系显示在顶部偏左，不遮挡名字） */}
                    {card.stats.mpMax > 0 && (
                      <span className="choke-card-mp-pill" title={`法系 MP（每回合 +${card.stats.mpRegen}）`}>
                        <GiCrystalBars /> {card.stats.mp}/{card.stats.mpMax}
                      </span>
                    )}

                    {/* 兰斯10 风格：覆盖在未行动卡片中央的炫光艺术大字 BOOST / 必殺 / 連撃（见参考图第2张卡） */}
                    {card.trigger && !card.acted && !card.down && (
                      <div className="choke-center-trigger" data-trigger={card.trigger}>
                        <span>
                          {card.trigger === "critical_art"
                            ? "必殺 3.0×"
                            : card.trigger === "double_cast"
                              ? "連撃 ×2"
                              : "BOOST"}
                        </span>
                      </div>
                    )}

                    {/* DOWN 遮罩 */}
                    {card.down && (
                      <div className="choke-acted-stamp" data-down="true">
                        <div className="choke-acted-circle">
                          <GiSkullCrossedBones />
                        </div>
                        <b>DOWN</b>
                        <small>{card.downTurns} 回合苏醒</small>
                      </div>
                    )}

                    {/* 兰斯10 风格：已行动卡片中央红色禁止环 + 「行動終了」印章（见参考图第3张卡） */}
                    {!card.down && card.acted && (
                      <div className="choke-acted-stamp">
                        <div className="choke-acted-circle" />
                        <b>行動終了</b>
                      </div>
                    )}

                    {/* 主动与被动同款样式的技能指令行（紧贴卡面原技能区位置，主动可点，被动仅悬停看介绍） */}
                    {playerTurn && isOpen && !card.acted && !card.down && (
                      <div
                        className="choke-card-overlay-skills"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {card.skills.map((skill) => {
                          const isPassive = Boolean(skill.passive)
                          const actualAp = isPassive ? 0 : effectiveApCost(battle, card, skill)
                          const reason = isPassive ? null : canUseSkillReason(battle, index, skill.id)
                          const disabled = !isPassive && Boolean(reason)
                          const surcharged = !isPassive && actualAp > skill.ap
                          return (
                            <button
                              type="button"
                              key={skill.id}
                              className="choke-overlay-skill-btn"
                              data-passive={isPassive ? "true" : undefined}
                              data-surcharged={surcharged ? "true" : undefined}
                              disabled={disabled}
                              onMouseEnter={() => {
                                setHoveredSkill({ slotIndex: index, skill, actualAp, reason })
                                if (!isPassive && !disabled) setPreviewAp(actualAp)
                              }}
                              onMouseLeave={() => {
                                setHoveredSkill(null)
                                setPreviewAp(0)
                              }}
                              onClick={() => {
                                if (isPassive || disabled) return
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
                                {isPassive ? "◎" : actualAp}
                              </i>
                              <span>{skill.name}</span>
                              {skill.mp ? <em className="choke-skill-mp">{skill.mp}M</em> : null}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 右翼：1:1 兰斯10 单个蓝色【防御 / 1 Ap】大按键 + 底部红色【结束该轮】按键 */}
          <aside className="choke-wing choke-wing--right">
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
              title={
                battle.defenseTier >= maxDefenseTier
                  ? tankPresent
                    ? "防御支援已达最高 Lv4（−90%）"
                    : "无坦克在场最高只能升至 Lv2（−35%）"
                  : `点击追加/升级右侧侧面支援【防御 Lv${battle.defenseTier + 1}】（消耗 1 AP）`
              }
            >
              <div className="choke-defend-top">
                <GiShield />
                <b>{battle.defenseTier > 0 ? `防御 Lv${battle.defenseTier}` : "防御"}</b>
              </div>
              <span className="choke-defend-ap">
                {battle.defenseTier >= maxDefenseTier ? "MAX" : "1 Ap"}
              </span>
            </button>

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

        {/* ================= 4. 战中替补席换人抽屉 ================= */}
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

        {/* ================= 6. 战后结算层（三星评价） ================= */}
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
                  : `讨伐队在第 ${battle.turn} 回合生命归零。`}
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
