import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react"
import { createPortal, flushSync } from "react-dom"

import { RARITIES } from "@/card/types"
import { playSfx } from "@/audio/sfx"
import { useModal } from "@/ui/useModal"

import { onboard } from "@/desk/session/api"
import { cellScale, type DeskDrawerHandle } from "@/desk/shell/DeskDrawer"
import { GuestLoginButton } from "@/desk/login/GuestLoginButton"
import { EmailAuthForm } from "@/desk/login/EmailAuthForm"
import {
  ACHIEVEMENTS,
  INVITE_OPEN_EVENT,
  hasAchievement,
  markInviteOpened,
  readInviteOpened,
  readInvitePos,
  saveInvitePos,
  unlockAchievement,
} from "@/desk/lib/invite"
import { useCardStats, useGameConfig } from "@/desk/session/useGameConfig"
import "@/desk/panels/invite/invite-letter.css"

const ENV_W = 184
const ENV_H = 120
/** 默认落点：抽卡展架和发牌按钮之间，靠近桌面底边 */
const DEFAULT_POS = { x: 0.3, y: 0.8 }
/** 松手时信封露在桌面里的面积不到这个比例，就算扔出去了 */
const KEEP_VISIBLE = 0.6
/** 第一次弹出等桌上物件发完牌再上来 */
const FIRST_RISE_DELAY = 550

export interface InviteUser {
  username: string
  onboarded: boolean
}

