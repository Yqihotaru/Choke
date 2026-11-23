import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react"

import { playReveal, playSfx } from "@/audio/sfx"
import { RARITY_LABEL } from "@/card/data"
import { GameCardFace } from "@/card/GameCardFace"
import { RARITIES } from "@/card/types"
import { useModal } from "@/ui/useModal"

import { cardFromDesk } from "@/desk/lib/cardFace"
import { CARD_POINTER_DROP_EVENT, startCardPointerDrag, type CardPointerDrop } from "@/desk/lib/drag"
import { CardDragLayer } from "@/desk/shell/DragGhost"
import { RARITY_COLOR } from "@/desk/lib/rarity"
import type { CardData, PackPool, Rarity } from "@/desk/lib/types"
import { PackArt } from "@/desk/opening/PackArt"
import "@/desk/opening/opener.css"
import "@/desk/opening/opener-fx.css"

export interface OriginRect {
  left: number
  top: number
  width: number
  height: number
}

interface Props {
  cards: CardData[]
  pool: PackPool
  /** 桌上那个卡包的视口矩形，大包从这里放大出来 */
  origin?: OriginRect
  /** 全部放到桌面 */
  onDone: () => void
  /** 直接收进卡册（卡已经落库，关掉开包层即可） */
  onQuick: () => void
  /** 背包里同等级卡包还剩几个 */
  remaining?: number
  /** 继续开下一个同等级卡包 */
  onOpenNext?: () => void
  /** 单张拖到桌面 */
  onDropCard: (card: CardData) => void
}

const RARITY_ORDER = RARITIES
/** 未翻开就关掉时需要二次确认的最低档位 */
const CONFIRM_FROM = RARITY_ORDER.indexOf("E")
/** 结算时最高档达到它就换更隆重的音效 */
const FINALE_FROM = RARITY_ORDER.indexOf("L")
/** 翻开时桌面暗下来、扫一道光的档位 */
const BIG: Record<Rarity, boolean> = { C: false, UC: false, R: false, E: false, L: true, Mythic: true, Prismatic: true }
/** 翻牌前卡背边缘透出的光，越稀有越亮 */
const GLOW: Record<Rarity, number> = { C: 0, UC: 0.22, R: 0.38, E: 0.55, L: 0.75, Mythic: 0.9, Prismatic: 1 }
/** 蓄力、展示的时长（ms）；没列出的档位直接翻开 */
const RITUAL: Partial<Record<Rarity, { charge: number; show: number }>> = {
  E: { charge: 240, show: 420 },
  L: { charge: 550, show: 900 },
  Mythic: { charge: 600, show: 950 },
  Prismatic: { charge: 650, show: 1000 },
}
const REDUCED_RITUAL = { charge: 80, show: 260 }
/** 大包在开包层里的宽度（px），和 opener.css 的 .op__pack 一致 */
const PACK_W = 240
/** 撕开动画总长，和 opener.css 的 op-strip-off / op-pack-drop 对齐 */
const TEAR_MS = 1000

type Stage = "seal" | "torn" | "stack"
/** stack 背面朝上叠着 → charge 抬起蓄光 → show 翻开停在中间 → slot 落到结果排里 */
type CardPhase = "stack" | "charge" | "show" | "slot"

const keyOf = (card: CardData) => String(card.userCardId ?? `${card.cardId}:${card.name}`)
const OpenerFace = memo(function OpenerFace({ card }: { card: CardData }) {
  return <GameCardFace card={cardFromDesk(card)} eager />
})

/**
 * 开包：拖住撕条往左撕开（点一下也行）→ 5 张卡背朝上滑出叠成一摞 → 点最上面那张翻开（或全部翻开）。
 * 从低到高翻，最好的一张留到最后；E 以上翻开前先抬起蓄光，L 以上桌面还会暗下来、翻开时扫一道光。
 * 蓄光和展示阶段点一下或按空格可以提前结束。
 */
