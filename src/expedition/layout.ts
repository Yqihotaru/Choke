import type { MapDef, MapNode } from "@choke/shared/expedition/content"

/** 菱形格子的尺寸（和 expedition.css 里的画法对应）；一步在屏幕上是「向右上走一格」 */
export const TILE_W = 120
export const TILE_H = 60
export const TILE_DEPTH = 16

const COL_X = 156
const COL_Y = -78
const LANE_X = 90
const LANE_Y = 45

export interface Placed {
  id: string
  node: MapNode
  /** 第几步（从 0 开始，可能是小数） */
  col: number
  /** 岔路上的哪一条：0 是中线，负数偏上，正数偏下 */
  lane: number
  x: number
  y: number
}

export interface MapLayout {
  nodes: Record<string, Placed>
  maxCol: number
  /** 谁能走到我 */
  preds: Record<string, string[]>
}

export function layoutMap(map: MapDef): MapLayout {
  const reachable: string[] = []
  const seen = new Set<string>()
  const queue = [map.start]
  const depth: Record<string, number> = { [map.start]: 0 }
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    if (!map.nodes[id]) continue
    reachable.push(id)
    for (const next of map.nodes[id].next) {
      if (!(next in depth)) depth[next] = depth[id]! + 1
      queue.push(next)
    }
  }

  const allPlaced = reachable.length > 0 && reachable.every((id) => map.nodes[id]?.pos)
  const coords: Record<string, [number, number]> = {}
  if (allPlaced) {
    for (const id of reachable) coords[id] = map.nodes[id]!.pos!
  } else {
    const byDepth = new Map<number, string[]>()
    for (const id of reachable) {
      const list = byDepth.get(depth[id]!) ?? []
      list.push(id)
      byDepth.set(depth[id]!, list)
    }
    for (const [d, ids] of byDepth) ids.forEach((id, i) => (coords[id] = [d, i - (ids.length - 1) / 2]))
  }

  const nodes: Record<string, Placed> = {}
  const preds: Record<string, string[]> = {}
  let maxCol = 0
  for (const id of reachable) {
    const [col, lane] = coords[id]!
    maxCol = Math.max(maxCol, col)
    nodes[id] = { id, node: map.nodes[id]!, col, lane, x: col * COL_X + lane * LANE_X, y: col * COL_Y + lane * LANE_Y }
  }
  for (const id of reachable) {
    for (const next of map.nodes[id]!.next) if (nodes[next]) (preds[next] ??= []).push(id)
  }
  return { nodes, maxCol, preds }
}

/** 从 from 出发，沿着 edges 走，每个能到的格子要几步 */
export function distances(from: string, edges: (id: string) => readonly string[]): Record<string, number> {
  const dist: Record<string, number> = { [from]: 0 }
  const queue = [from]
  while (queue.length) {
    const id = queue.shift()!
    for (const next of edges(id)) {
      if (!(next in dist)) {
        dist[next] = dist[id]! + 1
        queue.push(next)
      }
    }
  }
  return dist
}

export type NodeKind = "battle" | "danger" | "boss" | "story" | "event" | "rest" | "treasure" | "branch"

/** 格子的颜色和图标类别：带威胁的战斗显示成「危险」 */
export function kindOf(node: MapNode): NodeKind {
  switch (node.type) {
    case "battle":
      return (node.threat ?? 0) > 0 ? "danger" : "battle"
    case "slot":
      return "battle"
    default:
      return node.type
  }
}

export const KIND_LABEL: Record<NodeKind, string> = {
  battle: "战斗",
  danger: "危险战斗",
  boss: "Boss",
  story: "剧情",
  event: "事件",
  rest: "休息",
  treasure: "宝箱",
  branch: "分叉",
}

export function titleOf(node: MapNode): string {
  return node.title ?? KIND_LABEL[kindOf(node)]
}
