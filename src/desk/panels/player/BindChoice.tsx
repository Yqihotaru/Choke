import { useState } from "react"

import { playSfx } from "@/audio/sfx"
import { RARITY_LABEL } from "@/card/data"
import {
  ApiError,
  cancelBind,
  resolveBind,
  type AccountKind,
  type BindAccountSummary,
  type PendingBind,
} from "@/desk/session/api"
import { Pages } from "@/desk/shell/BookPages"
import { ConfirmBar } from "@/desk/shell/ConfirmBar"
import "@/desk/panels/player/account-panel.css"

type Choice = "keep-current" | "keep-osu"

const KIND_LABEL: Record<AccountKind, string> = {
  guest: "游客账号",
  email: "邮箱账号",
  osu: "osu! 账号",
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("zh-CN")

function SummaryBox({ tag, account }: { tag: string; account: BindAccountSummary }) {
  const rarity = account.bestRarity
    ? ((RARITY_LABEL as Record<string, string>)[account.bestRarity] ?? account.bestRarity)
    : "无"
  return (
    <div className="bk-box bind-summary">
      <span className="bk-label">{tag}</span>
      <b className="bind-summary__name">{account.username}</b>
      <span className="bind-summary__kind">{KIND_LABEL[account.kind]}</span>
      <div className="bk-list">
        <div className="bk-row account-row">
          <span>玩家等级</span>
          <b>
            Lv.{account.level}
            {account.tutorialDone ? "" : "（引导未完成）"}
          </b>
        </div>
        <div className="bk-row account-row">
          <span>卡牌数量</span>
          <b>{account.cardCount.toLocaleString("en-US")} 张</b>
        </div>
        <div className="bk-row account-row">
          <span>最高品质</span>
          <b>{rarity}</b>
        </div>
        <div className="bk-row account-row">
          <span>金币</span>
          <b>{account.coins.toLocaleString("en-US")}</b>
        </div>
        <div className="bk-row account-row">
          <span>最后登录</span>
          <b>{formatDate(account.lastSeenAt)}</b>
        </div>
        <div className="bk-row account-row">
          <span>创建时间</span>
          <b>{formatDate(account.createdAt)}</b>
        </div>
      </div>
    </div>
  )
}

/**
 * 绑定的 osu! 号已经有进度：左页是现在登录的账号，右页是那个 osu! 号，二选一。
 * 不合并；落选的一边封存，登不上，所以每个选择都要二次确认。
 */
export function BindChoice({
  pending,
  onResolved,
  onClosed,
}: {
  pending: PendingBind
  /** 选定并执行成功；登录态已经换成留下来的账号 */
  onResolved: (kept: Choice) => void
  /** 取消了，或者待确认已经失效（过期 / 两边账号变了） */
  onClosed: (message?: string) => void
}) {
  const [confirming, setConfirming] = useState<Choice | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { current, osu } = pending

  const run = async (choice: Choice) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await resolveBind(choice)
      playSfx("success")
      onResolved(choice)
    } catch (reason) {
      playSfx("error")
      const message = reason instanceof Error ? reason.message : "操作失败"
      if (reason instanceof ApiError && (reason.code === "no_pending_bind" || reason.code === "bind_stale")) {
        onClosed(message)
        return
      }
      setConfirming(null)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (busy) return
    setBusy(true)
    try {
      await cancelBind()
    } catch {
      // 取消失败也无所谓：待确认 10 分钟后自己过期
    }
    setBusy(false)
    onClosed()
  }

  const side = (choice: Choice, keep: BindAccountSummary, drop: BindAccountSummary) => {
    const dropText =
      choice === "keep-current"
        ? `保留当前账号「${keep.username}」，并把 osu! 账号「${pending.osuUsername}」挂过来。原来的 osu! 账号「${drop.username}」（Lv.${drop.level}，${drop.cardCount} 张卡）会被封存，之后无法找回，进度不会合并。`
        : `保留 osu! 账号「${keep.username}」。当前账号「${drop.username}」（Lv.${drop.level}，${drop.cardCount} 张卡）会被封存，之后无法找回，进度不会合并。`
    return confirming === choice ? (
      <ConfirmBar
        danger
        busy={busy}
        confirmLabel="确认，另一边不要了"
        message={dropText}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void run(choice)}
      />
    ) : (
      <button
        type="button"
        className="bk-btn bk-btn--main account-action"
        disabled={busy || confirming !== null}
        onClick={() => {
          playSfx("click")
          setConfirming(choice)
        }}
      >
        保留这个账号
      </button>
    )
  }

  return (
    <Pages
      left={
        <>
          <p className="account-text">
            osu! 账号「{pending.osuUsername}」已经有进度了。两个账号<b>不能合并</b>，只能留一个，另一个会被封存。
          </p>
          <SummaryBox tag="现在登录的账号" account={current} />
          {side("keep-current", current, osu)}
          {error && <span className="bk-error">{error}</span>}
        </>
      }
      right={
        <>
          <SummaryBox tag="已有的 osu! 账号" account={osu} />
          {side("keep-osu", osu, current)}
          <p className="bk-note">
            封存：不会删除，只是登不上。邮箱和 osu! 号会释放出来，在售的挂单自动下架并退押金，进行中的出征会放弃。
          </p>
          <button
            type="button"
            className="bk-btn bk-btn--ghost bk-btn--sm account-action"
            disabled={busy}
            onClick={() => void cancel()}
          >
            先不绑定了
          </button>
          <span className="account-hint">
            这次确认 10 分钟内有效（到 {new Date(pending.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}）。
          </span>
        </>
      }
    />
  )
}
