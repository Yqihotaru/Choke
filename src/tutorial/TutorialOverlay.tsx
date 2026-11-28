import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"

import { playSfx } from "@/audio/sfx"
import { useGameConfig } from "@/desk/session/useGameConfig"
import { useModal } from "@/ui/useModal"
import { BASE_SLOTS } from "@choke/shared/expedition-points"

import { MARKET_UNLOCK_LEVEL } from "./constants"

import {
  requestTutorialCloseBook,
  TUTORIAL_EVENT,
  type TutorialEventDetail,
} from "./events"
import {
  formatScriptText,
  TUTORIAL_CHARACTER,
  TUTORIAL_SCRIPTS,
  TUTORIAL_STEP_ORDER,
} from "./scripts"
import {
  advanceTutorial,
  skipTutorial,
  startTutorial,
  useTutorialProgress,
} from "./store"
import type {
  TutorialContext,
  TutorialPlayableStep,
  TutorialScript,
  TutorialStep,
} from "./types"
import { TutorialPortrait } from "./TutorialPortrait"
import "./tutorial.css"

interface HoleRect {
  x: number
  y: number
  w: number
  h: number
}

interface Props {
  userId: string | null
  /** 开包动画等全屏流程期间先收起引导层 */
  suspended?: boolean
  /** 进入欢迎步骤时确认新手礼包 / 卡包库存 */
  onEnsureStarter?: () => void | Promise<void>
  onFinish?: (reason: "complete" | "skip") => void
}

