import { useEffect, useMemo, useRef, useState } from "react"

import {
  TILE_DEPTH,
  TILE_H,
  TILE_W,
  distances,
  kindOf,
  type MapLayout,
  type NodeKind,
} from "./layout"
import { KindBadge, NodeEffects, NodeIcon } from "./NodeIcon"

const hw = TILE_W / 2
const hh = TILE_H / 2

/** 玩家只看当前格加两步，第三格靠放大把它挤出屏幕；往回只留一格半透明的脚印 */
const AHEAD_OPACITY = [1, 1, 0.7, 0.35]
const BACK_OPACITY = [1, 0.55, 0.28]

export function MapStage({
  layout,
  position,
  pickable,
  selected,
  onSelect,
  showMini,
}: {
  layout: MapLayout
  position: string
  /** 现在可以点选的下一格（分叉时才有多个） */
  pickable: string[]
  selected: string | null
  onSelect: (id: string) => void
  showMini: boolean
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 640, h: 420 })
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    // 第一次画出来时不要镜头动画
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)))
    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])

  const here = layout.nodes[position]
  const ahead = useMemo(() => distances(position, (id) => layout.nodes[id]?.node.next ?? []), [layout, position])
  const back = useMemo(() => distances(position, (id) => layout.preds[id] ?? []), [layout, position])

  const dimmed = useMemo(() => {
    const out = new Set<string>()
    if (!selected || pickable.length < 2) return out
    const keep = distances(selected, (id) => layout.nodes[id]?.node.next ?? [])
    for (const other of pickable) {
      if (other === selected) continue
      for (const id of Object.keys(distances(other, (n) => layout.nodes[n]?.node.next ?? []))) {
        if (!(id in keep)) out.add(id)
      }
    }
    return out
  }, [layout, pickable, selected])

  const opacityOf = (id: string): number => {
    if (id === position) return 1
    if (id in back) return BACK_OPACITY[back[id]!] ?? 0
    if (id in ahead) {
      const base = AHEAD_OPACITY[ahead[id]!] ?? 0
      return dimmed.has(id) ? base * 0.4 : base
    }
    return 0
  }

  if (!here) return <div className="ex-stage" ref={stageRef} />

  const scale = Math.max(0.5, Math.min(size.w / 460, size.h / 275))
  const world = `translate(${size.w * 0.22}px, ${size.h * 0.78}px) scale(${scale}) translate(${-here.x}px, ${-here.y}px)`

  const ids = Object.keys(layout.nodes)
  const edges = ids.flatMap((id) => layout.nodes[id]!.node.next.filter((to) => layout.nodes[to]).map((to) => [id, to] as const))

  return (
    <div className="ex-stage" ref={stageRef} data-animate={animate}>
      <svg className="ex-svgmap" aria-label="远征地图">
        <g className="ex-world" style={{ transform: world }}>
          <g>
            {edges.map(([a, b]) => {
              const from = layout.nodes[a]!
              const to = layout.nodes[b]!
              const chosen = a === position && b === selected
              const choosing = a === position && pickable.length > 1
              return (
                <path
                  key={`${a}>${b}`}
                  className={`ex-road${chosen ? " is-sel" : choosing ? " is-dash" : ""}`}
                  d={`M${from.x} ${from.y} L${to.x} ${to.y}`}
                  style={{ opacity: Math.min(opacityOf(a), opacityOf(b)) }}
                />
              )
            })}
          </g>
          <g>
            {ids.map((id) => {
              const p = layout.nodes[id]!
              const kind = kindOf(p.node)
              const op = opacityOf(id)
              const canPick = pickable.length > 1 && pickable.includes(id)
              const cls = [
                "ex-node",
                `ex-k-${kind}`,
                id === position ? "is-cur" : "",
                id in back && id !== position ? "is-past" : "",
                selected === id ? "is-sel" : "",
                canPick ? "is-pick" : "",
              ]
              return (
                <g
                  key={id}
                  className={cls.filter(Boolean).join(" ")}
                  transform={`translate(${p.x} ${p.y})`}
                  style={{ opacity: op, pointerEvents: canPick && op > 0 ? "auto" : "none" }}
                  onClick={canPick ? () => onSelect(id) : undefined}
                >
                  <polygon className="l-f" points={`${-hw},0 0,${hh} 0,${hh + TILE_DEPTH} ${-hw},${TILE_DEPTH}`} />
                  <polygon className="r-f" points={`0,${hh} ${hw},0 ${hw},${TILE_DEPTH} 0,${hh + TILE_DEPTH}`} />
                  <polygon className="top-f" points={`0,${-hh} ${hw},0 0,${hh} ${-hw},0`} />
                  <clipPath id={`ex-clip-${id}`}>
                    <polygon points={`0,${-hh} ${hw},0 0,${hh} ${-hw},0`} />
                  </clipPath>
                  <NodeEffects kind={kind} clipId={`ex-clip-${id}`} hw={hw} hh={hh} />
                  <polygon className="ring" points={`0,${-hh - 6} ${hw + 10},0 0,${hh + 6} ${-hw - 10},0`} />
                  <g className="ico" transform="translate(0 -2) scale(1.5 1.25)">
                    <NodeIcon kind={kind} />
                  </g>
                </g>
              )
            })}
          </g>
          <g className="ex-marker" style={{ transform: `translate(${here.x}px, ${here.y}px)` }}>
            <g className="bob">
              <path className="pin-f" d="M0 -14 C-14 -34 -16 -46 0 -58 C16 -46 14 -34 0 -14Z" transform="translate(0 -4)" />
              <circle cx="0" cy="-48" r="5" fill="#fff" />
            </g>
          </g>
        </g>
      </svg>

      <div className="ex-legend" aria-hidden>
        {(["battle", "event", "rest", "danger", "treasure", "boss"] as NodeKind[]).map((k) => (
          <span key={k}>
            <KindBadge kind={k} />
            {{ battle: "战斗", event: "事件", rest: "休息", danger: "危险战斗", treasure: "宝箱", boss: "Boss" }[k as string]}
          </span>
        ))}
      </div>

      <MiniMap layout={layout} position={position} back={back} open={showMini} />
    </div>
  )
}

