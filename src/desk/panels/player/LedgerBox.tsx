import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { LEDGER_KIND_LABEL, type LedgerEntryView, type LedgerKind } from "@choke/shared/ledger"

import { fetchLedger } from "@/desk/session/api"

import "@/desk/book.css"
import "@/desk/panels/mail/mail-box.css"
import "@/desk/panels/player/ledger-box.css"

const FILTERS: readonly { kind: LedgerKind | null; label: string }[] = [
  { kind: null, label: "全部" },
  { kind: "coins", label: LEDGER_KIND_LABEL.coins },
  { kind: "essence", label: LEDGER_KIND_LABEL.essence },
  { kind: "stamina", label: LEDGER_KIND_LABEL.stamina },
  { kind: "item", label: LEDGER_KIND_LABEL.item },
  { kind: "pack", label: LEDGER_KIND_LABEL.pack },
  { kind: "card", label: LEDGER_KIND_LABEL.card },
]

function formatTime(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function LedgerBox({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<LedgerKind | null>(null)
  const [entries, setEntries] = useState<LedgerEntryView[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(
    async (kind: LedgerKind | null, before?: number) => {
      const mine = ++seq.current
      setLoading(true)
      try {
        const page = await fetchLedger(userId, { kind: kind ?? undefined, before })
        if (mine !== seq.current) return
        setEntries((prev) => (before ? [...prev, ...page.entries] : page.entries))
        setHasMore(page.hasMore)
        setError(null)
      } catch (reason) {
        if (mine !== seq.current) return
        setError(reason instanceof Error ? reason.message : "流水加载失败")
      } finally {
        if (mine === seq.current) setLoading(false)
      }
    },
    [userId],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const openPanel = () => {
    setOpen(true)
    setEntries([])
    void load(filter)
  }

  const pick = (kind: LedgerKind | null) => {
    setFilter(kind)
    setEntries([])
    setHasMore(false)
    void load(kind)
  }

  const last = entries[entries.length - 1]

  return (
    <>
      <button type="button" className="desk-button" onClick={openPanel} title="货币、道具、卡包、卡牌的增减记录">
        流水
      </button>

      {open &&
        createPortal(
          <div
            className="mail-backdrop"
            onPointerDown={(event) => event.target === event.currentTarget && setOpen(false)}
          >
            <section className="mail-panel ledger-panel" role="dialog" aria-modal="true" aria-label="流水">
              <header className="mail-panel__head">
                <div>
                  <span className="bk-label">LEDGER</span>
                  <h2 className="mail-panel__title">流水</h2>
                </div>
                <div className="mail-panel__actions">
                  <button
                    type="button"
                    className="bk-btn bk-btn--ghost bk-btn--sm"
                    onClick={() => setOpen(false)}
                    aria-label="关闭流水"
                  >
                    关闭
                  </button>
                </div>
              </header>

              <div className="ledger-tabs" role="tablist" aria-label="按类别筛选">
                {FILTERS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    role="tab"
                    aria-selected={item.kind === filter}
                    className={`bk-btn bk-btn--sm ${item.kind === filter ? "bk-btn--main" : "bk-btn--ghost"}`}
                    onClick={() => pick(item.kind)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="ledger-body">
                {error && (
                  <p className="bk-note ledger-empty">
                    {error}{" "}
                    <button type="button" className="bk-btn bk-btn--ghost bk-btn--sm" onClick={() => void load(filter)}>
                      重试
                    </button>
                  </p>
                )}
                {!error && loading && entries.length === 0 && <p className="bk-note ledger-empty">加载中…</p>}
                {!error && !loading && entries.length === 0 && <p className="bk-note ledger-empty">还没有记录。</p>}
                {entries.length > 0 && (
                  <ul className="ledger-list" aria-label="流水列表">
                    {entries.map((entry) => (
                      <li key={entry.id} className="ledger-row">
                        <span className="ledger-row__time">{formatTime(entry.createdAt)}</span>
                        <span className="ledger-row__kind">{LEDGER_KIND_LABEL[entry.kind]}</span>
                        <span className="ledger-row__label">
                          {entry.label}
                          {entry.rarity && <i className="ledger-row__rarity">{entry.rarity}</i>}
                        </span>
                        <span className="ledger-row__source">{entry.sourceLabel}</span>
                        <b className={`ledger-row__delta ${entry.delta > 0 ? "is-gain" : "is-loss"}`}>
                          {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                        </b>
                      </li>
                    ))}
                  </ul>
                )}
                {hasMore && last && (
                  <div className="ledger-more">
                    <button
                      type="button"
                      className="bk-btn bk-btn--sm"
                      disabled={loading}
                      onClick={() => void load(filter, last.id)}
                    >
                      {loading ? "加载中…" : "加载更早的记录"}
                    </button>
                  </div>
                )}
              </div>

              <footer className="mail-panel__foot bk-note">
                只记录上线之后的变化；体力的自然恢复不记，只记花掉和领到的。
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </>
  )
}
