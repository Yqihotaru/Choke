import { prettifyError, z } from "zod"

import { CONTENT, MYSTERY_PACK_ID } from "../content"
import { mailAttachmentSchema } from "../mail"
import type { BattleContent } from "../battle/content"

/**
 * 出征内容：地图（maps/*.json）、掉落表（rewards/*.json）、剧情（stories/*.json）。
 * 文件名就是 id。这里只做校验和组装，不读磁盘——服务端读文件后交给 parseWorldContent。
 */

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, "id 只能用字母、数字和连字符")
const int = z.number().int()

// ---------- 奖励 / 掉落表 ----------

/** 一份奖励：邮件附件能装的东西，加上玩家经验 */
export const rewardSchema = mailAttachmentSchema.extend({
  playerExp: int.min(1).max(1_000_000).optional(),
})
export type Reward = z.infer<typeof rewardSchema>

/**
 * 掉落表。发放顺序：固定 → 随机 → 星级加成；首通奖励只在整张图第一次通关时给。
 * 星级加成是累加的：3 星同时拿到 "1"、"2"、"3" 三档。
 */
export const rewardTableSchema = z.strictObject({
  fixed: rewardSchema.optional(),
  random: z
    .strictObject({
      /** 抽几次，每次按权重独立抽一项（可重复） */
      rolls: int.min(1).max(20),
      /** reward 不写 = 这一项什么都没有 */
      entries: z.array(z.strictObject({ weight: int.min(1).max(1_000_000), reward: rewardSchema.optional() })).min(1).max(40),
    })
    .optional(),
  starBonus: z.strictObject({ "1": rewardSchema.optional(), "2": rewardSchema.optional(), "3": rewardSchema.optional() }).optional(),
  firstClear: rewardSchema.optional(),
})
export type RewardTable = z.infer<typeof rewardTableSchema>

// ---------- 剧情 ----------

const flag = id

export const storyLineSchema = z.union([
  z.strictObject({ speaker: z.string().min(1).optional(), text: z.string().min(1) }),
  /** 选项只能设置标记，不能直接发奖励 */
  z.strictObject({
    choice: z
      .array(z.strictObject({ text: z.string().min(1), set: z.array(flag).default([]) }))
      .min(2)
      .max(4),
  }),
])

export const storySchema = z.strictObject({
  title: z.string().min(1),
  lines: z.array(storyLineSchema).min(1).max(200),
})
export type Story = z.infer<typeof storySchema>
export type StoryLine = z.infer<typeof storyLineSchema>

// ---------- 地图 ----------

export const MAP_KINDS = ["main", "season", "weekly", "daily"] as const
export type MapKind = (typeof MAP_KINDS)[number]

const nodeBase = {
  /** 画地图用的坐标，服务端不关心 */
  pos: z.tuple([z.number(), z.number()]).optional(),
  title: z.string().optional(),
  next: z.array(id).max(6).default([]),
  /** 进这个节点需要先设置过的标记 */
  requires: z.strictObject({ flag }).optional(),
}

export const mapNodeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("battle"), encounter: id, rewards: id.optional(), ...nodeBase }),
  z.strictObject({ type: z.literal("boss"), encounter: id, rewards: id.optional(), ...nodeBase }),
  z.strictObject({ type: z.literal("story"), story: id, ...nodeBase }),
  z.strictObject({ type: z.literal("treasure"), rewards: id, ...nodeBase }),
  /** 休息：队伍血量回满 */
  z.strictObject({ type: z.literal("rest"), ...nodeBase }),
  z.strictObject({ type: z.literal("branch"), prompt: z.string().optional(), ...nodeBase }),
  /** 事件：格式先占位，还没有运行时支持 */
  z.strictObject({ type: z.literal("event"), event: id, ...nodeBase }),
  /** 槽位：由地图生成器在开始出征前换成具体节点，见 4B */
  z.strictObject({ type: z.literal("slot"), pool: id, ...nodeBase }),
])

export const mapSchema = z.strictObject({
  kind: z.enum(MAP_KINDS),
  name: z.string().min(1),
  summary: z.string().default(""),
  /** 开始时冻结、结算时才扣的体力；主线和赛季必须是 0 */
  staminaCost: int.min(0).max(360).default(0),
  /** 出征前要选满几张卡（卡池） */
  deckSize: int.min(1).max(60),
  start: id,
  nodes: z.record(id, mapNodeSchema),
  /** 通关奖励：整张图走到终点时发，掉落表 id */
  rewards: id.optional(),
})
export type MapDef = z.infer<typeof mapSchema>
export type MapNode = z.infer<typeof mapNodeSchema>

