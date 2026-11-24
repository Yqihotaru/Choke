import { useEffect, type ReactNode } from "react"

import { playSfx } from "@/audio/sfx"

import "@/desk/shell/confirm-bar.css"

/** 面板内的二次确认条：出现时播 tick，焦点落在"取消"上，Esc 取消。 */
export function ConfirmBar({
  message,
  confirmLabel,
  danger = false,
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    playSfx("tick")
  }, [])

  return (
    <div
      className="bk-box confirm-bar"
      role="alert"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.stopPropagation()
        onCancel()
      }}
    >
      <p className="confirm-bar__text">{message}</p>
      <div className="confirm-bar__actions">
        <button
          type="button"
          className="bk-btn bk-btn--ghost bk-btn--sm"
          onClick={onCancel}
          disabled={busy}
          autoFocus
        >
          取消
        </button>
        <button
          type="button"
          className={`bk-btn bk-btn--sm ${danger ? "bk-btn--danger confirm-bar__danger" : "bk-btn--main"}`}
          onClick={onConfirm}
          disabled={busy || confirmDisabled}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}