interface Props {
  user: InviteUser | null
  /** /auth/me 已经回来（不管登没登录） */
  ready: boolean
  stageSize: { w: number; h: number }
  stageRef: RefObject<HTMLDivElement | null>
  onToast: (text: string) => void
  /** 新手礼包领到了：刷新用户和背包 */
  onClaimed: () => void
  onOpenBackpack: () => void
  /** 信收在桌沿的抽屉里（桌面持有，重置桌面会放回桌上） */
  stowed: boolean
  onStow: (stowed: boolean) => void
  drawer: RefObject<DeskDrawerHandle | null>
  /** 抽屉里给信留的位置，收着时信封经 portal 画进去 */
  drawerSlot: HTMLElement | null
  /** 教程毕业后即使新手礼包已领，也把邀请函留在桌上（日常任务入口） */
  forceVisible?: boolean
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

/** 信封本身：拆过就露出半截信纸、没有火漆 */
function EnvelopeBody({ opened }: { opened: boolean }) {
  return (
    <div className="invite-env__body">
      <i className="invite-env__back" />
      {opened && (
        <i className="invite-env__letter">
          <b>INVITATION</b>
        </i>
      )}
      <i className="invite-env__pocket" />
      <i className="invite-env__flap" />
      {!opened && <i className="invite-env__seal" />}
      <span className="invite-env__label">
        邀请函<em>INVITATION</em>
      </span>
    </div>
  )
}

/**
 * 桌上的邀请函。没登录或没领新手礼包时从桌面底边弹上来；拆过一次之后一直留在桌上（开封的样子）。
 * 按住能拖，扔出桌面会重新从底边弹回来；登录用户第一次这么干会解锁一个本地成就，信的内容也跟着变。
 * 拖到桌沿的抽屉上就收进去，收着时不再自动弹出；在抽屉里点它照样拆开读，拖出来落在松手的地方。
 */
export function InviteLetter({
  user,
  ready,
  stageSize,
  stageRef,
  onToast,
  onClaimed,
  onOpenBackpack,
  stowed,
  onStow,
  drawer,
  drawerSlot,
  forceVisible = false,
}: Props) {
  const [opened, setOpened] = useState(readInviteOpened)
  const [tossed, setTossed] = useState(() => hasAchievement("invite-toss"))
  const [pos, setPos] = useState(() => readInvitePos() ?? DEFAULT_POS)
  /** 每弹一次 +1，换 key 让上升动画重播 */
  const [pops, setPops] = useState(0)
  /** 从抽屉里拿出来的信直接摆在桌上，不再播从底边升上来的动画 */
  const [rise, setRise] = useState(true)
  const [summoned, setSummoned] = useState(false)
  const [reading, setReading] = useState<{ sealed: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [escaping, setEscaping] = useState(false)
  const envRef = useRef<HTMLDivElement>(null)

  const openLetter = useCallback(() => {
    playSfx("paper")
    setReading({ sealed: !opened })
    if (!opened) {
      markInviteOpened()
      setOpened(true)
    }
  }, [opened])

  useEffect(() => {
    const onSummon = () => {
      setSummoned(true)
      setRise(true)
      setPos(DEFAULT_POS)
      saveInvitePos(null)
      setPops((value) => value + 1)
      // 收在抽屉里：取出来弹上桌面，顺手拆开
      if (stowed) {
        onStow(false)
        openLetter()
      }
    }
    window.addEventListener(INVITE_OPEN_EVENT, onSummon)
    return () => window.removeEventListener(INVITE_OPEN_EVENT, onSummon)
  }, [stowed, onStow, openLetter])

  const needed = ready && (!user || !user.onboarded)
  if (!stowed && (!ready || !(needed || opened || summoned || forceVisible)))
    return null

  const left = clamp(pos.x * stageSize.w, 8, stageSize.w - ENV_W - 8)
  const top = clamp(pos.y * stageSize.h, 8, stageSize.h - ENV_H - 22)
  const rising = rise && (needed || pops > 0 || forceVisible)

  // 开封翻盖向上伸出本体高度的 62%；留出旋转边距后，按完整外形缩进抽屉格子。
  const drawerFlap = opened ? ENV_H * 0.62 : 0
  const drawerWidth = ENV_W + 16
  const drawerHeight = ENV_H + drawerFlap + 16

  const toss = () => {
    playSfx("paper")
    setPos(DEFAULT_POS)
    saveInvitePos(null)
    setRise(true)
    if (user) {
      if (unlockAchievement("invite-toss")) {
        playSfx("success")
        onToast(`成就解锁：${ACHIEVEMENTS["invite-toss"]}`)
      }
      setTossed(true)
    }
    setPops((value) => value + 1)
  }

  /** 拿着信封拖：拖到抽屉上就收进去（先于"扔出桌面"判定），扔出桌面就从底边弹回来，否则落在松手处 */
  const dragEnvelope = (
    el: HTMLDivElement,
    pointerId: number,
    startX: number,
    startY: number,
    base: { left: number; top: number },
    lifted: boolean
  ) => {
    const stage = stageRef.current
    if (!stage) return
    let moved = lifted
    let out = false
    let overDrawer = false
    let drawerTimer = 0
    let dx = 0
    let dy = 0

    const insideFraction = () => {
      const box = el.getBoundingClientRect()
      const area = stage.getBoundingClientRect()
      const w = Math.max(
        0,
        Math.min(box.right, area.right) - Math.max(box.left, area.left)
      )
      const h = Math.max(
        0,
        Math.min(box.bottom, area.bottom) - Math.max(box.top, area.top)
      )
      return (w * h) / Math.max(1, box.width * box.height)
    }
    const hintDrawer = (next: boolean) => {
      if (next === overDrawer) return
      overDrawer = next
      drawer.current?.hint(next)
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      dx = ev.clientX - startX
      dy = ev.clientY - startY
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return
      if (!moved) {
        moved = true
        setDragging(true)
      }
      el.style.transform = `translate(${dx}px, ${dy}px)`
      // 信封自己压在指针下面，跳过它看底下是不是抽屉；停在合着的抽屉面上一会儿，抽屉自己拉开
      const under = document
        .elementsFromPoint(ev.clientX, ev.clientY)
        .find((node) => !el.contains(node))
      hintDrawer(!!under?.closest(".desk-drawer"))
      if (under?.closest(".desk-drawer__front") && !drawer.current?.isOpen()) {
        if (!drawerTimer)
          drawerTimer = window.setTimeout(() => drawer.current?.open(), 450)
      } else if (drawerTimer) {
        window.clearTimeout(drawerTimer)
        drawerTimer = 0
      }
      const nextOut = !overDrawer && insideFraction() < KEEP_VISIBLE
      if (nextOut !== out) {
        out = nextOut
        setEscaping(out)
      }
    }

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      el.removeEventListener("pointermove", onMove)
      el.removeEventListener("pointerup", onUp)
      el.removeEventListener("pointercancel", onUp)
      if (drawerTimer) window.clearTimeout(drawerTimer)
      const intoDrawer = overDrawer
      hintDrawer(false)
      setDragging(false)
      setEscaping(false)
      if (!moved) {
        if (ev.type === "pointerup") openLetter()
        return
      }
      if (intoDrawer && ev.type === "pointerup") {
        el.style.transform = ""
        onStow(true)
        drawer.current?.bump()
        playSfx("thud")
        onToast("邀请函收进了抽屉")
        return
      }
      if (out && ev.type === "pointerup") {
        toss()
        return
      }
      const area = stage.getBoundingClientRect()
      const next = {
        x: clamp(base.left + dx, 8, area.width - ENV_W - 8) / area.width,
        y: clamp(base.top + dy, 8, area.height - ENV_H - 22) / area.height,
      }
      // 先让新位置落到 DOM 上再撤掉拖动位移，免得闪回原位一帧
      flushSync(() => setPos(next))
      el.style.transform = ""
      saveInvitePos(next)
      playSfx("paper")
    }

    el.addEventListener("pointermove", onMove)
    el.addEventListener("pointerup", onUp)
    el.addEventListener("pointercancel", onUp)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragEnvelope(
      event.currentTarget,
      event.pointerId,
      event.clientX,
      event.clientY,
      { left, top },
      false
    )
  }

  /** 从抽屉里拿出来：信封换成原尺寸出现在指针下面，接着由桌上的拖动接手 */
  const takeOut = (pointerId: number, x: number, y: number) => {
    const stage = stageRef.current
    if (!stage) return
    const area = stage.getBoundingClientRect()
    const base = {
      left: clamp(x - area.left - ENV_W / 2, 8, area.width - ENV_W - 8),
      top: clamp(y - area.top - ENV_H / 2, 8, area.height - ENV_H - 22),
    }
    flushSync(() => {
      setPos({ x: base.left / area.width, y: base.top / area.height })
      setRise(false)
      setSummoned(true)
      setDragging(true)
      onStow(false)
    })
    const el = envRef.current
    if (!el) return
    el.setPointerCapture(pointerId)
    dragEnvelope(el, pointerId, x, y, base, true)
  }

  // 抽屉里的那一格：没拖动就是点开读信，拖过阈值就拿出来
  const onCellDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const stop = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 4)
        return
      stop()
      takeOut(pointerId, ev.clientX, ev.clientY)
    }
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      stop()
      if (ev.type === "pointerup") openLetter()
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  const style = {
    left,
    top,
    width: ENV_W,
    height: ENV_H,
    "--rise": `${stageSize.h - top + 30}px`,
    "--rise-delay": pops === 0 ? `${FIRST_RISE_DELAY}ms` : "0ms",
  } as CSSProperties

  const classes = [
    "invite-env",
    opened && "is-open",
    rising && "is-rising",
    dragging && "is-dragging",
    escaping && "is-escaping",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <>
      {!stowed && (
        <div
          ref={envRef}
          key={pops}
          className={classes}
          style={style}
          role="button"
          tabIndex={0}
          aria-label={
            opened ? "邀请函（已拆开），点开再读一遍" : "邀请函，点开拆封"
          }
          onPointerDown={onPointerDown}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            openLetter()
          }}
        >
          <EnvelopeBody opened={opened} />
        </div>
      )}

      {stowed &&
        drawerSlot &&
        createPortal(
          <div
            className="desk-drawer__cell"
            data-stowed="invite"
            role="button"
            tabIndex={0}
            aria-label={
              opened
                ? "邀请函（已拆开）：点开再读一遍，拖回桌面"
                : "邀请函：点开拆封，拖回桌面"
            }
            onPointerDown={onCellDown}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              openLetter()
            }}
          >
            <div
              className="desk-drawer__thing"
              style={
                {
                  width: drawerWidth,
                  height: drawerHeight,
                  "--s": cellScale(drawerWidth, drawerHeight),
                } as CSSProperties
              }
            >
              <div
                className={`invite-env ${opened ? "is-open" : ""}`}
                style={{
                  left: 8,
                  top: drawerFlap + 8,
                  width: ENV_W,
                  height: ENV_H,
                }}
              >
                <EnvelopeBody opened={opened} />
              </div>
            </div>
            <span className="desk-drawer__tag">邀请函</span>
          </div>,
          drawerSlot
        )}

      {reading && (
        <LetterModal
          sealed={reading.sealed}
          user={user}
          tossed={tossed}
          onClose={() => setReading(null)}
          onClaimed={onClaimed}
          onOpenBackpack={() => {
            setReading(null)
            onOpenBackpack()
          }}
        />
      )}
    </>
  )
}

