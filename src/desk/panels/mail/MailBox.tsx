import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import {
  GiCardRandom,
  GiCheckMark,
  GiCrystalShine,
  GiCutDiamond,
  GiEnvelope,
  GiLightningArc,
  GiOpenTreasureChest,
  GiPin,
  GiTwoCoins,
} from "react-icons/gi"

import { MAIL_RETENTION_DAYS, type MailAttachmentLine, type MailKind, type MailView } from "@choke/shared/mail"

import { playSfx } from "@/audio/sfx"
import { useModal } from "@/ui/useModal"
import { usePresence } from "@/ui/usePresence"

import {
  claimAllMails,
  claimMail,
  deleteMail,
  fetchMails,
  fetchMailSummary,
  pinMail,
  readMail,
  type MailBoxData,
  type MailSummary,
} from "@/desk/session/api"

import "@/desk/panel-ui.css"
import "@/desk/panels/mail/mail-box.css"

const SUMMARY_POLL_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000
const NO_MAILS: MailView[] = []
/** 和 mail-box.css 里弹层离场动画的时长一致 */
const EXIT_MS = 170

const ATTACHMENT_ICON = {
  coins: GiTwoCoins,
  essence: GiCutDiamond,
  stamina: GiLightningArc,
  item: GiCrystalShine,
  pack: GiOpenTreasureChest,
  card: GiCardRandom,
} as const

const KIND_LABEL: Readonly<Record<MailKind, string>> = {
  system: "系统",
  expedition: "出征",
  reward: "奖励",
}

type Notify = (text: string, kind?: "info" | "success" | "error") => void

interface MailBoxProps {
  userId: string
  /** 领到金币、卡包、卡牌后让桌面刷新钱包和库存 */
  onGranted: () => void
  notify: Notify
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function daysLeft(mail: MailView, now: number): number | null {
  if (!mail.expiresAt) return null
  return Math.max(0, Math.ceil((new Date(mail.expiresAt).getTime() - now) / DAY_MS))
}

const badgeOf = (summary: MailSummary) => Math.max(summary.unread, summary.claimable)

function AttachmentChip({ line }: { line: MailAttachmentLine }) {
  const Icon = ATTACHMENT_ICON[line.kind]
  return (
    <span className={`mail-chip ${line.foil ? "is-foil" : ""}`} title={line.label}>
      <Icon className="mail-chip__icon" aria-hidden />
      <span className="mail-chip__label">{line.foil ? `${line.label}（闪）` : line.label}</span>
      <span className="mail-chip__count">×{line.count.toLocaleString("en-US")}</span>
    </span>
  )
}

export function MailBox({ userId, onGranted, notify }: MailBoxProps) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<MailBoxData | null>(null)
  const [summary, setSummary] = useState<MailSummary>({ unread: 0, claimable: 0, pinned: 0 })
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const seq = useRef(0)
  const panelRef = useRef<HTMLElement>(null)
  const { mounted, leaving } = usePresence(open, EXIT_MS)

  const fail = useCallback(
    (reason: unknown) => {
      playSfx("error")
      notify(reason instanceof Error ? reason.message : "操作失败", "error")
    },
    [notify],
  )

  const load = useCallback(async () => {
    const mine = ++seq.current
    try {
      const next = await fetchMails(userId)
      if (mine !== seq.current) return
      setData(next)
      setSummary(next.summary)
      setNow(Date.now())
      setLoadError(null)
      setSelectedId((current) => (current !== null && next.mails.some((m) => m.id === current) ? current : null))
    } catch (reason) {
      if (mine !== seq.current) return
      setLoadError(reason instanceof Error ? reason.message : "邮件加载失败")
    }
  }, [userId])

