import type { ReactNode } from "react"

interface CardGridProps<T> {
  rows: T[] | null
  loading: boolean
  error: string | null
  /** 没有数据时显示什么 */
  empty: ReactNode
  renderCard: (row: T) => ReactNode
  getKey: (row: T) => string | number
  onRetry: () => void
  /** 新手教程定位标识 */
  tutorialId?: string
  className?: string
}

/** 卡格：固定最小卡宽、自己滚动；首次加载显示骨架，换页时保留旧卡并压暗。 */
export function CardGrid<T>({
  rows,
  loading,
  error,
  empty,
  renderCard,
  getKey,
  onRetry,
  tutorialId,
  className,
}: CardGridProps<T>) {
  const classes = `card-grid ${className ?? ""}`
  if (error) {
    return (
      <div className={classes} data-tutorial-id={tutorialId} aria-busy={false}>
        <div className="bk-empty bk-error card-grid__state">
          <span>{error}</span>
          <button type="button" className="bk-btn" onClick={onRetry}>
            重试
          </button>
        </div>
      </div>
    )
  }
  if (rows === null) {
    return (
      <div className={classes} data-tutorial-id={tutorialId} aria-busy>
        <div className="card-grid__cells" aria-hidden>
          {Array.from({ length: 12 }, (_, index) => (
            <div className="bk-slot card-grid__skeleton" key={index} />
          ))}
        </div>
      </div>
    )
  }
  if (rows.length === 0 && !loading) {
    return (
      <div className={classes} data-tutorial-id={tutorialId} aria-busy={false}>
        <div className="bk-empty card-grid__state">{empty}</div>
      </div>
    )
  }
  return (
    <div className={classes} data-tutorial-id={tutorialId} aria-busy={loading}>
      <div className={`card-grid__cells ${loading ? "is-loading" : ""}`}>
        {rows.map((row) => (
          <div className="card-grid__cell" key={getKey(row)}>
            {renderCard(row)}
          </div>
        ))}
      </div>
    </div>
  )
}