export function PackOpener({ cards, pool, origin, onDone, onQuick, onDropCard, remaining = 0, onOpenNext }: Props) {
  const [stage, setStage] = useState<Stage>("seal")
  const [progress, setProgress] = useState(0)
  const [snapping, setSnapping] = useState(false)
  const [entered, setEntered] = useState(!origin)
  const [phases, setPhases] = useState<Record<string, CardPhase>>({})
  const [auto, setAuto] = useState(false)
  const [draggingCard, setDraggingCard] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [said, setSaid] = useState("")
  const [reduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  /** L 以上翻开那一下的全屏演出；id 每次加一，连着两张大卡时各播各的 */
  const [burst, setBurst] = useState<{ id: number; rarity: Rarity } | null>(null)
  const burstId = useRef(0)
  const tear = useRef<{ x: number; width: number; moved: boolean; tick: number; p: number } | null>(null)
  const torn = useRef(false)
  const timers = useRef<number[]>([])
  const revealTimers = useRef<number[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const live = useRef({ skip: () => {}, canSkip: false })
  const dropRef = useRef(onDropCard)
  const finale = useRef(RARITY_ORDER.length - 1)

  useEffect(() => {
    dropRef.current = onDropCard
  })

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onDrop = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-card-drop]")) return
      const { payload } = (event as CustomEvent<CardPointerDrop>).detail
      if (!payload.card) return
      event.preventDefault()
      dropRef.current(payload.card)
    }
    root.addEventListener(CARD_POINTER_DROP_EVENT, onDrop)
    return () => root.removeEventListener(CARD_POINTER_DROP_EVENT, onDrop)
  }, [])

  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(fn, ms)
    timers.current.push(id)
    return id
  }

  useEffect(() => {
    // 大包从桌上飞到面前
    playSfx("whoosh")
    const pending = timers.current
    return () => pending.forEach((id) => window.clearTimeout(id))
  }, [])

  // 从桌上的小包原位放大
  useLayoutEffect(() => {
    if (entered) return
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)))
    return () => cancelAnimationFrame(frame)
  }, [entered])

  const sorted = useMemo(
    () =>
      cards
        .map((card, index) => ({ card, index }))
        .sort((a, b) => RARITY_ORDER.indexOf(a.card.rarity) - RARITY_ORDER.indexOf(b.card.rarity) || a.index - b.index)
        .map(({ card }) => card),
    [cards],
  )

  const phaseOf = (card: CardData): CardPhase => phases[keyOf(card)] ?? "stack"
  const unrevealed = sorted.filter((card) => phaseOf(card) === "stack")
  const next = stage === "stack" ? unrevealed[0] : undefined
  const spotlight = sorted.find((card) => ["charge", "show"].includes(phaseOf(card)))
  const allOpen = stage === "stack" && unrevealed.length === 0 && !spotlight
  const pendingHigh = sorted.filter(
    (card) => phaseOf(card) !== "slot" && RARITY_ORDER.indexOf(card.rarity) >= CONFIRM_FROM,
  ).length
  const asking = confirming && pendingHigh > 0
  const tally = useMemo(
    () =>
      [...RARITY_ORDER]
        .reverse()
        .map((rarity) => ({ rarity, count: sorted.filter((card) => card.rarity === rarity).length }))
        .filter((entry) => entry.count > 0),
    [sorted],
  )

  const setPhase = (card: CardData, phase: CardPhase) =>
    setPhases((prev) => ({ ...prev, [keyOf(card)]: phase }))

  const ritualOf = (rarity: Rarity) => (RITUAL[rarity] ? (reduced ? REDUCED_RITUAL : RITUAL[rarity]) : undefined)

  const clearReveal = () => {
    revealTimers.current.forEach((id) => window.clearTimeout(id))
    revealTimers.current = []
  }

  const settle = (card: CardData) => {
    clearReveal()
    playSfx("drop")
    setPhase(card, "slot")
  }

  /** 闪卡翻开后补一串亮音，和翻牌声错开一点 */
  const sparkle = (card: CardData) => {
    if (card.foil) later(140, () => playSfx("shine"))
  }

  const show = (card: CardData) => {
    clearReveal()
    playReveal(card.rarity)
    sparkle(card)
    setPhase(card, "show")
    if (BIG[card.rarity] && !reduced) {
      const id = ++burstId.current
      setBurst({ id, rarity: card.rarity })
      later(1100, () => setBurst((cur) => (cur?.id === id ? null : cur)))
    }
    revealTimers.current.push(later(ritualOf(card.rarity)?.show ?? 0, () => settle(card)))
  }

  const reveal = (card: CardData) => {
    if (phaseOf(card) !== "stack" || spotlight) return
    setSaid(`${card.name}，${RARITY_LABEL[card.rarity]}，还剩 ${unrevealed.length - 1} 张`)
    const ritual = ritualOf(card.rarity)
    if (!ritual) {
      // 连着翻的普通卡一张比一张高一点，听得出「在往上走」
      playReveal(card.rarity, 1 + (sorted.length - unrevealed.length) * 0.05)
      sparkle(card)
      setPhase(card, "slot")
      return
    }
    playSfx("charge")
    setPhase(card, "charge")
    revealTimers.current.push(later(ritual.charge, () => show(card)))
  }

  /** 蓄力中点一下直接翻开，展示中点一下直接落位 */
  const skipReveal = () => {
    if (!spotlight) return
    if (phaseOf(spotlight) === "charge") show(spotlight)
    else settle(spotlight)
  }

  // 全部翻开：低档几乎即翻，高档等上一张落定再翻
  useEffect(() => {
    if (!auto || !next || spotlight) return
    const id = window.setTimeout(() => reveal(next), ritualOf(next.rarity) ? 160 : 70)
    return () => window.clearTimeout(id)
  })

  useEffect(() => {
    live.current = { skip: skipReveal, canSkip: !!spotlight }
    finale.current = Math.max(...sorted.map((card) => RARITY_ORDER.indexOf(card.rarity)))
  })

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== " " && event.key !== "Enter") return
      if (event.target instanceof Element && event.target.closest("button, [role=button]")) return
      if (!live.current.canSkip) return
      event.preventDefault()
      live.current.skip()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (allOpen) playSfx(finale.current >= FINALE_FROM ? "levelup" : "success")
  }, [allOpen])

  const tearOpen = () => {
    if (torn.current) return
    torn.current = true
    tear.current = null
    playSfx("tear")
    setProgress(1)
    setStage("torn")
    if (reduced) {
      later(80, () => setStage("stack"))
      return
    }
    // 卡一张张从撕口抽出来（和 cardStyle 里每张 70ms 的错开对上），最后落成一摞
    sorted.forEach((_, order) =>
      later(180 + order * 70, () => playSfx("deal", { rate: 0.92 + order * 0.05, volume: 0.7 })),
    )
    later(TEAR_MS, () => {
      playSfx("thud", { volume: 0.6 })
      setStage("stack")
    })
  }

  const onTearDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (stage !== "seal") return
    event.currentTarget.setPointerCapture(event.pointerId)
    const pack = event.currentTarget.closest(".op__pack")
    tear.current = {
      x: event.clientX,
      width: (pack?.getBoundingClientRect().width ?? PACK_W) * 0.75,
      moved: false,
      tick: 0,
      p: 0,
    }
    setSnapping(false)
  }

  const onTearMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = tear.current
    if (!drag) return
    const p = Math.min(Math.max((drag.x - event.clientX) / drag.width, 0), 1)
    if (p > 0.03) drag.moved = true
    drag.p = p
    // 每拖过约 8% 的进度响一下
    const tick = Math.floor(p / 0.08)
    if (tick !== drag.tick) {
      drag.tick = tick
      if (tick > 0 && p < 1) playSfx("tick")
    }
    setProgress(p)
    if (p >= 1) tearOpen()
  }

  const onTearUp = (cancelled: boolean) => {
    const drag = tear.current
    if (!drag) return
    tear.current = null
    // 只是点了一下，或者已经拖过大半：直接撕开
    if (!cancelled && (!drag.moved || drag.p >= 0.85)) {
      tearOpen()
      return
    }
    setSnapping(true)
    setProgress(0)
    if (drag.moved) playSfx("lift")
  }

  const onTearKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      tearOpen()
    }
  }

  /** Esc 和 × 共用：还有 E 以上的卡没翻开时先问一句 */
  const requestClose = () => {
    if (asking) {
      setConfirming(false)
      return
    }
    playSfx("close")
    if (pendingHigh > 0) setConfirming(true)
    else onQuick()
  }

  useModal(rootRef, { onClose: requestClose })

  const enterStyle =
    !entered && origin
      ? {
          transform: `translate(${origin.left + origin.width / 2 - window.innerWidth / 2}px, ${
            origin.top + origin.height / 2 - window.innerHeight / 2
          }px) scale(${origin.width / PACK_W})`,
          transition: "none",
        }
      : undefined

  const cardStyle = (card: CardData, order: number): CSSProperties => {
    const phase = phaseOf(card)
    const depth = unrevealed.indexOf(card)
    const jitter = ((order * 37) % 7) - 3
    let x = "0px"
    let y = "0px"
    let scale = 1
    let rotate = 0
    let z = 10
    let delay = "0ms"
    if (stage === "seal") {
      y = "30px"
      scale = 0.92
    } else if (stage === "torn") {
      // 从撕口里抽出来，前面还挡着包身
      y = "calc(var(--ch) * -0.46)"
      delay = `${order * 70}ms`
      z = 10 + order
    } else if (phase === "stack") {
      x = `${depth * 1.5}px`
      y = `calc(var(--stack-y) - ${depth * 2}px)`
      rotate = jitter * 0.6
      z = 100 - depth
    } else if (phase === "charge") {
      scale = 1.12
      z = 300
    } else if (phase === "show") {
      scale = 1.32
      z = 300
    } else {
      x = `calc(${order - (sorted.length - 1) / 2} * var(--pitch))`
      y = "var(--row-y)"
      z = 20 + order
    }
    return {
      transform: `translate(${x}, ${y}) rotate(${rotate}deg) scale(${scale})`,
      transitionDelay: delay,
      zIndex: z,
      "--glow": card.rarity === "Prismatic" ? "#ffffff" : RARITY_COLOR[card.rarity],
      "--glow-k": GLOW[card.rarity],
    } as CSSProperties
  }

  const hint =
    stage === "seal"
      ? "拖住右上角的撕条往左撕开，也可以直接点一下"
      : stage === "torn"
        ? ""
        : spotlight
          ? "点击或按空格跳过"
          : next
            ? `点最上面那张翻开 · 还剩 ${unrevealed.length} 张`
            : allOpen
              ? "把卡拖到下面的框里单张放到桌面，或者一次处理全部"
              : ""
  const announce = stage === "stack" && !allOpen && said ? said : hint
  const dim = !!spotlight && BIG[spotlight.rarity]

  return (
    <div
      ref={rootRef}
      className={`op ${allOpen ? "is-done" : ""}`}
      data-stage={stage}
      data-dim={dim ? "" : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="开包"
      style={
        {
          "--gaps": Math.max(1, sorted.length - 1),
          ...(dim && spotlight ? { "--burst": RARITY_COLOR[spotlight.rarity] } : {}),
        } as CSSProperties
      }
    >
      <div className="op__backdrop" onClick={skipReveal} />
      <i className="op__burst" data-rarity={dim ? spotlight?.rarity : undefined} aria-hidden />
      {burst && (
        <div
          key={burst.id}
          className="op__boom"
          data-rarity={burst.rarity}
          style={{ "--c": burst.rarity === "Prismatic" ? "#ffffff" : RARITY_COLOR[burst.rarity] } as CSSProperties}
          aria-hidden
        >
          <i className="op__boom-flash" />
          <i className="op__boom-ring" />
          {Array.from({ length: 14 }, (_, i) => (
            <i
              key={i}
              className="op__boom-spark"
              style={{ "--a": `${i * (360 / 14)}deg`, "--i": i, "--far": `${-30 - (i % 2) * 14}vmin` } as CSSProperties}
            />
          ))}
        </div>
      )}
      {/* E 以上亮相时在卡下方报出稀有度；key 用卡，换一张就重新砸一次 */}
      {spotlight && phaseOf(spotlight) === "show" && (
        <div
          key={keyOf(spotlight)}
          className="op__title"
          data-rarity={spotlight.rarity}
          style={{ "--c": RARITY_COLOR[spotlight.rarity] } as CSSProperties}
          aria-hidden
        >
          {RARITY_LABEL[spotlight.rarity]}
        </div>
      )}

      <div className="op__table">
        {sorted.map((card, order) => {
          const phase = phaseOf(card)
          const flipped = phase === "show" || phase === "slot"
          const isTop = card === next
          return (
            <div
              key={keyOf(card)}
              className={`op-card ${isTop ? "is-top" : ""}`}
              data-phase={stage === "stack" ? phase : stage}
              data-rarity={card.rarity}
              style={cardStyle(card, order)}
              onPointerDown={(event) => {
                if (phase === "slot") startCardPointerDrag(event, { card }, {
                  onStart: () => setDraggingCard(true),
                  onFinish: () => setDraggingCard(false),
                })
              }}
              onClick={() => {
                if (isTop) reveal(card)
                else if (phase === "charge" || phase === "show") skipReveal()
              }}
              role={isTop ? "button" : flipped ? "group" : undefined}
              tabIndex={isTop ? 0 : undefined}
              aria-label={isTop ? "翻开这张卡" : flipped ? `${card.name}，${RARITY_LABEL[card.rarity]}` : undefined}
              onKeyDown={(event) => {
                if (isTop && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault()
                  reveal(card)
                }
              }}
            >
              <i className="op-card__glow" aria-hidden />
              <div className={`op-card__flip ${flipped ? "is-flipped" : ""}`}>
                <div className="op-card__back" aria-hidden>
                  <div className="cb">
                    <i className="cb__frame" />
                    <img className="cb__mark" src="/brand/choke-icon.svg" alt="" draggable={false} />
                    <span className="cb__word">CHOKE!</span>
                  </div>
                </div>
                <div className="op-card__front">
                  <OpenerFace card={card} />
                  <i className="op-card__sweep" aria-hidden />
                </div>
              </div>
            </div>
          )
        })}

        {stage !== "stack" && (
          <div className="op__pack" style={{ ...enterStyle, "--tear-p": progress } as CSSProperties}>
            <div className="op__pack-body">
              <PackArt pool={pool} />
            </div>
            <div className={`op__pack-strip ${snapping ? "is-snapping" : ""}`}>
              <PackArt pool={pool} />
            </div>
            <i className="op__pack-gash" aria-hidden />
            {stage === "seal" && (
              <button
                type="button"
                className="op__pack-tab"
                aria-label="撕开卡包"
                onPointerDown={onTearDown}
                onPointerMove={onTearMove}
                onPointerUp={() => onTearUp(false)}
                onPointerCancel={() => onTearUp(true)}
                onKeyDown={onTearKey}
              />
            )}
          </div>
        )}
      </div>

      {allOpen && (
        <ul className="op__tally" aria-label="本包稀有度汇总">
          {tally.map(({ rarity, count }) => (
            <li key={rarity} style={{ "--c": RARITY_COLOR[rarity] } as CSSProperties}>
              <i aria-hidden />
              {rarity}
              <b>×{count}</b>
            </li>
          ))}
        </ul>
      )}

      {allOpen && (
        <div
          className={`op__drop ${draggingCard ? "is-active" : ""}`}
          data-card-drop
        >
          <b>拖到这里</b>
          <span>单张放到桌面</span>
        </div>
      )}

      <div className="op__foot">
        {hint && (
          // key 用提示本身：换了一句就重新淡入
          <p className="op__hint" key={hint} aria-hidden>
            {hint}
          </p>
        )}
        {stage === "stack" && !allOpen && (
          <button
            type="button"
            className="op__btn op__btn--main"
            onClick={() => {
              if (spotlight) {
                playSfx("tick")
                skipReveal()
              } else {
                playSfx("deal")
                setAuto(true)
              }
            }}
            disabled={!spotlight && auto}
          >
            {spotlight ? "跳过" : "全部翻开"}
          </button>
        )}
        {allOpen && (
          <div className="op__actions">
            <button
              type="button"
              className="op__btn"
              onClick={() => {
                playSfx("slide")
                onQuick()
              }}
            >
              存入卡册
            </button>
            <button
              type="button"
              className="op__btn op__btn--main"
              onClick={() => {
                playSfx("whoosh")
                onDone()
              }}
            >
              全部放到桌面
            </button>
            {remaining > 0 && onOpenNext && (
              <button
                type="button"
                className="op__btn op__btn--main"
                onClick={() => {
                  playSfx("open")
                  onOpenNext()
                }}
              >
                继续开包（剩 {remaining}）
              </button>
            )}
          </div>
        )}
      </div>

      <p className="op__sr" role="status" aria-live="polite">
        {announce}
      </p>

      {asking && (
        <div className="op__confirm" role="alert">
          <span>还有 {pendingHigh} 张 E 及以上的卡没翻开，确定跳过？</span>
          <button type="button" className="op__btn" onClick={() => setConfirming(false)}>
            继续翻
          </button>
          <button
            type="button"
            className="op__btn op__btn--main"
            onClick={() => {
              playSfx("close")
              onQuick()
            }}
          >
            确定跳过
          </button>
        </div>
      )}

      <button type="button" className="op__close" onClick={requestClose} aria-label="关闭开包，卡牌收进卡册">
        ×
      </button>
      <CardDragLayer root={rootRef} />
    </div>
  )
}