  // 红点：打开前只拉统计，开着面板时用列表自带的统计
  useEffect(() => {
    if (open) return
    let cancelled = false
    /** 第一次拉到的数只是现状；之后变多了才算「来新邮件」，响一声铃 */
    let known: number | null = null
    const poll = () => {
      fetchMailSummary(userId)
        .then((next) => {
          if (cancelled) return
          const count = badgeOf(next)
          if (known !== null && count > known) playSfx("notify")
          known = count
          setSummary(next)
        })
        .catch(() => {})
    }
    poll()
    const timer = window.setInterval(poll, SUMMARY_POLL_MS)
    const onVisible = () => document.visibilityState === "visible" && poll()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [userId, open])

  const close = useCallback(() => {
    playSfx("close")
    setOpen(false)
  }, [])

  // Esc 关闭、Tab 留在弹层里、关掉后焦点还给邮箱按钮；Esc 被这里拦下，底下翻开的书不会跟着合上
  useModal(panelRef, { active: open, onClose: close })

  const openPanel = () => {
    playSfx("open")
    setOpen(true)
    void load()
  }

  const mails = data?.mails ?? NO_MAILS
  const selected = mails.find((m) => m.id === selectedId) ?? null

  const select = (mail: MailView) => {
    if (mail.id !== selectedId) playSfx("paper")
    setSelectedId(mail.id)
    if (mail.read) return
    setData((prev) =>
      prev ? { ...prev, mails: prev.mails.map((m) => (m.id === mail.id ? { ...m, read: true } : m)) } : prev,
    )
    setSummary((prev) => ({ ...prev, unread: Math.max(0, prev.unread - 1) }))
    readMail(userId, mail.id).catch(() => {})
  }

  const run = async (task: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await task()
    } catch (reason) {
      fail(reason)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const claimOne = (mail: MailView) =>
    run(async () => {
      await claimMail(userId, mail.id)
      playSfx("claim")
      notify("附件已领取", "success")
      onGranted()
      await load()
    })

  const claimAll = () =>
    run(async () => {
      const { claimed } = await claimAllMails(userId)
      playSfx(claimed > 0 ? "claim" : "deny")
      notify(claimed > 0 ? `已领取 ${claimed} 封邮件的附件` : "没有可领取的附件", claimed > 0 ? "success" : "info")
      if (claimed > 0) onGranted()
      await load()
    })

  const togglePin = (mail: MailView) =>
    run(async () => {
      await pinMail(userId, mail.id, !mail.pinned)
      playSfx(mail.pinned ? "unequip" : "stamp")
      await load()
    })

  const remove = (mail: MailView) =>
    run(async () => {
      await deleteMail(userId, mail.id)
      playSfx("tear")
      setSelectedId(null)
      await load()
    })

  const badge = badgeOf(summary)
  const pinLimit = data?.pinLimit ?? 20
  const selectedLeft = selected ? daysLeft(selected, now) : null

  return (
    <>
      {/* 开关的声音在 openPanel / close 里，按钮自己不出默认按键音 */}
      <button
        type="button"
        className="desk-button desk-mail-button"
        onClick={openPanel}
        aria-label={badge > 0 ? `邮箱，${summary.unread} 封未读，${summary.claimable} 封有附件` : "邮箱"}
        title="邮箱"
      >
        <GiEnvelope className="desk-mail-button__icon" aria-hidden /> 邮箱
        {badge > 0 && (
          // key 用数字：数量一变就重新挂载，红点鼓一下
          <span key={badge} className="desk-mail-button__badge">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>

      {mounted &&
        createPortal(
          <div
            className={`mail-backdrop ${leaving ? "is-leaving" : ""}`}
            onPointerDown={(event) => event.target === event.currentTarget && close()}
          >
            <section ref={panelRef} className="mail-panel" role="dialog" aria-modal="true" aria-label="邮箱">
              <header className="mail-panel__head">
                <div>
                  <span className="bk-label">MAILBOX</span>
                  <h2 className="mail-panel__title">邮箱</h2>
                </div>
                <p className="mail-panel__counts bk-note" aria-live="polite">
                  <span>
                    未读 <b>{summary.unread}</b>
                  </span>
                  <span>
                    待领 <b>{summary.claimable}</b>
                  </span>
                  <span>
                    置顶 <b>{summary.pinned}</b>/{pinLimit}
                  </span>
                </p>
                <div className="mail-panel__actions">
                  <button
                    type="button"
                    className="bk-btn bk-btn--main bk-btn--sm"
                    onClick={claimAll}
                    disabled={busy || summary.claimable === 0}
                    data-sfx="none"
                  >
                    一键领取{summary.claimable > 0 ? `（${summary.claimable}）` : ""}
                  </button>
                  <button type="button" className="bk-btn bk-btn--ghost bk-btn--sm" onClick={close} aria-label="关闭邮箱">
                    关闭
                  </button>
                </div>
              </header>

              <div className="mail-panel__body">
                <ul className="mail-list" aria-label="邮件列表">
                  {!data && !loadError && (
                    <li className="mail-empty bk-note" role="status">
                      <i className="mail-empty__spin" aria-hidden />
                      加载中
                    </li>
                  )}
                  {loadError && (
                    <li className="mail-empty bk-note">
                      {loadError}
                      <button type="button" className="bk-btn bk-btn--ghost bk-btn--sm" onClick={() => void load()}>
                        重试
                      </button>
                    </li>
                  )}
                  {data && mails.length === 0 && (
                    <li className="mail-empty bk-note">
                      <GiEnvelope className="mail-empty__icon" aria-hidden />
                      邮箱是空的
                    </li>
                  )}
                  {mails.map((mail, index) => {
                    const left = daysLeft(mail, now)
                    return (
                      <li key={mail.id} style={{ "--i": Math.min(index, 10) } as CSSProperties}>
                        <button
                          type="button"
                          className={`mail-row ${mail.id === selectedId ? "is-on" : ""} ${mail.read ? "" : "is-unread"}`}
                          aria-current={mail.id === selectedId || undefined}
                          onClick={() => select(mail)}
                          data-sfx="none"
                        >
                          <span className="mail-row__top">
                            {!mail.read && <i className="mail-row__dot" aria-label="未读" />}
                            {mail.pinned && <GiPin className="mail-row__pin" aria-label="已置顶" />}
                            <span className="mail-row__title">{mail.title}</span>
                            {mail.claimable && (
                              <GiOpenTreasureChest className="mail-row__gift" aria-label="有未领取的附件" />
                            )}
                          </span>
                          <span className="mail-row__meta">
                            <span>
                              <em>{KIND_LABEL[mail.kind]}</em>
                              {formatTime(mail.createdAt)}
                            </span>
                            {left !== null && <span className={left <= 3 ? "is-soon" : ""}>还剩 {left} 天</span>}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>

                {!selected ? (
                  <article className="mail-detail mail-detail--empty">
                    <GiEnvelope className="mail-empty__icon" aria-hidden />
                    <p className="bk-note">{mails.length > 0 ? "选一封邮件查看内容" : "有新邮件时会在这里显示"}</p>
                  </article>
                ) : (
                  // key 用邮件 id：换一封信，正文重新浮上来
                  <article key={selected.id} className="mail-detail">
                    <header className="mail-detail__head">
                      <span className="bk-tag">{KIND_LABEL[selected.kind]}</span>
                      <h3 className="mail-detail__title">{selected.title}</h3>
                    </header>
                    <p className="bk-note">
                      {formatTime(selected.createdAt)}
                      {selected.pinned
                        ? " · 已置顶，不会过期"
                        : ` · 还剩 ${selectedLeft ?? 0} 天过期${selected.claimable ? "，到期会自动领取附件" : ""}`}
                    </p>
                    {selected.body && <div className="mail-detail__text">{selected.body}</div>}
                    {selected.lines.length > 0 && (
                      <div className="mail-detail__attachments">
                        <span className="bk-label">附件</span>
                        <div className={`mail-chips ${selected.claimed ? "is-claimed" : ""}`}>
                          {selected.lines.map((line, index) => (
                            <AttachmentChip key={`${line.kind}-${line.label}-${index}`} line={line} />
                          ))}
                        </div>
                        {selected.claimed && (
                          <span className="mail-claimed">
                            <GiCheckMark aria-hidden /> 已领取
                          </span>
                        )}
                      </div>
                    )}
                    <div className="mail-detail__buttons">
                      {selected.claimable && (
                        <button
                          type="button"
                          className="bk-btn bk-btn--main"
                          onClick={() => claimOne(selected)}
                          disabled={busy}
                          data-sfx="none"
                        >
                          领取附件
                        </button>
                      )}
                      <button
                        type="button"
                        className="bk-btn"
                        onClick={() => togglePin(selected)}
                        disabled={busy}
                        title={`最多置顶 ${pinLimit} 封（当前 ${summary.pinned} 封）`}
                        data-sfx="none"
                      >
                        {selected.pinned ? "取消置顶" : "置顶"}
                      </button>
                      <button
                        type="button"
                        className="bk-btn bk-btn--ghost bk-btn--danger"
                        onClick={() => remove(selected)}
                        disabled={busy || selected.claimable || selected.pinned}
                        title={
                          selected.claimable
                            ? "先领取附件才能删除"
                            : selected.pinned
                              ? "先取消置顶才能删除"
                              : "删除这封邮件"
                        }
                        data-sfx="none"
                      >
                        删除
                      </button>
                    </div>
                  </article>
                )}
              </div>
              <footer className="mail-panel__foot bk-note">
                邮件保留 {MAIL_RETENTION_DAYS} 天，置顶的邮件不会过期（最多 {pinLimit} 封）。带附件的邮件到期时会自动领取。
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  )
}