export interface WorldContent {
  maps: Record<string, MapDef>
  rewards: Record<string, RewardTable>
  stories: Record<string, Story>
}

const worldSchema = z.strictObject({
  maps: z.record(id, mapSchema),
  rewards: z.record(id, rewardTableSchema),
  stories: z.record(id, storySchema),
})

/** 卡包 id：配置里的卡包加神秘包 */
function knownPool(pool: string): boolean {
  return pool === MYSTERY_PACK_ID || Object.hasOwn(CONTENT.packs.packs, pool)
}

function checkRewardPacks(reward: Reward | undefined, path: (string | number)[], issue: (path: (string | number)[], message: string) => void) {
  reward?.packs?.forEach((pack, i) => {
    if (!knownPool(pack.pool)) issue([...path, "packs", i, "pool"], `卡包 ${pack.pool} 不存在`)
  })
}

/** 有向图里有没有环（从 start 出发） */
function findCycle(nodes: MapDef["nodes"], start: string): string | null {
  const state = new Map<string, "open" | "done">()
  const visit = (node: string): string | null => {
    const mark = state.get(node)
    if (mark === "open") return node
    if (mark === "done" || !nodes[node]) return null
    state.set(node, "open")
    for (const next of nodes[node]!.next) {
      const hit = visit(next)
      if (hit) return hit
    }
    state.set(node, "done")
    return null
  }
  return visit(start)
}

function reachable(nodes: MapDef["nodes"], start: string): Set<string> {
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (seen.has(node) || !nodes[node]) continue
    seen.add(node)
    stack.push(...nodes[node]!.next)
  }
  return seen
}

/** 一张图里所有 story 节点设置得出来的标记 */
function settableFlags(map: MapDef, stories: Record<string, Story>): Set<string> {
  const flags = new Set<string>()
  for (const node of Object.values(map.nodes)) {
    if (node.type !== "story") continue
    for (const line of stories[node.story]?.lines ?? []) {
      if ("choice" in line) for (const choice of line.choice) choice.set.forEach((f) => flags.add(f))
    }
  }
  return flags
}