/** 一排扁平圆点：整条路线的概览，走过的变灰，当前格带一圈 */
function MiniMap({
  layout,
  position,
  back,
  open,
}: {
  layout: MapLayout
  position: string
  back: Record<string, number>
  open: boolean
}) {
  const ids = Object.keys(layout.nodes)
  const lanes = ids.map((id) => layout.nodes[id]!.lane)
  const minLane = Math.min(...lanes)
  const maxLane = Math.max(...lanes)
  const mid = (minLane + maxLane) / 2
  const step = Math.min(24, 70 / Math.max(1, maxLane - minLane))
  const X = (col: number) => 16 + col * (228 / Math.max(1, layout.maxCol))
  const Y = (lane: number) => 48 + (lane - mid) * step

  return (
    <div className="ex-mini" data-open={open}>
      <h4>完整路线</h4>
      <svg viewBox="0 0 260 96" role="img" aria-label="完整路线">
        {ids.flatMap((id) =>
          layout.nodes[id]!.node.next
            .filter((to) => layout.nodes[to])
            .map((to) => {
              const a = layout.nodes[id]!
              const b = layout.nodes[to]!
              const walked = id in back && (to in back || to === position)
              return (
                <path
                  key={`${id}>${to}`}
                  d={`M${X(a.col)} ${Y(a.lane)} L${X(b.col)} ${Y(b.lane)}`}
                  className={`ex-mini__road${walked ? " is-past" : ""}`}
                />
              )
            }),
        )}
        {ids.map((id) => {
          const p = layout.nodes[id]!
          const past = id in back && id !== position
          const kind = kindOf(p.node)
          return (
            <g key={id} className={`ex-k-${kind}${past ? " is-past" : ""}`}>
              {id === position && <circle cx={X(p.col)} cy={Y(p.lane)} r={10} className="ex-mini__cur" />}
              <circle cx={X(p.col)} cy={Y(p.lane)} r={kind === "boss" ? 7 : 5.5} className="ex-mini__dot" />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
