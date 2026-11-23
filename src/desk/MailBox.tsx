import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  GiCardRandom,
  GiCrystalShine,
  GiCutDiamond,
  GiLightningArc,
  GiOpenTreasureChest,
  GiTwoCoins,
} from "react-icons/gi"

import type { MailAttachmentLine, MailView } from "@choke/shared/mail"

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
} from "./api"

import "./book.css"
import "./mail-box.css"

const SUMMARY_POLL_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000
const NO_MAILS: MailView[] = []

const ATTACHMENT_ICON = {
  coins: GiTwoCoins,
  essence: GiCutDiamond,
  stamina: GiLightningArc,
  item: GiCrystalShine,
  pack: GiOpenTreasureChest,
  card: GiCardRandom,
} as const

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

function AttachmentChip({ line }: { line: MailAttachmentLine }) {
  const Icon = ATTACHMENT_ICON[line.kind]
  return (
    <span className={`mail-chip ${line.foil ? "is-foil" : ""}`} title={line.label}>
      <Icon className="mail-chip__icon" aria-hidden />
      <span className="mail-chip__label">{line.foil ? `${line.label}（闪）` : line.label}</span>
      <span className="mail-chip__count">×{line.count}</span>
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

  const fail = useCallback(
    (reason: unknown) => notify(reason instanceof Error ? reason.message : "操作失败", "error"),
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
    const poll = () => {
      fetchMailSummary(userId)
        .then((next) => !cancelled && setSummary(next))
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

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const openPanel = () => {
    setOpen(true)
    void load()
  }

  const mails = data?.mails ?? NO_MAILS
  const selected = mails.find((m) => m.id === selectedId) ?? null

  const select = (mail: MailView) => {
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
      notify("附件已领取", "success")
      onGranted()
      await load()
    })

  const claimAll = () =>
    run(async () => {
      const { claimed } = await claimAllMails(userId)
      notify(claimed > 0 ? `已领取 ${claimed} 封邮件的附件` : "没有可领取的附件", claimed > 0 ? "success" : "info")
      if (claimed > 0) onGranted()
      await load()
    })

  const togglePin = (mail: MailView) =>
    run(async () => {
      await pinMail(userId, mail.id, !mail.pinned)
      await load()
    })

  const remove = (mail: MailView) =>
    run(async () => {
      await deleteMail(userId, mail.id)
      setSelectedId(null)
      await load()
    })

  const badge = summary.unread + summary.claimable > 0 ? Math.max(summary.unread, summary.claimable) : 0

  return (
    <>
      <button
        type="button"
        className="desk-button desk-mail-button"
        onClick={openPanel}
        aria-label={badge > 0 ? `邮箱，${summary.unread} 封未读，${summary.claimable} 封有附件` : "邮箱"}
        title="邮箱"
      >
        <span aria-hidden>✉</span> 邮箱
        {badge > 0 && <span className="desk-mail-button__badge">{badge > 99 ? "99+" : badge}</span>}
      </button>

      {open &&
        createPortal(
          <div
            className="mail-backdrop"
            onPointerDown={(event) => event.target === event.currentTarget && setOpen(false)}
          >
            <section className="mail-panel" role="dialog" aria-modal="true" aria-label="邮箱">
              <header className="mail-panel__head">
                <div>
                  <span className="bk-label">MAILBOX</span>
                  <h2 className="mail-panel__title">邮箱</h2>
                </div>
                <div className="mail-panel__actions">
                  <button
                    type="button"
                    className="bk-btn bk-btn--main bk-btn--sm"
                    onClick={claimAll}
                    disabled={busy || summary.claimable === 0}
                  >
                    一键领取{summary.claimable > 0 ? `（${summary.claimable}）` : ""}
                  </button>
                  <button
                    type="button"
                    className="bk-btn bk-btn--ghost bk-btn--sm"
                    onClick={() => setOpen(false)}
                    aria-label="关闭邮箱"
                  >
                    关闭
                  </button>
                </div>
              </header>

              <div className="mail-panel__body">
                <ul className="mail-list" aria-label="邮件列表">
                  {!data && !loadError && <li className="mail-empty bk-note">加载中…</li>}
                  {loadError && (
                    <li className="mail-empty bk-note">
                      {loadError}{" "}
                      <button type="button" className="bk-btn bk-btn--ghost bk-btn--sm" onClick={() => void load()}>
                        重试
                      </button>
                    </li>
                  )}
                  {data && mails.length === 0 && <li className="mail-empty bk-note">邮箱是空的。</li>}
                  {mails.map((mail) => {
                    const left = daysLeft(mail, now)
                    return (
                      <li key={mail.id}>
                        <button
                          type="button"
                          className={`mail-row ${mail.id === selectedId ? "is-on" : ""} ${mail.read ? "" : "is-unread"}`}
                          onClick={() => select(mail)}
                        >
                          <span className="mail-row__top">
                            {mail.pinned && (
                              <span className="mail-row__pin" title="已置顶">
                                📌
                              </span>
                            )}
                            <span className="mail-row__title">{mail.title}</span>
                            {mail.claimable && (
                              <GiOpenTreasureChest className="mail-row__gift" aria-label="有未领取的附件" />
                            )}
                          </span>
                          <span className="mail-row__meta">
                            <span>{formatTime(mail.createdAt)}</span>
                            {left !== null && <span className={left <= 3 ? "is-soon" : ""}>还剩 {left} 天</span>}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>

                <article className="mail-detail">
                  {!selected ? (
                    <p className="bk-note mail-detail__empty">选一封邮件查看内容。</p>
                  ) : (
                    <>
                      <h3 className="mail-detail__title">{selected.title}</h3>
                      <p className="bk-note">
                        {formatTime(selected.createdAt)}
                        {selected.pinned
                          ? " · 已置顶，不会过期"
                          : ` · 还剩 ${daysLeft(selected, now)} 天过期${selected.claimable ? "，到期会自动领取附件" : ""}`}
                      </p>
                      {selected.body && <div className="mail-detail__text">{selected.body}</div>}
                      {selected.lines.length > 0 && (
                        <div className="mail-detail__attachments">
                          <span className="bk-label">附件{selected.claimed ? "（已领取）" : ""}</span>
                          <div className={`mail-chips ${selected.claimed ? "is-claimed" : ""}`}>
                            {selected.lines.map((line, index) => (
                              <AttachmentChip key={`${line.kind}-${line.label}-${index}`} line={line} />
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="mail-detail__buttons">
                        {selected.claimable && (
                          <button
                            type="button"
                            className="bk-btn bk-btn--main"
                            onClick={() => claimOne(selected)}
                            disabled={busy}
                          >
                            领取附件
                          </button>
                        )}
                        <button
                          type="button"
                          className="bk-btn"
                          onClick={() => togglePin(selected)}
                          disabled={busy}
                          title={`最多置顶 ${data?.pinLimit ?? 20} 封（当前 ${summary.pinned} 封）`}
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
                        >
                          删除
                        </button>
                      </div>
                    </>
                  )}
                </article>
              </div>
              <footer className="mail-panel__foot bk-note">
                邮件保留 30 天，置顶的邮件不会过期（最多 {data?.pinLimit ?? 20} 封）。带附件的邮件到期时会自动领取。
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  )
}
