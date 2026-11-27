import type { NodeKind } from "./layout"

/**
 * 格子上的图案：在 -16..16 的方框里画，白色描边/填充，细节用格子本色（var(--c)）。
 * 动态效果的样式在 expedition.css 里（ex-fx-*），这里只负责摆元素。
 */
export function NodeIcon({ kind }: { kind: NodeKind }) {
  switch (kind) {
    case "battle":
      return (
        <g className="ico-line">
          <path d="M-10 -11 L6 5 M10 -11 L-6 5" />
          <path d="M2 9 L9 2 M-2 9 L-9 2" />
          <path d="M6 5 L12 11 M-6 5 L-12 11" />
        </g>
      )
    case "danger":
      return (
        <g className="ico-line ex-fx-flicker">
          <path d="M0 -13 L14 11 H-14 Z" className="ico-fill-soft" />
          <path d="M0 -4 V3" />
          <circle cx="0" cy="7.4" r="1.2" className="ico-solid" />
        </g>
      )
    case "boss":
      return (
        <g>
          <path d="M-13 9 L-13 -5 L-6.5 1 L0 -10 L6.5 1 L13 -5 L13 9 Z" className="ico-solid" />
          <path d="M-13 12.5 H13" className="ico-line-only" />
          <circle cx="-13" cy="-6.5" r="2" className="ico-solid" />
          <circle cx="0" cy="-11.5" r="2.2" className="ico-solid" />
          <circle cx="13" cy="-6.5" r="2" className="ico-solid" />
          <circle cx="0" cy="3" r="2.2" className="ico-gem" />
        </g>
      )
    case "event":
      return (
        <g>
          <g className="ico-line">
            <path d="M-5.5 -6 Q-5.5 -12.5 0 -12.5 Q5.5 -12.5 5.5 -7 Q5.5 -3 0 -0.5 V3" />
          </g>
          <circle cx="0" cy="8.5" r="1.7" className="ico-solid" />
          <path className="ico-solid ex-fx-spark" d="M11 -10 l1.3 3.2 3.2 1.3 -3.2 1.3 -1.3 3.2 -1.3 -3.2 -3.2 -1.3 3.2 -1.3z" />
          <path className="ico-solid ex-fx-spark ex-fx-spark--late" d="M-12 6 l1 2.4 2.4 1 -2.4 1 -1 2.4 -1 -2.4 -2.4 -1 2.4 -1z" />
        </g>
      )
    case "rest":
      return (
        <g>
          <path className="ico-solid ex-fx-flame" d="M0 -13 C5 -7 10 -3 10 3 A10 10 0 0 1 -10 3 C-10 -2 -5 -5 -3.5 -10 C-2 -7 -1 -6 0 -6 C1 -9 0 -11 0 -13 Z" />
          <path className="ico-gem ex-fx-flame ex-fx-flame--in" d="M0 -2 C3 1 5 3 5 6 A5 5 0 0 1 -5 6 C-5 3 -2 1 0 -2 Z" />
          <path className="ico-line-only" d="M-10 12 L10 9 M-10 9 L10 12" />
        </g>
      )
    case "treasure":
      return (
        <g>
          <path d="M-12 -1 V-5 A12 8.5 0 0 1 12 -5 V-1 Z" className="ico-solid" />
          <rect x="-12" y="-1" width="24" height="13" rx="2" className="ico-solid" />
          <path d="M-12 -1 H12" className="ico-seam" />
          <rect x="-3" y="-3" width="6" height="8" rx="1.5" className="ico-gem" />
          <circle cx="0" cy="1" r="1.1" className="ico-solid" />
        </g>
      )
    case "story":
      return (
        <g className="ex-fx-float">
          <path
            d="M0 -8 C-5 -11.5 -10 -11.5 -13.5 -9.5 V10 C-10 8 -5 8 0 11 C5 8 10 8 13.5 10 V-9.5 C10 -11.5 5 -11.5 0 -8 Z"
            className="ico-solid"
          />
          <path d="M0 -8 V11" className="ico-seam" />
          <path d="M-10 -4 H-4 M-10 0 H-4 M4 -4 H10 M4 0 H10" className="ico-seam" />
        </g>
      )
    case "empty":
      return (
        <g>
          <circle cx="-9" cy="6" r="3" className="ico-solid" />
          <circle cx="0" cy="0" r="3" className="ico-solid" />
          <circle cx="9" cy="-6" r="3" className="ico-solid" />
        </g>
      )
    case "branch":
      return (
        <g className="ico-line">
          <path d="M0 12 V0 M0 0 L-9 -9 M0 0 L9 -9" />
          <path d="M-3 -9 H-9 V-3 M3 -9 H9 V-3" />
        </g>
      )
  }
}

/** 格子顶面上的特效（在图标下面）：危险红光、Boss 光环、宝箱扫光、休息的小光点、事件的星光 */
export function NodeEffects({ kind, clipId, hw, hh }: { kind: NodeKind; clipId: string; hw: number; hh: number }) {
  const top = `0,${-hh} ${hw},0 0,${hh} ${-hw},0`
  switch (kind) {
    case "danger":
      return <polygon className="ex-fx-danger" points={top} />
    case "boss":
      return (
        <>
          <polygon className="ex-fx-bossglow" points={top} />
          <ellipse className="ex-fx-aura" cx="0" cy="0" rx={hw + 18} ry={hh + 9} />
        </>
      )
    case "treasure":
      return (
        <g clipPath={`url(#${clipId})`}>
          <polygon className="ex-fx-shine" points="-10,-40 6,-40 -4,40 -20,40" />
        </g>
      )
    case "rest":
      return (
        <>
          <circle className="ex-fx-mote" cx="-14" cy="-6" r="2.2" />
          <circle className="ex-fx-mote ex-fx-mote--b" cx="12" cy="-10" r="1.8" />
          <circle className="ex-fx-mote ex-fx-mote--c" cx="2" cy="-4" r="1.5" />
        </>
      )
    default:
      return null
  }
}

/** 图例里的小徽章 */
export function KindBadge({ kind }: { kind: NodeKind }) {
  return (
    <svg className={`ex-badge ex-k-${kind}`} viewBox="-16 -16 32 32" width="18" height="18" aria-hidden>
      <rect x="-15" y="-15" width="30" height="30" rx="9" className="ex-badge__bg" />
      <g className="ico" transform="scale(.78)">
        <NodeIcon kind={kind} />
      </g>
    </svg>
  )
}
