import { useEffect, useRef, useState, type CSSProperties } from "react"

import { playSfx } from "@/audio/sfx"

import type { DeskObjectId } from "@/desk/lib/objects"
import { POOL_META, POOL_ORDER } from "@/desk/lib/rarity"
import type { PackPool } from "@/desk/lib/types"
import "@/desk/desk-objects.css"

export interface DealButtonState {
  pool: PackPool
  available: boolean
  pressing: boolean
  /** 每次按下 +1；用作 key，强制重挂按钮让 CSS 动画一定从头播 */
  pressId: number
  onPool: (pool: PackPool) => void
  onPressed: () => void
}

interface Props {
  id: DeskObjectId
  deal: DealButtonState
  /** 等级未到：保持物件可见，但盖一层封条 / 等级徽章 */
  locked?: boolean
  unlockLevel?: number
}

/** 桌上的实物：发牌按钮。全部用 CSS 画，光从左上来。 */
export function DeskObject({ id, deal, locked = false, unlockLevel }: Props) {
  return (
    <div
      className={`obj ${locked ? "is-locked" : ""}`}
      data-object={id}
      data-locked={locked || undefined}
    >
      <div
        className={`obj-deal ${deal.available ? "" : "is-empty"}`}
        style={{ "--pool": POOL_META[deal.pool].color } as CSSProperties}
      >
        <div
          key={deal.pressId}
          className={`obj-deal__button ${deal.pressing ? "is-pressing" : ""}`}
          onAnimationEnd={deal.onPressed}
        />
        <PoolPicker pool={deal.pool} onPool={deal.onPool} />
      </div>

      {locked && (
        <div className="obj-lock" aria-hidden>
          <i className="obj-lock__seal">SEALED</i>
          <b className="obj-lock__badge">Lv.{unlockLevel ?? 1} 解锁</b>
        </div>
      )}
    </div>
  )
}

/** 发牌按钮下的卡池下拉框：平时只显示当前卡池，点开向下展开六个卡池。 */
function PoolPicker({
  pool,
  onPool,
}: {
  pool: PackPool
  onPool: (pool: PackPool) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div
      ref={root}
      className={`obj-pick ${open ? "is-open" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="obj-pick__box"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`当前${POOL_META[pool].label}，切换卡池`}
        onClick={() => setOpen((v) => !v)}
      >
        <i
          className="obj-pick__dot"
          style={{ background: POOL_META[pool].color }}
        />
        <span>{POOL_META[pool].label}</span>
        <i className="obj-pick__arrow" />
      </button>
      {open && (
        <div className="obj-pick__menu" role="menu" aria-label="切换卡池">
          {POOL_ORDER.map((it) => (
            <button
              key={it}
              type="button"
              role="menuitemradio"
              aria-checked={it === pool}
              className="obj-pick__item"
              onClick={() => {
                playSfx("tick")
                onPool(it)
                setOpen(false)
              }}
            >
              <i
                className="obj-pick__dot"
                style={{ background: POOL_META[it].color }}
              />
              <span>{POOL_META[it].label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
