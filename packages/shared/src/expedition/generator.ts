import { resetDayKey } from "../reset"
import { deriveStream, nextRandom } from "../rng"
import type { MapDef, MapGeneratorTemplate, MapNode, SlotNode } from "./content"

/**
 * 地图生成器（纯函数，只吃种子）：
 * 1. 日常地图：按 generate 模板从零生成一张单向无环图（第 1 层单起点普通战、中间层可分叉、最后 1 层单终点 Boss）。
 * 2. 周常地图：把骨架里的 `type: "slot"` 节点按权重替换成池里的具体节点。
 * 3. 主线 / 赛季手作图：原样返回。
 *
 * 同一个种子永远生成同一张图。开始出征时把生成好的成品 MapDef 存进 `expeditions.map` 快照，
 * 后续走节点、战斗、结算完全不需要知道这张图原本是手作的还是随机生成的。
 */

/** 日常地图的固定种子：按「玩家 + 地图 + 当天（北京时间 4:00 换日）」唯一确定，放弃重进不会换图 */
export function dailyMapSeed(userId: string, mapId: string, now: number, clearCountToday = 0): string {
  const base = `daily:${userId}:${mapId}:${resetDayKey(now)}`
  return clearCountToday > 0 ? `${base}#${clearCountToday}` : base
}

function pickWeighted<T extends { weight: number }>(items: readonly T[], roll: number): T {
  const sum = items.reduce((acc, item) => acc + item.weight, 0)
  let at = roll * sum
  for (const item of items) {
    at -= item.weight
    if (at < 0) return item
  }
  return items[items.length - 1]!
}

function slotToMapNode(picked: SlotNode, base: { pos?: [number, number]; title?: string; next: string[]; requires?: { flag: string } }): MapNode {
  const common = {
    ...(base.pos ? { pos: base.pos } : {}),
    ...(picked.title ?? base.title ? { title: picked.title ?? base.title } : {}),
    next: [...base.next],
    ...(base.requires ? { requires: base.requires } : {}),
  }
  switch (picked.type) {
    case "battle":
      return { type: "battle", encounter: picked.encounter, ...(picked.rewards ? { rewards: picked.rewards } : {}), ...common }
    case "boss":
      return { type: "boss", encounter: picked.encounter, ...(picked.rewards ? { rewards: picked.rewards } : {}), ...common }
    case "treasure":
      return { type: "treasure", rewards: picked.rewards, ...common }
    case "rest":
      return { type: "rest", ...common }
  }
}

/** 周常骨架图：把所有 `type: "slot"` 的节点按权重替换成池里的具体节点 */
export function resolveMapSlots(map: MapDef, seed: string): MapDef {
  const slotIds = Object.keys(map.nodes)
    .filter((nodeId) => map.nodes[nodeId]?.type === "slot")
    .sort()
  if (slotIds.length === 0) return map

  let stream = deriveStream(seed, "map-slots")
  const nodes: Record<string, MapNode> = { ...map.nodes }
  for (const nodeId of slotIds) {
    const slot = nodes[nodeId]
    if (!slot || slot.type !== "slot") continue
    const pool = map.pools?.[slot.pool]
    if (!pool || pool.length === 0) {
      throw new Error(`地图 ${map.name} 的槽位节点 ${nodeId} 引用了不存在或为空的池 ${slot.pool}`)
    }
    const [next, roll] = nextRandom(stream)
    stream = next
    const picked = pickWeighted(pool, roll).node
    nodes[nodeId] = slotToMapNode(picked, slot)
  }
  const copy = { ...map, nodes }
  delete copy.pools
  return copy
}

/** 日常模板：按层生成单向无环图 */
export function generateMapFromTemplate(template: MapGeneratorTemplate, seed: string): { start: string; nodes: Record<string, MapNode> } {
  let stream = deriveStream(seed, "map-gen")
  const rand = (): number => {
    const [next, value] = nextRandom(stream)
    stream = next
    return value
  }

  const layers = template.layers
  const layerNodeIds: string[][] = []
  for (let col = 0; col < layers; col += 1) {
    const isFirst = col === 0
    const isLast = col === layers - 1
    const count = isFirst || isLast ? 1 : rand() < template.branchRate ? 2 : 1
    const index = col + 1
    layerNodeIds.push(count === 1 ? [`n${index}`] : [`n${index}a`, `n${index}b`])
  }

  const kindEntries: { type: "battle" | "rest" | "treasure"; weight: number }[] = [
    { type: "battle", weight: template.weights.battle },
    ...(template.weights.rest > 0 ? [{ type: "rest" as const, weight: template.weights.rest }] : []),
    ...(template.weights.treasure > 0 && template.chests.length > 0
      ? [{ type: "treasure" as const, weight: template.weights.treasure }]
      : []),
  ]

  const nodes: Record<string, MapNode> = {}
  for (let col = 0; col < layers; col += 1) {
    const ids = layerNodeIds[col]!
    const nextIds = col < layers - 1 ? layerNodeIds[col + 1]! : []
    ids.forEach((nodeId, rowIdx) => {
      const y = ids.length === 1 ? 0 : rowIdx === 0 ? -1 : 1
      const pos: [number, number] = [col, y]
      // 连线规则：2→2 时默认平行往前走，并以 50% 概率额外给一条交叉线，保证全可达且有路线选择
      let next: string[]
      if (nextIds.length === 0) {
        next = []
      } else if (ids.length === 2 && nextIds.length === 2) {
        const primary = nextIds[rowIdx]!
        const cross = nextIds[1 - rowIdx]!
        next = rand() < 0.5 ? [primary, cross] : [primary]
      } else {
        next = [...nextIds]
      }

      if (col === 0) {
        const picked = pickWeighted(template.battles, rand())
        const rewards = picked.rewards ?? template.battleRewards
        nodes[nodeId] = { type: "battle", encounter: picked.encounter, ...(rewards ? { rewards } : {}), pos, next }
        return
      }
      if (col === layers - 1) {
        const picked = pickWeighted(template.bosses, rand())
        const rewards = picked.rewards ?? template.bossRewards
        nodes[nodeId] = { type: "boss", encounter: picked.encounter, ...(rewards ? { rewards } : {}), pos, next: [] }
        return
      }

      const kind = pickWeighted(kindEntries, rand()).type
      if (kind === "rest") {
        nodes[nodeId] = { type: "rest", title: "篝火", pos, next }
      } else if (kind === "treasure") {
        const chest = pickWeighted(template.chests, rand())
        nodes[nodeId] = { type: "treasure", rewards: chest.rewards, pos, next }
      } else {
        const picked = pickWeighted(template.battles, rand())
        const rewards = picked.rewards ?? template.battleRewards
        nodes[nodeId] = { type: "battle", encounter: picked.encounter, ...(rewards ? { rewards } : {}), pos, next }
      }
    })
  }

  return { start: layerNodeIds[0]![0]!, nodes }
}

/**
 * 把一张地图配置展开成可直接运行的成品 MapDef：
 * - 带 `generate` 模板的（日常）：现场生成 start + nodes，并去掉 `generate` 字段
 * - 带 `slot` 节点的（周常）：按权重填槽，并去掉 `pools` 字段
 * - 普通手作图：原样返回
 */
export function materializeMap(map: MapDef, seed: string): MapDef {
  if (map.generate) {
    const { start, nodes } = generateMapFromTemplate(map.generate, seed)
    const copy = { ...map, start, nodes }
    delete copy.generate
    delete copy.pools
    return copy
  }
  return resolveMapSlots(map, seed)
}
