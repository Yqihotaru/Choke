import { useState } from "react"

interface PagerProps {
  /** 从 0 开始 */
  page: number
  pages: number
  onPage: (page: number) => void
  className?: string
}

/** 普通分页条：上一页 / 下一页 / 页码跳转。只有一页时不渲染。 */
export function Pager({ page, pages, onPage, className }: PagerProps) {
  const [draft, setDraft] = useState("")
  if (pages <= 1) return null
  const go = (next: number) => onPage(Math.min(Math.max(next, 0), pages - 1))
  return (
    <div
      className={`card-pager ${className ?? ""}`}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement) return
        if (event.key === "ArrowLeft") go(page - 1)
        if (event.key === "ArrowRight") go(page + 1)
      }}
    >
      <button type="button" className="bk-btn bk-btn--sm" disabled={page <= 0} onClick={() => go(page - 1)} aria-label="上一页">
        ‹
      </button>
      <span className="card-pager__folio">
        第 {page + 1} / {pages} 页
      </span>
      <button type="button" className="bk-btn bk-btn--sm" disabled={page >= pages - 1} onClick={() => go(page + 1)} aria-label="下一页">
        ›
      </button>
      <input
        className="bk-input card-pager__jump"
        type="number"
        min={1}
        max={pages}
        value={draft}
        placeholder="跳至"
        aria-label="跳转到页码"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return
          const target = Number.parseInt(draft, 10)
          if (Number.isFinite(target)) go(target - 1)
          setDraft("")
        }}
      />
    </div>
  )
}
