import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import gsap from "gsap"
import {
  GiBroadsword,
  GiBrokenShield,
  GiCrackedShield,
  GiCrossedSwords,
  GiCrown,
  GiCycle,
  GiDrop,
  GiFireball,
  GiFlame,
  GiHornedSkull,
  GiHourglass,
  GiIceBolt,
  GiLightningBow,
  GiMagicPortal,
  GiRoundStar,
  GiShield,
  GiSkullCrossedBones,
  GiSleepy,
  GiStarSwirl,
  GiStoneBlock,
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
  canUseSkillReason,
  comboMultiplier,
  effectiveApCost,
  enemyDamageTier,
  evaluateStars,
  hasTankAlive,
  teamHpOf,
  healEfficiency,
} from "@choke/shared/battle/engine"
import type { EncounterSpec, EncounterSummary } from "@choke/shared/battle/content"
import { describeStar, starProgress } from "@choke/shared/battle/stars"
import { describeSkill } from "@choke/shared/skill-check"
import { BentGauge } from "./BentGauge"
import { playHit, playLose, playSfx, playTurn, playWin } from "../sfx"
import { TestEnemyPicker } from "./TestEnemyPicker"
import type { BattleState, EnemyIntent, SideSupportUnit } from "@choke/shared/battle/types"
import "./choke-battle.css"

const AP_SLOTS = 10

/**
 * 兰斯10 标志性「外低内高」阶梯折线血条 SVG 路径（viewBox="0 0 460 54"）
 * - BOSS 血条（左）：外侧左段处于下方 (y=26..50)，在 x=250..278 处向上 45° 折起，内侧右段处于上方 (y=6..30) 贴合中央 Round 盾章
 * - 我方血条（右）：内侧左段处于上方 (y=6..30)，在 x=182..210 处向下 45° 折落，外侧右段处于下方 (y=26..50)
 */
const BOSS_GAUGE_POLYGON = "4,26 250,26 278,6 456,6 448,30 286,30 258,50 14,50"
const PARTY_GAUGE_POLYGON = "4,6 182,6 210,26 456,26 446,50 202,50 174,30 12,30"

interface Props {
  battle: BattleState | null
  playerName: string
  deck: CardFaceData[]
  /** 当前选中的遭遇（战前画面展示用） */
  encounter: EncounterSpec
  /** 可选的讨伐目标 */
  encounters: EncounterSummary[]
  tutorial: boolean
  /** 战斗测试：可选所有敌人，不发奖励、不扣体力、不记发现；只在开发模式传入 onToggleTest */
  testMode?: boolean
  onToggleTest?: () => void
  actionError: string | null
  onSelectStage: (stageId: string) => void
  onStart: () => void
  onPlay: (cardIndex: number, skillId: string) => void
  onDefend: (tier?: number) => void
  onSwap: (activeSlotIndex: number, benchUid: number) => void
  onEndTurn: () => void
  onRestart: () => void
}

function bossBgStyle(background: string): CSSProperties {
  return { "--boss-bg": `url(/battle-bg/${background}.jpg)` } as CSSProperties
}

function elementColor(element: string) {
  return ELEMENT_COLOR[element as Element] ?? "#8a9099"
}

function elementLabel(element: string) {
  return ELEMENT_LABEL[element as Element] ?? element
}

/**
 * 弱点条。公开弱点一直显示；隐藏弱点没打中过只显示「？」，打中后显示属性；
 * 窗口弱点（破绽）只在对应回合显示。界面只显示这三类里该显示的，数据本身在接口里都查得到。
 */
function WeaknessRibbon({
  open,
  found,
  exposed,
  unknown,
}: {
  open: readonly Element[]
  found: readonly Element[]
  exposed: readonly Element[]
  unknown: number
}) {
  const chip = (el: Element, title: string, variant?: "found" | "window") => (
    <span
      key={`${variant ?? "open"}-${el}`}
      className="choke-weak-el"
      data-variant={variant}
      title={title}
      style={{ "--el": elementColor(el) } as CSSProperties}
    >
      <ElementGlyph element={el} />
      <em>{variant === "window" ? `${elementLabel(el)} 破绽` : elementLabel(el)}</em>
    </span>
  )
  return (
    <div className="choke-weakness-ribbon">
      <span>弱点属性 ▶▶</span>
      <div className="choke-weakness-icons">
        {open.map((el) => chip(el, `弱点：${elementLabel(el)} (+30% 伤害)`))}
        {found.map((el) => chip(el, `已发现的隐藏弱点：${elementLabel(el)}`, "found"))}
        {exposed.map((el) => chip(el, `本回合露出破绽：${elementLabel(el)}（只在这一回合有效）`, "window"))}
        {Array.from({ length: unknown }, (_, i) => (
          <span
            key={`unknown-${i}`}
            className="choke-weak-el"
            data-variant="unknown"
            title="还有一个隐藏弱点：用对应属性打中一次就能揭开"
          >
            <em>？</em>
          </span>
        ))}
      </div>
    </div>
  )
}