interface ModalProps {
  sealed: boolean
  user: InviteUser | null
  tossed: boolean
  onClose: () => void
  onClaimed: () => void
  onOpenBackpack: () => void
}

/** 拆信：翻盖掀开、信纸抽出来、信封落下去，信纸放大到眼前 */
function LetterModal({
  sealed,
  user,
  tossed,
  onClose,
  onClaimed,
  onOpenBackpack,
}: ModalProps) {
  const [claiming, setClaiming] = useState(false)
  const [granted, setGranted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jumping, setJumping] = useState(false)
  /** 未登录时信纸上的两页：邀请词 / 登录注册 */
  const [view, setView] = useState<"intro" | "auth">("intro")
  const signInRef = useRef<HTMLButtonElement>(null)
  const osuRef = useRef<HTMLAnchorElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const config = useGameConfig()
  const stats = useCardStats()

  // Esc 关闭、焦点移进信里、关闭后还给触发者；useModal 会拦下 Esc，底下翻开的书不会跟着合上
  useModal(modalRef, { onClose })

  // 从 bfcache 返回时页面状态是旧的：把「前往中」复位
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setJumping(false)
    }
    window.addEventListener("pageshow", reset)
    return () => window.removeEventListener("pageshow", reset)
  }, [])

  // 信纸原地换页：触发切换的按钮会被卸掉，焦点交给新页的第一个控件
  const firstView = useRef(true)
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false
      return
    }
    if (view === "auth") osuRef.current?.focus()
    else signInRef.current?.focus()
  }, [view])

  async function claim() {
    if (claiming) return
    setClaiming(true)
    setError(null)
    try {
      await onboard()
      playSfx("success")
      setGranted(true)
      onClaimed()
    } catch (reason) {
      playSfx("error")
      setError(
        reason instanceof Error ? reason.message : "领取失败，请稍后再试"
      )
    } finally {
      setClaiming(false)
    }
  }

  const back = (
    <button type="button" className="invite-paper__btn" onClick={onClose}>
      返回桌面
    </button>
  )
  const claimButton = (
    <button
      type="button"
      className="invite-paper__btn"
      onClick={() => void claim()}
      disabled={claiming}
    >
      {claiming ? "领取中…" : "领取新手礼包"}
    </button>
  )

  const packKinds = config?.packs.length ?? null
  const cardsLabel = stats
    ? stats.total >= 10000
      ? `${Math.floor(stats.total / 10000)} 万+`
      : String(stats.total)
    : "—"

  let body
  if (granted) {
    body = (
      <>
        <span className="invite-paper__eyebrow">新手礼包 · 已发放</span>
        <h2>礼包已经放进背包了</h2>
        <ul className="invite-paper__gifts">
          <li>
            <b>×30</b>
            <span>普通卡包</span>
          </li>
          <li>
            <b>×1</b>
            <span>神秘卡包</span>
            <em>内有你的本体卡</em>
          </li>
        </ul>
        <p>
          本体卡不会随登录直接发放：去背包拆开神秘卡包，它就是你的了。普通卡包用桌上的发牌按钮发到桌面，点开就能拆。
        </p>
        <div className="invite-paper__actions">
          <button
            type="button"
            className="invite-paper__btn"
            onClick={onOpenBackpack}
          >
            去背包开神秘卡包
          </button>
          <button
            type="button"
            className="invite-paper__btn invite-paper__btn--ghost"
            onClick={onClose}
          >
            返回桌面
          </button>
        </div>
      </>
    )
  } else if (user && tossed) {
    body = (
      <>
        <span className="invite-paper__eyebrow">又见面了 · 第二封</span>
        <h2>{user.username}，它又回来了</h2>
        <p>
          你刚才把这封邀请函扔出了桌子。它在地上滚了两圈，又从桌子底下爬了回来——看得出来，它是真心想请你入座。
        </p>
        <p className="invite-paper__stamp">
          成就「{ACHIEVEMENTS["invite-toss"]}」已记在这台设备上
        </p>
        {!user.onboarded && (
          <p>对了，新手礼包还没领：30 个普通卡包 + 1 个神秘卡包。</p>
        )}
        <div className="invite-paper__actions">
          {user.onboarded ? back : claimButton}
        </div>
      </>
    )
  } else if (!user && view === "auth") {
    body = (
      <>
        <span className="invite-paper__eyebrow">入座登记</span>
        <h2>登录 / 注册</h2>
        <a
          ref={osuRef}
          className="invite-paper__btn invite-paper__btn--wide"
          href="/auth/osu"
          aria-disabled={jumping || undefined}
          aria-busy={jumping || undefined}
          onClick={(event) => {
            if (jumping) {
              event.preventDefault()
              return
            }
            setJumping(true)
          }}
        >
          {jumping ? "正在前往 osu!…" : "用 osu! 登录"}
        </a>
        <p className="invite-paper__hint invite-paper__center">
          首次登录会自动建号，并拿到你自己的本体卡。
        </p>
        <div className="login-divider" role="separator">
          <span>或者用邮箱</span>
        </div>
        <EmailAuthForm />
        <button
          type="button"
          className="invite-paper__back"
          onClick={() => setView("intro")}
        >
          <span aria-hidden>‹</span> 返回邀请函
        </button>
      </>
    )
  } else if (!user) {
    body = (
      <>
        <span className="invite-paper__eyebrow">致每一位 osu! 玩家</span>
        <h2>诚邀你入座 Choke!</h2>
        <p>这里把 osu! 玩家做成一张张卡：开包、收藏、组好卡组上桌对战。</p>
        <p>
          用 osu!
          账号登录后，我们会读取你的公开排名与游玩数据，做出属于你的本体卡，再送你一份新手礼包。
        </p>
        <ul className="invite-paper__facts">
          <li>
            <b>{cardsLabel}</b>
            <span>玩家卡池</span>
          </li>
          <li>
            <b>{RARITIES.length}</b>
            <span>品质档位</span>
          </li>
          <li>
            <b>{packKinds ?? "—"}</b>
            <span>卡包种类</span>
          </li>
        </ul>
        <div className="invite-paper__actions">
          <button
            ref={signInRef}
            type="button"
            className="invite-paper__btn"
            onClick={() => setView("auth")}
          >
            登录 / 注册
          </button>
          <GuestLoginButton
            className="invite-paper__btn invite-paper__btn--ghost"
            label="先以游客身份入座"
          />
        </div>
      </>
    )
  } else if (!user.onboarded) {
    body = (
      <>
        <span className="invite-paper__eyebrow">欢迎入座</span>
        <h2>{user.username}，你的座位准备好了</h2>
        <ol className="invite-paper__steps">
          <li>
            你的 osu! 账号就是你的本体卡，它封在新手礼包的「神秘卡包」里。
          </li>
          <li>
            点桌上的发牌按钮把卡包发到桌面，点卡包拆开；抽到的卡进卡册，图鉴能看全卡池。
          </li>
          <li>在卡组卡套槽里排好卡，就能去对战垫上打一场。</li>
        </ol>
        <p className="invite-paper__hint">
          新手礼包：
          {config
            ? config.starterPacks
                .map((pack) => `${pack.count} 个${pack.name}`)
                .join(" + ")
            : "登录后领取"}
          。
        </p>
        <div className="invite-paper__actions">{claimButton}</div>
      </>
    )
  } else {
    body = (
      <>
        <span className="invite-paper__eyebrow">邀请函 · 已入座</span>
        <h2>{user.username}，欢迎回来</h2>
        <p>
          新手礼包已经领过了。卡包都在背包里，桌上的发牌按钮会把它们一个个发出来。
        </p>
        <p>这封信就留在桌上做个纪念吧。</p>
        <div className="invite-paper__actions">{back}</div>
      </>
    )
  }

  return (
    <div
      ref={modalRef}
      className="invite-modal"
      role="dialog"
      aria-modal="true"
      aria-label="邀请函"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={`invite-open ${sealed ? "is-sealed" : ""}`}>
        <div className="invite-open__env" aria-hidden>
          <i className="invite-open__back" />
          <i className="invite-open__peek" />
          <i className="invite-open__pocket" />
          <i className="invite-open__flap" />
          <i className="invite-open__seal" />
        </div>
        <article className="invite-paper">
          <i className="invite-paper__tape" aria-hidden />
          <button
            type="button"
            className="invite-paper__close"
            onClick={onClose}
            aria-label="合上邀请函"
          >
            ×
          </button>
          {body}
          {error && (
            <p className="invite-paper__error" role="alert">
              {error}
            </p>
          )}
          <footer className="invite-paper__sign">
            <span>—— Choke! 发牌员</span>
            <small>Choke! · 非盈利同人项目 · 与 osu! 官方无关</small>
          </footer>
        </article>
      </div>
    </div>
  )
}