/** 校验整份出征内容；失败直接抛错（服务端因此拒绝启动） */
export function parseWorldContent(
  raw: { maps: Record<string, unknown>; rewards: Record<string, unknown>; stories: Record<string, unknown> },
  battle: BattleContent,
): WorldContent {
  const badIds = (["maps", "rewards", "stories"] as const).flatMap((dir) =>
    Object.keys(raw[dir]).filter((key) => !id.safeParse(key).success).map((key) => `${dir}/${key}.json`),
  )
  if (badIds.length > 0) {
    throw new Error(`出征内容校验失败：文件名就是 id，只能用字母、数字和连字符：${badIds.join(", ")}`)
  }
  const result = worldSchema.safeParse(raw)
  if (!result.success) throw new Error(`出征内容校验失败：\n${prettifyError(result.error)}`)
  const world = result.data

  const problems: string[] = []
  const issue = (path: (string | number)[], message: string) => problems.push(`✖ ${message}\n  → at ${path.join(".")}`)

  for (const [tableId, table] of Object.entries(world.rewards)) {
    const base = ["rewards", tableId]
    checkRewardPacks(table.fixed, [...base, "fixed"], issue)
    checkRewardPacks(table.firstClear, [...base, "firstClear"], issue)
    table.random?.entries.forEach((entry, i) => checkRewardPacks(entry.reward, [...base, "random", "entries", i, "reward"], issue))
    for (const [stars, reward] of Object.entries(table.starBonus ?? {})) {
      checkRewardPacks(reward, [...base, "starBonus", stars], issue)
    }
  }

  for (const [storyId, story] of Object.entries(world.stories)) {
    story.lines.forEach((line, i) => {
      if (!("choice" in line)) return
      line.choice.forEach((choice, j) => {
        if (choice.set.some((f, k) => choice.set.indexOf(f) !== k)) issue(["stories", storyId, "lines", i, "choice", j, "set"], "同一个选项里标记重复")
      })
    })
  }

  for (const [mapId, map] of Object.entries(world.maps)) {
    const base = ["maps", mapId]
    if ((map.kind === "main" || map.kind === "season") && map.staminaCost !== 0) {
      issue([...base, "staminaCost"], "主线和赛季地图不消耗体力，staminaCost 必须是 0")
    }
    if (!map.nodes[map.start]) issue([...base, "start"], `起点 ${map.start} 不存在`)
    if (map.rewards && !world.rewards[map.rewards]) issue([...base, "rewards"], `掉落表 ${map.rewards} 不存在`)

    for (const [nodeId, node] of Object.entries(map.nodes)) {
      const path = [...base, "nodes", nodeId]
      node.next.forEach((next, i) => {
        if (!map.nodes[next]) issue([...path, "next", i], `下一个节点 ${next} 不存在`)
        if (node.next.indexOf(next) !== i) issue([...path, "next", i], `下一个节点 ${next} 重复`)
        if (next === map.start) issue([...path, "next", i], "不能走回起点")
      })
      if (node.next.length > 0 && node.next.every((next) => map.nodes[next]?.requires)) {
        issue([...path, "next"], "后面的节点全都有 requires，没满足条件时会卡死；至少留一条不需要标记的路")
      }
      if ((node.type === "battle" || node.type === "boss") && !battle.encounters[node.encounter]) {
        issue([...path, "encounter"], `遭遇 ${node.encounter} 不存在`)
      }
      if ("rewards" in node && node.rewards && !world.rewards[node.rewards]) {
        issue([...path, "rewards"], `掉落表 ${node.rewards} 不存在`)
      }
      if (node.type === "story" && !world.stories[node.story]) issue([...path, "story"], `剧情 ${node.story} 不存在`)
    }

    if (problems.length > 0 || !map.nodes[map.start]) continue

    const cycle = findCycle(map.nodes, map.start)
    if (cycle) issue([...base, "nodes", cycle], `节点 ${cycle} 在环上；地图必须是单向的`)
    const seen = reachable(map.nodes, map.start)
    for (const nodeId of Object.keys(map.nodes)) {
      if (!seen.has(nodeId)) issue([...base, "nodes", nodeId], `节点 ${nodeId} 从起点走不到`)
    }
    if (![...seen].some((nodeId) => map.nodes[nodeId]!.next.length === 0)) issue([...base, "nodes"], "地图没有终点（next 为空的节点）")

    const settable = settableFlags(map, world.stories)
    for (const [nodeId, node] of Object.entries(map.nodes)) {
      if (node.requires && !settable.has(node.requires.flag)) {
        issue([...base, "nodes", nodeId, "requires"], `标记 ${node.requires.flag} 没有任何剧情能设置`)
      }
    }
  }

  if (problems.length > 0) throw new Error(`出征内容校验失败：\n${problems.join("\n")}`)
  return world
}

// ---------- 地图查询（服务端和前端都用） ----------

export function isTerminal(map: MapDef, nodeId: string): boolean {
  return (map.nodes[nodeId]?.next.length ?? 0) === 0
}

/** 从某个节点出发现在能走到的下一个节点：满足 requires 的 */
export function availableNext(map: MapDef, nodeId: string, flags: readonly string[]): string[] {
  const node = map.nodes[nodeId]
  if (!node) return []
  return node.next.filter((next) => {
    const need = map.nodes[next]?.requires?.flag
    return !need || flags.includes(need)
  })
}

export function isFightNode(node: MapNode | undefined): node is Extract<MapNode, { type: "battle" | "boss" }> {
  return node?.type === "battle" || node?.type === "boss"
}

/** 这张图所有战斗节点拿满星是多少 */
export function maxMapStars(map: MapDef): number {
  return Object.values(map.nodes).filter(isFightNode).length * 3
}

/** 地图里有没有运行时还不支持的节点（槽位要先展开，事件还没做） */
export function unsupportedNode(map: MapDef): string | null {
  for (const [nodeId, node] of Object.entries(map.nodes)) {
    if (node.type === "slot") return `节点 ${nodeId} 是槽位，要先由生成器展开`
    if (node.type === "event") return `节点 ${nodeId} 是事件，事件节点还没有运行时支持`
  }
  return null
}