function costTagLabel(tag: SkillDef["costTag"]): string | null {
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
    case "shell":
      return <GiStoneBlock />
    case "aura":
      return <GiTrumpetFlag />
    case "attack":
    default:
      return unit.job ? <JobGlyph job={unit.job} /> : <GiCrossedSwords />
  }
}

export function BattleStage({
  battle,
  playerName,
  deck,
  encounter,
  encounters,
  tutorial,
  testMode = false,
  onToggleTest,
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
  // 血条演出投影：由事件逐段推进；为空时回落到引擎的真实值
  const [hpView, setHpView] = useState<{ party?: number; enemy?: number }>({})
  // 引擎真实血量。事件播完后落到这里，而不是清空：清空会让下一轮一开始就先显示最终值，再被首个事件拉高
  const hpTruth = useRef<{ party?: number; enemy?: number }>({})
  const liveHp = useRef<{ party: number; enemy: number }>({ party: 0, enemy: 0 })
  const [lossPillars, setLossPillars] = useState<
    { id: number; side: "boss" | "party"; left: number; width: number }[]
  >([])
  const pillarId = useRef(1)

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

  // 扣血光柱：从实际掉血的那一段血条位置垂直冲顶（位置以 .choke-bent-gauges 宽度的百分比计）
  const spawnLossPillar = useCallback(
    (side: "boss" | "party", beforePct: number, afterPct: number) => {
      if (beforePct <= afterPct) return
      const id = pillarId.current++
      const start = side === "boss" ? 0.407 + 0.4598 * afterPct : 53.607 + 0.4598 * (100 - beforePct)
      const end = side === "boss" ? 0.407 + 0.4598 * beforePct : 53.607 + 0.4598 * (100 - afterPct)
      const raw = end - start
      const width = Math.max(0.85, raw)
      const left = raw < 0.85 ? (side === "boss" ? start : end) - width / 2 : start
      setLossPillars((prev) => [...prev, { id, side, left, width }])
      later(() => setLossPillars((prev) => prev.filter((p) => p.id !== id)), 520)
    },
    [later],
  )

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

  // 受击演出：属性色爆光 + 放射线 + 斩痕，规模随伤害占敌方血量的比例放大
  const hitBurst = useCallback(
    (element: Element, ratio: number, crit: boolean) => {
      const parent = bossRef.current
      if (!parent) return
      const tier = crit || ratio > 0.08 ? 3 : ratio > 0.03 ? 2 : 1
      const color = elementColor(element)
      const jitter = () => `${(Math.random() - 0.5) * 8}cqw`
      const root = document.createElement("div")
      root.className = "choke-burst"
      root.dataset.tier = String(tier)
      root.style.setProperty("--el", color)
      root.style.setProperty("--jx", jitter())
      root.style.setProperty("--rot", `${-30 + Math.random() * 60}deg`)
      root.innerHTML = '<i class="choke-burst-glow"></i><i class="choke-burst-rays"></i><i class="choke-burst-slash"></i>'
      parent.appendChild(root)
      later(() => root.remove(), 520)

      const amp = 3 + tier * 4
      gsap.fromTo(
        parent,
        { x: 0, y: 0 },
        {
          x: amp,
          y: -amp * 0.6,
          duration: 0.035,
          repeat: 3 + tier * 2,
          yoyo: true,
          ease: "power1.inOut",
          onComplete: () => gsap.set(parent, { x: 0, y: 0 }),
        },
      )
    },
    [later],
  )

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
      hpTruth.current = {}
      later(() => setHpView({}), 0)
      return
    }
    const truth = { enemy: battle.enemy.hp, party: teamHpOf(battle).hp }
    if (hpTruth.current.enemy === undefined) {
      hpTruth.current = truth
      setHpView(truth)
    }
    if (battle.actionSeq === lastSeq.current) return
    lastSeq.current = battle.actionSeq
    liveHp.current = {
      enemy: hpTruth.current.enemy ?? truth.enemy,
      party: hpTruth.current.party ?? truth.party,
    }
    hpTruth.current = truth
    const partyMax = Math.max(1, teamHpOf(battle).max)
    const enemyMax = Math.max(1, battle.enemy.hpMax)

    const stepGap = speedHigh ? 110 : 190
    battle.events.forEach((event, idx) => {
      const delay = idx * stepGap
      later(() => {
        if (event.type === "cutin") {
          playSfx("cutin")
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
            if (event.enemyHpAfter != null) {
              const before = liveHp.current.enemy
              liveHp.current.enemy = event.enemyHpAfter
              spawnLossPillar("boss", (before / enemyMax) * 100, (event.enemyHpAfter / enemyMax) * 100)
              setHpView((prev) => ({ ...prev, enemy: event.enemyHpAfter }))
            }
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
            hitBurst(event.element, event.amount / Math.max(1, battle.enemy.hpMax), Boolean(event.crit))
            const attacker = cardRefs.current[event.cardIndex ?? -1]
            if (attacker) {
              gsap.fromTo(
                attacker,
                { y: 0 },
                {
                  y: -18,
                  duration: 0.07,
                  yoyo: true,
                  repeat: 1,
                  ease: "power2.out",
                  onComplete: () => gsap.set(attacker, { clearProps: "transform" }),
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
            playHit(event.combo ?? battle.combo, Boolean(event.crit), event.element)
          } else {
            if (event.hpAfter != null) {
              const before = liveHp.current.party
              liveHp.current.party = event.hpAfter
              spawnLossPillar("party", (before / partyMax) * 100, (event.hpAfter / partyMax) * 100)
              setHpView((prev) => ({ ...prev, party: event.hpAfter }))
            }
            const targetNode = cardRefs.current[event.cardIndex ?? -1] ?? stageRef.current
            popup(targetNode, `-${event.amount.toLocaleString("en-US")}`, "card", event.source)
            playSfx("hit", { rate: 0.88 })
          }
          return
        }

        if (event.type === "heal") {
          if (event.hpAfter != null) {
            liveHp.current.party = event.hpAfter
            setHpView((prev) => ({ ...prev, party: event.hpAfter }))
          }
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
          playSfx(event.success ? "break" : "miss")
          return
        }

        if (event.type === "wake_up") {
          popup(bossRef.current, "WAKE UP!", "enemy", "受击解除硬控", "wake")
          playSfx("guard")
          return
        }

        if (event.type === "weakness_found") {
          popup(bossRef.current, "发现弱点！", "enemy", `${elementLabel(event.element)}属性`, "interrupt", true)
          playSfx("break")
          return
        }

        if (event.type === "down") {
          popup(cardRefs.current[event.cardIndex] ?? stageRef.current, "DOWN!", "card", event.cardName, "miss")
          playSfx("down")
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

    // 事件全部播完后回落到引擎真实值，保证长时间挂机也不会和状态脱节
    later(() => setHpView(hpTruth.current), battle.events.length * stepGap + 520)
  }, [battle, flash, hitBurst, later, popup, spawnLossPillar, speedHigh, turnBanner])

  const startBattle = () => {
    playSfx("click")
    onStart()
  }

  // ==================== 1. 战前准备画面 ====================
  if (!battle) {
    const foe = encounter.enemy
    const enemyName = foe.name
    const enemyHp = foe.stats.hp
    const weaknesses = foe.weaknesses
    const totalBp = deck.reduce((sum, card) => sum + battlePower(card), 0)

    return (
      <div className="choke-viewport">
        <div className="choke-stage" data-phase="prepare" data-production="true">
          <section className="choke-boss-zone" style={bossBgStyle(encounter.background)}>
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
              <small>{tutorial ? "TUTORIAL STAGE" : foe.title}</small>
              <div>{enemyName}</div>
            </div>
            <div className="choke-prep-badge">{tutorial ? "教学战斗" : testMode ? "战斗测试" : "准备战斗"}</div>

            {!tutorial && (
              <div className="choke-stage-selector" data-test={testMode ? "true" : undefined}>
                <span className="choke-stage-selector__label">
                  <GiTargetLaser /> {testMode ? "选择测试对象" : "选择讨伐目标"}
                  {onToggleTest && (
                    <button
                      type="button"
                      className="choke-test-toggle"
                      data-active={testMode ? "true" : undefined}
                      title="开发模式：可选所有敌人，不发奖励、不扣体力、不记弱点发现"
                      onClick={() => {
                        playSfx("click")
                        onToggleTest()
                      }}
                    >
                      战斗测试
                    </button>
                  )}
                </span>
                {testMode ? (
                  <TestEnemyPicker encounters={encounters} activeId={encounter.id} onSelect={onSelectStage} />
                ) : (
                  <div className="choke-stage-selector__btns">
                    {encounters.map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        className="choke-stage-pill"
                        data-active={st.id === encounter.id ? "true" : undefined}
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
                )}
                <p className="choke-stage-selector__desc">{encounter.summary}</p>
              </div>
            )}

            <div className="choke-outcome-box">
              <div className="choke-outcome-head">战斗评价与路线条件</div>
              {encounter.stars.map((cond, i) => {
                const { title, target } = describeStar(cond)
                return (
                  <div className="choke-outcome-row" key={cond.type}>
                    <span>
                      ★{i + 1} {title}
                    </span>
                    <b>{target}</b>
                  </div>
                )
              })}
            </div>
          </section>

          {/* 准备画面同样采用兰斯10阶梯折线双血条 */}
          <section className="choke-hud-band">
            <div className="choke-hud-upper">
              <div className="choke-side-info choke-side-info--boss">
                <div className="choke-side-name">{enemyName}</div>
                <div className="choke-hp-num">
                  <i>Hp</i>
                  <b>{enemyHp.toLocaleString("en-US")}</b>
                </div>
              </div>

              <div className="choke-shelf-left">
                <WeaknessRibbon open={weaknesses} found={[]} exposed={[]} unknown={foe.hiddenWeaknesses.length} />
              </div>

              <div className="choke-shelf-right" />

              <div className="choke-side-info choke-side-info--party">
                <div className="choke-side-name">{playerName}</div>
                <div className="choke-hp-num">
                  <i>BP</i>
                  <b>{totalBp.toLocaleString("en-US")}</b>
                </div>
              </div>
            </div>

            <div className="choke-bent-gauges">
              <BentGauge side="boss" polygon={BOSS_GAUGE_POLYGON} pct={100} fillX={4} fillWidth={452} />

              <button type="button" className="choke-center-orb" onClick={startBattle}>
                <span className="choke-orb-start">战斗开始</span>
              </button>

              <BentGauge side="party" polygon={PARTY_GAUGE_POLYGON} pct={100} fillX={4} fillWidth={452} />

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
                ? "教学战：熟悉连击 Combo、AP 继承与右侧【防御】侧面支援；弱点条上的“？”是隐藏弱点。"
                : testMode
                  ? "战斗测试：不发奖励、不扣体力、不记弱点发现。"
                  : "确认讨伐目标与编队后，点击中央【战斗开始】。"}
            </span>
          </footer>
        </div>
      </div>
    )
  }

  // ==================== 2. 正式战斗画面（1:1 兰斯10 折线血条 + 垂直红白扣血光柱） ====================
  const team = teamHpOf(battle)
  const healEff = healEfficiency(battle)
  // 演出投影：血条与数字跟随「已播放到的事件」推进，而不是直接读引擎的终值
  const shownEnemyHp = hpView.enemy ?? battle.enemy.hp
  const shownPartyHp = hpView.party ?? team.hp
  const bossPct = Math.max(0, Math.min(100, (shownEnemyHp / Math.max(1, battle.enemy.hpMax)) * 100))
  const partyPct = Math.max(0, Math.min(100, (shownPartyHp / Math.max(1, team.max)) * 100))
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
        <section className="choke-boss-zone" ref={bossRef} style={bossBgStyle(encounter.background)}>
          <div
            className="choke-boss-backdrop"
            key={slashKey}
            data-slashed={slashKey > 0 ? "true" : undefined}
            data-dead={battle.enemy.hp <= 0 ? "true" : undefined}
            aria-hidden
          />

          {slashKey > 0 && <div className="choke-slash-fx" key={`slash-${slashKey}`} aria-hidden />}

          {/* 敌人本体用战区背景图表现，这里只留属性色光晕 */}
          <div
            className="choke-boss-figure"
            style={{ "--el": elementColor(battle.enemy.element) } as CSSProperties}
            aria-hidden
          >
            <div className="choke-boss-aura" />
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
                  data-tier={(unit.tier ?? 1) > 1 ? unit.tier : undefined}
                  style={{ "--el": elementColor(unit.element) } as CSSProperties}
                  title={`${unit.name}：${unit.roleText}（强度 ${unit.tier ?? 1}）`}
                >
                  {(unit.tier ?? 1) > 1 && (
                    <span className="choke-plate-tier" aria-hidden>
                      {unit.tier}
                    </span>
                  )}
                  <div className="choke-plate-icon">
                    <SupportKindIcon unit={unit} />
                    {unit.defenseTier != null && <i>{unit.defenseTier}</i>}
                    {unit.stacks != null && <i>{unit.stacks}</i>}
                  </div>
                  <div className="choke-plate-text">
                    <b>{unit.name}</b>
                    <small>{unit.roleText}</small>
                  </div>
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
                  data-tier={(unit.tier ?? 1) > 1 ? unit.tier : undefined}
                  style={{ "--el": elementColor(unit.element) } as CSSProperties}
                  title={`${unit.name}：${unit.roleText}（强度 ${unit.tier ?? 1}）`}
                >
                  {(unit.tier ?? 1) > 1 && (
                    <span className="choke-plate-tier" aria-hidden>
                      {unit.tier}
                    </span>
                  )}
                  <div className="choke-plate-icon">
                    <SupportKindIcon unit={unit} />
                    {unit.defenseTier != null && <i>{unit.defenseTier}</i>}
                  </div>
                  <div className="choke-plate-text">
                    <b>{unit.name}</b>
                    <small>{unit.roleText}</small>
                  </div>
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

        {/* ================= 2. 中轴区：兰斯10 阶梯折线双血条 + 弱点/意图台阶 + COMBO 台阶 + 底部内嵌 AP ================= */}
        <section className="choke-hud-band">
          {/* 折线血条上方的四段信息区：左外(BOSS名+HP) | 左内高台(意图+弱点) | 右内高台(COMBO!) | 右外(讨伐队名+HP) */}
          <div className="choke-hud-upper">
            {/* 左外低段上方：红军剪影 + 敌方名 + 大号衬线 HP */}
            <div className="choke-side-info choke-side-info--boss">
              <div className="choke-side-name">{battle.enemy.name}</div>
              <div className="choke-hp-num">
                <i>Hp</i>
                <b>{shownEnemyHp.toLocaleString("en-US")}</b>
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
                      {status.stacks && status.stacks > 1 ? `×${status.stacks}` : ""}
                      <i>{status.turns}</i>
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
                      data-hard-to-interrupt={intent.hardToInterrupt ? "true" : undefined}
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
                      {intent.hardToInterrupt && (
                        <b className="choke-intent-box__lock" title="难以打断">
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
                      {hoveredIntent.hardToInterrupt ? " · 🔒 难以打断（打断、硬控成功率 ×0.4）" : " · 可被刺客打断"}
                    </div>
                    <div className="choke-tooltip-desc">{hoveredIntent.desc}</div>
                  </div>
                )}
              </div>

              <WeaknessRibbon
                open={battle.enemy.weaknesses}
                found={battle.hiddenFound}
                exposed={battle.enemy.exposed}
                unknown={battle.enemy.hiddenWeaknesses.length - battle.hiddenFound.length}
              />
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
              {battle.teamStatuses.length > 0 && (
                <div className="choke-mini-statuses choke-mini-statuses--party">
                  {battle.teamStatuses.map((status) => (
                    <span
                      className={`choke-buff-pill ${status.isDebuff ? "choke-buff-pill--bad" : ""}`}
                      key={status.id}
                    >
                      {status.name}
                      <i>{status.turns}</i>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 右外低段上方：讨伐队 + 大号衬线 HP */}
            <div className="choke-side-info choke-side-info--party">
              <div className="choke-side-name">{playerName}</div>
              <div className="choke-hp-num">
                <i>Hp</i>
                <b>{shownPartyHp.toLocaleString("en-US")}</b>
              </div>
              <div
                className="choke-heal-left"
                data-empty={healEff < 0.5 ? "true" : undefined}
                title="本场回血越多，之后每次治疗越弱（回过软上限那么多血时减半）"
              >
                <i>治疗效率</i>
                <b>{battle.healSoftCap === null ? "100%" : `${Math.round(healEff * 100)}%`}</b>
              </div>
            </div>
          </div>

          {/* 兰斯10 阶梯折线双血条 + 中央盾形 Round/VS + 折线凹槽下的 AP 齿轮宝石栏 */}
          <div className="choke-bent-gauges">
            {lossPillars.map((p) => (
              <div
                key={p.id}
                className={`choke-hp-loss-pillar choke-hp-loss-pillar--${p.side}`}
                style={{ left: `${p.left}%`, width: `${p.width}%` }}
                aria-hidden
              />
            ))}
            {/* 左：BOSS 阶梯折线血条 */}
            <BentGauge side="boss" polygon={BOSS_GAUGE_POLYGON} pct={bossPct} fillX={4} fillWidth={bossFillWidth} />

            <button type="button" className="choke-center-orb" disabled>
              <i className="choke-orb-round">Round</i>
              <b className="choke-orb-num">{battle.turn}</b>
              <span className="choke-orb-vs">VS</span>
            </button>

            <BentGauge side="party" polygon={PARTY_GAUGE_POLYGON} pct={partyPct} fillX={partyFillX} fillWidth={partyFillWidth} />

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
                  data-bursting={laserTargets.includes(index) ? "true" : undefined}
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
                          ? `${JOB_LABEL[card.job]} · 被动技能（无需点击，自动生效）`
                          : `${elementLabel(tooltipInfo.skill.element)} · 消耗 ${tooltipInfo.actualAp} AP${
                              tooltipInfo.skill.hits && tooltipInfo.skill.hits > 1
                                ? ` · ${tooltipInfo.skill.hits} 段连击`
                                : ""
                            }`}
                      </div>
                      <div className="choke-tooltip-desc">{describeSkill(tooltipInfo.skill)}</div>
                      {!tooltipInfo.skill.passive && tooltipInfo.reason && (
                        <div className="choke-tooltip-warn">⚠️ {tooltipInfo.reason}</div>
                      )}
                    </div>
                  )}

                  {guardChipSlot === index && <span className="choke-guard-chip">嘲讽援护!</span>}

                  <div className="choke-card-frame">
                    <GameCardFace card={card.face} eager />

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
                        <div className="choke-stamp-text">
                          <b>DOWN</b>
                          <small>{card.downTurns} 回合苏醒</small>
                        </div>
                      </div>
                    )}

                    {/* 兰斯10 风格：已行动卡片中央红色禁止环 + 「行動終了」印章（见参考图第3张卡） */}
                    {!card.down && card.acted && (
                      <div className="choke-acted-stamp">
                        <div className="choke-acted-circle" />
                        <div className="choke-stamp-text">
                          <b>行動終了</b>
                        </div>
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
                  <small>{c.down ? "DOWN" : JOB_LABEL[c.job]}</small>
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
                    {JOB_LABEL[b.job]} · LV{b.level}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ================= 5. 最底栏与 LOG 抽屉 ================= */}
        <footer className="choke-footer">
          <span className="choke-ticker">
            {actionError
              ? `⚠️ ${actionError}`
              : tutorial && battle.phase === "player" && battle.hiddenFound.length === 0
                ? "💡 教学提示：弱点条里的“？”是隐藏弱点，用对应属性打中一次才会揭开。幽灵最怕火；没有火属性的卡也不影响通关。"
                : (battle.log[0] ?? "战斗开始")}
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
                  : `${playerName} 的队伍在第 ${battle.turn} 回合生命归零。`}
              </p>

              {battle.phase === "won" && (
                <div className="choke-stars-grid">
                  {stars.stars.map(({ condition, met }, i) => (
                    <div className="choke-star-item" data-achieved={met ? "true" : undefined} key={condition.type}>
                      <GiRoundStar />
                      <b>
                        ★{i + 1} {describeStar(condition).title}
                      </b>
                      <small>{starProgress(condition, battle)}</small>
                    </div>
                  ))}
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