function scriptOf(step: TutorialStep): TutorialScript | null {
  if (step === "idle" || step === "done") return null
  return TUTORIAL_SCRIPTS[step]
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/* ------------------------------------------------------------------
   打字机文本：自身只负责逐字显示，点击时由 ref 暴露 reveal()。
   以行号为 key 挂载，换行时状态自然重置，不需要在 effect 里 setState。
   ------------------------------------------------------------------ */
interface TypedTextHandle {
  reveal: () => void
  isTyping: () => boolean
}

const TypedText = forwardRef<TypedTextHandle, { text: string }>(
  function TypedText({ text }, ref) {
    const [reduced] = useState(
      () =>
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
    const [count, setCount] = useState(() => (reduced ? text.length : 0))
    const timer = useRef<number | null>(null)

    useEffect(() => {
      if (reduced || !text) return
      let index = 0
      timer.current = window.setInterval(() => {
        index += 1
        setCount(index)
        if (index % 3 === 0) playSfx("tick")
        if (index >= text.length) {
          if (timer.current) window.clearInterval(timer.current)
          timer.current = null
        }
      }, 24)
      return () => {
        if (timer.current) window.clearInterval(timer.current)
        timer.current = null
      }
    }, [text, reduced])

    const reveal = useCallback(() => {
      if (timer.current) {
        window.clearInterval(timer.current)
        timer.current = null
      }
      setCount(text.length)
    }, [text.length])

    useImperativeHandle(
      ref,
      () => ({
        reveal,
        isTyping: () => count < text.length,
      }),
      [reveal, count, text.length]
    )

    return (
      <p className="tut-dialog__text" key={text}>
        {text.slice(0, count)}
        {count < text.length && <span className="tut-dialog__caret" />}
      </p>
    )
  }
)

/* ------------------------------------------------------------------
   对话框：以教程步骤为 key 挂载，切换步骤时行号 / 跳过确认自动重置。
   ------------------------------------------------------------------ */
interface DialogueProps {
  script: TutorialScript
  stepNumber: number
  levelFlash: number | null
  targetMissing: boolean
  onComplete: () => void
  onFinish?: (reason: "complete" | "skip") => void
}

function TutorialDialogue({
  script,
  stepNumber,
  levelFlash,
  targetMissing,
  onComplete,
  onFinish,
}: DialogueProps) {
  const [lineIndex, setLineIndex] = useState(0)
  const [confirmingSkip, setConfirmingSkip] = useState(false)
  const typedRef = useRef<TypedTextHandle>(null)
  const config = useGameConfig()
  const line = script.lines[Math.min(lineIndex, script.lines.length - 1)]
  const lineText = formatScriptText(line.text, {
    packSize: config?.packSize ?? 5,
    deckSize: config?.deckSize ?? 7,
    lineupSize: BASE_SLOTS,
    marketUnlockLevel: MARKET_UNLOCK_LEVEL,
  })
  const waitingForTarget = script.advanceOn !== "continue" && targetMissing
  // 事件步骤不能靠“跳过这一步”伪造完成，只能完整跳过教程（经验由服务端按步骤发，最多到 Lv.3）
  const canSkipStep = waitingForTarget && script.advanceOn === "click"

  const advanceLine = useCallback(() => {
    if (typedRef.current?.isTyping()) {
      typedRef.current.reveal()
      return
    }
    if (lineIndex < script.lines.length - 1) {
      playSfx("tab")
      setLineIndex((index) => index + 1)
      return
    }
    if (script.advanceOn === "continue") {
      playSfx("tab")
      onComplete()
    }
  }, [script, lineIndex, onComplete])

  const confirmSkip = () => {
    playSfx("close")
    skipTutorial()
    requestTutorialCloseBook()
    setConfirmingSkip(false)
    onFinish?.("skip")
  }

  return (
    <div
      className="tut-dialog__box"
      onClick={advanceLine}
      onKeyDown={(event) => {
        // 确认框打开时 Esc 由 useModal 接管；这里只负责打开它
        if (event.key === "Escape" && !confirmingSkip) {
          event.stopPropagation()
          setConfirmingSkip(true)
          return
        }
        if (event.key !== "Enter" && event.key !== " ") return
        if (
          event.target instanceof Element &&
          event.target.closest("button, a, input, textarea, select")
        ) {
          return
        }
        event.preventDefault()
        advanceLine()
      }}
      role="document"
      tabIndex={0}
      aria-label="教程对话，按回车或空格继续"
    >
      <header className="tut-dialog__head">
        <span className="tut-dialog__speaker">{TUTORIAL_CHARACTER.name}</span>
        <span className="tut-dialog__step">
          {stepNumber} / {TUTORIAL_STEP_ORDER.length}
        </span>
        <button
          type="button"
          className="tut-dialog__skip"
          onClick={(event) => {
            event.stopPropagation()
            playSfx("open")
            setConfirmingSkip(true)
          }}
        >
          跳过教程
        </button>
      </header>

      <TypedText
        key={`${lineIndex}:${lineText}`}
        ref={typedRef}
        text={lineText}
      />

      <footer className="tut-dialog__foot">
        {levelFlash && (
          <span className="tut-levelup">LEVEL UP · Lv.{levelFlash}</span>
        )}
        {script.advanceOn === "continue" ? (
          <button
            type="button"
            className="tut-dialog__next"
            onClick={(event) => {
              event.stopPropagation()
              advanceLine()
            }}
          >
            {lineIndex < script.lines.length - 1
              ? "继续"
              : script.next === "done"
                ? "完成教程"
                : "继续"}
          </button>
        ) : canSkipStep ? (
          <>
            <span className="tut-dialog__hint is-warn">找不到目标…</span>
            <button
              type="button"
              className="tut-dialog__next"
              onClick={(event) => {
                event.stopPropagation()
                onComplete()
              }}
            >
              跳过这一步
            </button>
          </>
        ) : waitingForTarget ? (
          <span className="tut-dialog__hint is-warn">
            没找到目标，请打开对应界面；或使用“跳过教程”
          </span>
        ) : (
          <span className="tut-dialog__hint">
            {lineIndex < script.lines.length - 1
              ? "点击文字继续"
              : script.advanceOn === "click"
                ? "点一下高亮的地方"
                : "按提示操作"}
          </span>
        )}
      </footer>

      {confirmingSkip && (
        <SkipConfirm
          onConfirm={confirmSkip}
          onCancel={() => setConfirmingSkip(false)}
        />
      )}
    </div>
  )
}

/** 跳过确认：Esc 取消，焦点留在确认框里，关掉后回到「跳过教程」按钮 */
function SkipConfirm({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useModal(ref, { onClose: onCancel })
  return (
    <div
      ref={ref}
      className="tut-skip"
      role="alertdialog"
      aria-label="跳过新手教程"
      onClick={(event) => event.stopPropagation()}
    >
      <b>跳过新手教程？</b>
      <p>会直接完成教程、补到 Lv.3，并发放新手奖励。</p>
      <div className="tut-skip__actions">
        <button type="button" className="tut-skip__yes" onClick={onConfirm}>
          确定跳过
        </button>
        <button type="button" className="tut-skip__no" onClick={onCancel}>
          继续教程
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------
   引导层：定位目标、画遮罩 / 红箭头、挂对话框。
   ------------------------------------------------------------------ */
export function TutorialOverlay({
  userId,
  suspended = false,
  onEnsureStarter,
  onFinish,
}: Props) {
  const progress = useTutorialProgress(userId)
  const script = scriptOf(progress.tutorialStep)
  const visible = !!userId && !!script && !suspended

  const [hole, setHole] = useState<HoleRect | null>(null)
  const [targetMissing, setTargetMissing] = useState(false)
  const [levelFlash, setLevelFlash] = useState<number | null>(null)

  const advancing = useRef(false)
  const ensured = useRef(false)
  const lastLevel = useRef(progress.level)
  const stepRef = useRef(progress.tutorialStep)
  const fireTimer = useRef<number | null>(null)

  useEffect(() => {
    stepRef.current = progress.tutorialStep
    advancing.current = false
  }, [progress.tutorialStep])

  // 登录后如果还没有教程存档，稍等桌面发牌动画结束再开场
  useEffect(() => {
    if (!userId || progress.tutorialStep !== "idle") return
    const timer = window.setTimeout(() => startTutorial(), 650)
    return () => window.clearTimeout(timer)
  }, [userId, progress.tutorialStep])

  useEffect(() => {
    ensured.current = false
  }, [userId])

  // 欢迎步骤先确认新手卡包已经到账，避免玩家点开抽卡面板看到 0 包
  useEffect(() => {
    if (
      progress.tutorialStep !== "welcome" ||
      ensured.current ||
      !onEnsureStarter
    )
      return
    ensured.current = true
    void onEnsureStarter()
  }, [progress.tutorialStep, onEnsureStarter])

  // 等级提升时在对话框里闪一下
  useEffect(() => {
    if (progress.level > lastLevel.current) {
      playSfx("levelup")
      setLevelFlash(progress.level)
      lastLevel.current = progress.level
      const timer = window.setTimeout(() => setLevelFlash(null), 2200)
      return () => window.clearTimeout(timer)
    }
    lastLevel.current = progress.level
  }, [progress.level])

  const completeStep = useCallback(() => {
    if (!script || advancing.current) return
    // 延迟触发的点击不能把已经翻过去的步骤再推一次
    if (stepRef.current !== progress.tutorialStep) return
    const next = script.next
    if (!next) return
    advancing.current = true
    advanceTutorial(progress.tutorialStep)
    if (script.closeBookOnExit || next === "done") requestTutorialCloseBook()
    if (next === "done") onFinish?.("complete")
  }, [script, progress.tutorialStep, onFinish])

  // 业务事件推进：pack-opened / card-detail-opened / card-upgraded
  useEffect(() => {
    if (!script || script.advanceOn !== "event" || !script.event) return
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<TutorialEventDetail>).detail
      if (detail?.type !== script.event) return
      completeStep()
    }
    window.addEventListener(TUTORIAL_EVENT, onEvent)
    return () => window.removeEventListener(TUTORIAL_EVENT, onEvent)
  }, [script, completeStep])

  /** 支持函数 / 数组目标；跳过 disabled / 零尺寸元素 */
  const resolveTargetId = useCallback((): string | null => {
    if (!script?.target) return null
    const context: TutorialContext = {
      bookOpen: !!document.querySelector(".book"),
      level: progress.level,
      tutorialDone: progress.tutorialDone,
    }
    const value =
      typeof script.target === "function"
        ? script.target(context)
        : Array.isArray(script.target) || typeof script.target === "string"
          ? script.target
          : context.bookOpen
            ? script.target?.book
            : script.target?.desktop
    const candidates = Array.isArray(value) ? value : value ? [value] : []
    for (const id of candidates) {
      const element = document.querySelector<HTMLElement>(
        `[data-tutorial-id="${CSS.escape(id)}"]`
      )
      if (!element || !element.isConnected) continue
      if (element.matches(":disabled, [aria-disabled='true']")) continue
      if (
        element.closest(
          "[inert], [data-preload], .is-stowed, [aria-hidden='true']"
        )
      ) {
        continue
      }
      const style = window.getComputedStyle(element)
      if (style.visibility === "hidden" || style.display === "none") continue
      const rect = element.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      return id
    }
    return null
  }, [script, progress.level, progress.tutorialDone])

  // 点目标推进（桌面物件用 pointerdown 手动 onTap，键盘用 Enter / Space）
  useEffect(() => {
    if (!script || script.advanceOn !== "click") return
    const stepAtClick = progress.tutorialStep
    const fire = () => {
      if (fireTimer.current) window.clearTimeout(fireTimer.current)
      fireTimer.current = window.setTimeout(() => {
        fireTimer.current = null
        if (stepRef.current !== stepAtClick) return
        completeStep()
      }, 60)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const element =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-tutorial-id]")
          : null
      if (!element?.dataset.tutorialId) return
      if (element.dataset.tutorialId !== resolveTargetId()) return
      fire()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return
      const element =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-tutorial-id]")
          : null
      if (!element?.dataset.tutorialId) return
      if (element.dataset.tutorialId !== resolveTargetId()) return
      fire()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown, true)
      if (fireTimer.current) {
        window.clearTimeout(fireTimer.current)
        fireTimer.current = null
      }
    }
  }, [script, progress.tutorialStep, resolveTargetId, completeStep])

  // 持续量目标位置：适配窗口缩放、书本拖动、翻页、开包动画后的重新挂载
  useLayoutEffect(() => {
    if (!script?.target || suspended) {
      const frame = window.requestAnimationFrame(() => {
        setHole(null)
        setTargetMissing(false)
      })
      return () => window.cancelAnimationFrame(frame)
    }
    let frame = 0
    let last = 0
    let missingSince = 0
    const update = (now: number) => {
      frame = window.requestAnimationFrame(update)
      if (now - last < 120) return
      last = now
      const id = resolveTargetId()
      if (!id) {
        setHole((previous) => (previous === null ? previous : null))
        if (!missingSince) missingSince = now
        if (now - missingSince > 2400) setTargetMissing(true)
        return
      }
      missingSince = 0
      setTargetMissing(false)
      const element = document.querySelector<HTMLElement>(
        `[data-tutorial-id="${CSS.escape(id)}"]`
      )
      if (!element) return
      const rect = element.getBoundingClientRect()
      const next = { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
      setHole((previous) => {
        if (
          previous &&
          Math.abs(previous.x - next.x) < 0.5 &&
          Math.abs(previous.y - next.y) < 0.5 &&
          Math.abs(previous.w - next.w) < 0.5 &&
          Math.abs(previous.h - next.h) < 0.5
        ) {
          return previous
        }
        return next
      })
    }
    frame = window.requestAnimationFrame(update)
    return () => window.cancelAnimationFrame(frame)
  }, [script, suspended, resolveTargetId])

  if (!visible || !script) return null

  const vw = window.innerWidth
  const vh = window.innerHeight
  const PAD = 8
  const spotlight = hole
    ? {
        x: Math.max(0, hole.x - PAD),
        y: Math.max(0, hole.y - PAD),
        w: Math.min(vw, hole.x + hole.w + PAD) - Math.max(0, hole.x - PAD),
        h: Math.min(vh, hole.y + hole.h + PAD) - Math.max(0, hole.y - PAD),
      }
    : null
  const arrowAbove = spotlight ? spotlight.y > 130 : false
  const arrowX = spotlight
    ? clamp(spotlight.x + spotlight.w / 2, 42, vw - 42)
    : 0
  const arrowY = spotlight
    ? arrowAbove
      ? spotlight.y - 62
      : spotlight.y + spotlight.h + 16
    : 0
  const dialogSide =
    spotlight && spotlight.x + spotlight.w / 2 < vw * 0.46 ? "right" : "left"
  // 目标在屏幕下半部时对话框会压住目标：改到顶部，保证高亮区域完整可点
  const dialogTop =
    !!spotlight &&
    spotlight.h < vh * 0.46 &&
    spotlight.y + spotlight.h > vh - 190
  const stepNumber =
    TUTORIAL_STEP_ORDER.indexOf(progress.tutorialStep as TutorialPlayableStep) +
    1

  return createPortal(
    <div className="tut-layer">
      {spotlight ? (
        <>
          <div
            className="tut-shade"
            style={{ left: 0, top: 0, width: "100vw", height: spotlight.y }}
          />
          <div
            className="tut-shade"
            style={{
              left: 0,
              top: spotlight.y + spotlight.h,
              width: "100vw",
              height: Math.max(0, vh - spotlight.y - spotlight.h),
            }}
          />
          <div
            className="tut-shade"
            style={{
              left: 0,
              top: spotlight.y,
              width: spotlight.x,
              height: spotlight.h,
            }}
          />
          <div
            className="tut-shade"
            style={{
              left: spotlight.x + spotlight.w,
              top: spotlight.y,
              width: Math.max(0, vw - spotlight.x - spotlight.w),
              height: spotlight.h,
            }}
          />
          <div
            className="tut-ring"
            style={{
              left: spotlight.x,
              top: spotlight.y,
              width: spotlight.w,
              height: spotlight.h,
            }}
          />
          {/* 纯展示步骤把洞也挡住，避免玩家点进卡牌详情后遮罩层压在弹窗上 */}
          {script.advanceOn === "continue" && (
            <div
              className="tut-hole-block"
              style={{
                left: spotlight.x,
                top: spotlight.y,
                width: spotlight.w,
                height: spotlight.h,
              }}
            />
          )}
          <div
            className={`tut-arrow ${arrowAbove ? "is-down" : "is-up"}`}
            style={{ left: arrowX, top: arrowY }}
            aria-hidden
          >
            <i />
          </div>
        </>
      ) : (
        <div
          className={`tut-shade tut-shade--full ${
            script.advanceOn === "external" ? "tut-shade--pass" : ""
          }`}
        />
      )}

      <div
        className={`tut-dialog tut-dialog--${dialogSide} ${dialogTop ? "tut-dialog--top" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="新手教程"
      >
        <div className="tut-dialog__portrait">
          <TutorialPortrait />
        </div>
        <TutorialDialogue
          key={progress.tutorialStep}
          script={script}
          stepNumber={stepNumber}
          levelFlash={levelFlash}
          targetMissing={targetMissing}
          onComplete={completeStep}
          onFinish={onFinish}
        />
      </div>
    </div>,
    document.body
  )
}
