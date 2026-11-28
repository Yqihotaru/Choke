import { prettifyError, z } from "zod"

import { CONTENT, MYSTERY_PACK_ID, type FeatureId } from "../content"
import { mailAttachmentSchema } from "../mail"
import type { BattleContent } from "../battle/content"
import { DEFAULT_HP_MULT, DEFAULT_LOOT_MULT, DEFAULT_THRESHOLDS, MAX_THREAT, TIER_COUNT } from "./difficulty"

/**
 * 出征内容：地图（maps/*.json）、掉落表（rewards/*.json）、剧情（stories/*.json）。
 * 文件名就是 id。这里只做校验和组装，不读磁盘——服务端读文件后交给 parseWorldContent。
 */

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, "id 只能用字母、数字和连字符")
const int = z.number().int()

// ---------- 奖励 / 掉落表 ----------

/**
 * 一份奖励：邮件附件能装的东西，加上玩家经验和途中经验。
 * cardExp 是出征的每一张卡各得多少（途中经验，重复打也有）。
 */
export const rewardSchema = mailAttachmentSchema.extend({
  playerExp: int.min(1).max(1_000_000).optional(),
  cardExp: int.min(1).max(1_000_000).optional(),
})

/** 首通奖励才能带经验池：重复打只给途中经验，不能有经验肥图 */
export const firstClearRewardSchema = rewardSchema.extend({
  expPool: int.min(1).max(1_000_000).optional(),
})
export type Reward = z.infer<typeof firstClearRewardSchema>

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
  firstClear: firstClearRewardSchema.optional(),
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

// ---------- 事件 ----------

/** 威胁值一次最多加减多少；事件选项和格子共用 */
const threatDelta = int.min(-20).max(20)

/**
 * 事件的一个选项。只允许这四件事（白名单，写别的字段会被拒绝）：
 * 加减威胁值、按比例扣队伍血、给奖励、设标记。
 */
export const eventOptionSchema = z.strictObject({
  text: z.string().min(1),
  threat: threatDelta.optional(),
  /** 扣队伍最大生命的比例；最多扣到剩 5%，不会直接打死 */
  hpLossPct: z.number().min(0).max(0.5).optional(),
  reward: rewardSchema.optional(),
  set: z.array(flag).default([]),
})
export type EventOption = z.infer<typeof eventOptionSchema>

export const mapEventSchema = z.strictObject({
  title: z.string().min(1),
  text: z.string().min(1),
  options: z.array(eventOptionSchema).min(2).max(4),
})
export type MapEvent = z.infer<typeof mapEventSchema>

// ---------- 地图 ----------

export const MAP_KINDS = ["main", "season", "weekly", "daily"] as const
export type MapKind = (typeof MAP_KINDS)[number]

const nodeBase = {
  /** 画地图用的坐标，服务端不关心 */
  pos: z.tuple([z.number(), z.number()]).optional(),
  title: z.string().optional(),
  /** 分叉选择卡片上的一句话提示（"前方信号平稳"这类）；不写就按节点类型显示默认文案 */
  hint: z.string().min(1).max(60).optional(),
  next: z.array(id).max(6).default([]),
  /** 进这个节点需要先设置过的标记 */
  requires: z.strictObject({ flag }).optional(),
  /** 走进这个格子时威胁值加减多少（可正可负）；只有大地图格子才改难度，普通战斗打赢不涨 */
  threat: threatDelta.optional(),
}

export const mapNodeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("battle"), encounter: id, rewards: id.optional(), ...nodeBase }),
  z.strictObject({ type: z.literal("boss"), encounter: id, rewards: id.optional(), ...nodeBase }),
  z.strictObject({ type: z.literal("story"), story: id, ...nodeBase }),
  z.strictObject({ type: z.literal("treasure"), rewards: id, ...nodeBase }),
  /** 休息：队伍血量回满 */
  z.strictObject({ type: z.literal("rest"), ...nodeBase }),
  /** 空地：走到就自动通过，什么都不发生；只用来把路线拉长 */
  z.strictObject({ type: z.literal("empty"), ...nodeBase }),
  z.strictObject({ type: z.literal("branch"), prompt: z.string().optional(), ...nodeBase }),
  /** 事件：弹出选项，玩家选一个（效果见 mapEventSchema） */
  z.strictObject({ type: z.literal("event"), event: id, ...nodeBase }),
  /** 槽位：由地图生成器在开始出征前换成具体节点，见 4B */
  z.strictObject({ type: z.literal("slot"), pool: id, ...nodeBase }),
])

const slotHint = z.string().min(1).max(60).optional()

/** 槽位池里的候选节点：只决定「这个格子是什么」，位置、下一跳、前置条件都沿用槽位本身 */
export const slotNodeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("battle"), encounter: id, rewards: id.optional(), title: z.string().optional(), hint: slotHint, threat: threatDelta.optional() }),
  z.strictObject({ type: z.literal("boss"), encounter: id, rewards: id.optional(), title: z.string().optional(), hint: slotHint, threat: threatDelta.optional() }),
  z.strictObject({ type: z.literal("treasure"), rewards: id, title: z.string().optional(), hint: slotHint, threat: threatDelta.optional() }),
  z.strictObject({ type: z.literal("rest"), title: z.string().optional(), hint: slotHint, threat: threatDelta.optional() }),
])
export type SlotNode = z.infer<typeof slotNodeSchema>

export const slotEntrySchema = z.strictObject({
  weight: int.min(1).max(1_000_000).default(1),
  node: slotNodeSchema,
})
export type SlotEntry = z.infer<typeof slotEntrySchema>

const weightedEncounterSchema = z.strictObject({
  encounter: id,
  weight: int.min(1).max(1_000_000).default(1),
  rewards: id.optional(),
})
export type WeightedEncounter = z.infer<typeof weightedEncounterSchema>

const weightedRewardSchema = z.strictObject({
  rewards: id,
  weight: int.min(1).max(1_000_000).default(1),
})
export type WeightedReward = z.infer<typeof weightedRewardSchema>

/**
 * 日常随机地图模板：不手写 nodes，按层现场生成一张单向无环图。
 * 第 1 层固定单起点（普通战），最后 1 层固定单终点（Boss），中间层按 branchRate 决定 1 个或 2 个节点。
 */
export const mapGeneratorSchema = z.strictObject({
  /** 总层数（含起点和终点 Boss），至少 3 层 */
  layers: int.min(3).max(15),
  /** 中间层出现 2 个并排节点的概率（0 = 一条直线，1 = 每层都分叉） */
  branchRate: z.number().min(0).max(1).default(0.5),
  /** 中间层各节点类型的权重；treasure > 0 时必须配 chests */
  weights: z
    .strictObject({
      battle: int.min(1).max(1000).default(6),
      rest: int.min(0).max(1000).default(2),
      treasure: int.min(0).max(1000).default(2),
      /** 空地（什么都不发生的格子）的权重；0 就不出现 */
      empty: int.min(0).max(1000).default(0),
    })
    .default({ battle: 6, rest: 2, treasure: 2, empty: 0 }),
  /** 普通战的默认掉落表（单个遭遇没写 rewards 时用它） */
  battleRewards: id.optional(),
  /** Boss 战的默认掉落表 */
  bossRewards: id.optional(),
  battles: z.array(weightedEncounterSchema).min(1).max(50),
  bosses: z.array(weightedEncounterSchema).min(1).max(30),
  chests: z.array(weightedRewardSchema).max(30).default([]),
  /**
   * 危险路线：中间层并排两个节点时，下面那个有 rate 的概率变成一场「危险路线」战斗，
   * 走进去威胁值 +threat（之后的战斗都更硬、掉落也更多）；可以额外配一张掉落表。不写就没有。
   */
  danger: z
    .strictObject({
      rate: z.number().min(0).max(1),
      threat: int.min(1).max(10),
      rewards: id.optional(),
    })
    .optional(),
})
export type MapGeneratorTemplate = z.infer<typeof mapGeneratorSchema>

/**
 * 难度配置：不写就用 difficulty.ts 里的默认值。
 * thresholds 是 4 个递增的威胁值，达到第 i 个升到 i+2 档；hpMult / lootMult 各 5 个数，对应 1–5 档。
 * lootMult 全写 1 就是这张图不按档位放大掉落。
 */
export const difficultySchema = z
  .strictObject({
    startThreat: int.min(0).max(MAX_THREAT).default(0),
    thresholds: z.array(int.min(1).max(MAX_THREAT)).length(TIER_COUNT - 1).default([...DEFAULT_THRESHOLDS]),
    hpMult: z.array(z.number().min(1).max(10)).length(TIER_COUNT).default([...DEFAULT_HP_MULT]),
    lootMult: z.array(z.number().min(0.1).max(10)).length(TIER_COUNT).default([...DEFAULT_LOOT_MULT]),
  })
  .superRefine((d, ctx) => {
    if (d.thresholds.some((at, i) => i > 0 && at <= d.thresholds[i - 1]!)) {
      ctx.addIssue({ code: "custom", path: ["thresholds"], message: "档位阈值必须严格递增" })
    }
    if (d.hpMult.some((m, i) => i > 0 && m < d.hpMult[i - 1]!)) {
      ctx.addIssue({ code: "custom", path: ["hpMult"], message: "血量倍率不能随档位下降" })
    }
  })

/** 通关目标（最多 3 个，每个算 1 颗星）：通关时档位 ≥ N，或者拿到某个标记 */
export const objectiveSchema = z.union([
  z.strictObject({ label: z.string().min(1).optional(), tierAtLeast: int.min(2).max(TIER_COUNT) }),
  z.strictObject({ label: z.string().min(1).optional(), flag }),
])
export type MapObjective = z.infer<typeof objectiveSchema>

export const mapSchema = z.strictObject({
  kind: z.enum(MAP_KINDS),
  name: z.string().min(1),
  summary: z.string().default(""),
  /** 出征前要选满几张卡（卡池） */
  deckSize: int.min(1).max(60),
  /** 手作图和周常骨架图的起点；日常生成图在生成后自动设为第 1 层节点 */
  start: id.default("n1"),
  nodes: z.record(id, mapNodeSchema).default({}),
  /** 周常骨架图的随机槽位池：poolId → 候选节点列表 */
  pools: z.record(id, z.array(slotEntrySchema).min(1).max(40)).optional(),
  /** 日常随机地图的生成模板；写了它就不能再手写 nodes */
  generate: mapGeneratorSchema.optional(),
  /** 通关奖励：整张图走到终点时发，掉落表 id */
  rewards: id.optional(),
  difficulty: difficultySchema.optional(),
  /** 写了通关目标：通关星数 = 达成的目标数（决定星级加成档位）；不写还是按战斗星数折算 */
  objectives: z.array(objectiveSchema).max(3).optional(),
  /** 开始这张图要先解锁的功能（unlocks.json 的 id）；不写就按 kind：main 看 mainline，season 看 season，日常和周常不设限 */
  unlock: id.optional(),
})
export type MapDef = z.infer<typeof mapSchema>
export type MapNode = z.infer<typeof mapNodeSchema>

const KIND_FEATURE: Partial<Record<MapKind, FeatureId>> = { main: "mainline", season: "season" }

/** 这张图要解锁哪个功能才能开始；没有限制返回 null */
export function mapFeature(map: Pick<MapDef, "kind" | "unlock">): FeatureId | null {
  return (map.unlock as FeatureId | undefined) ?? KIND_FEATURE[map.kind] ?? null
}

export interface WorldContent {
  maps: Record<string, MapDef>
  rewards: Record<string, RewardTable>
  stories: Record<string, Story>
  events: Record<string, MapEvent>
}

const worldSchema = z.strictObject({
  maps: z.record(id, mapSchema),
  rewards: z.record(id, rewardTableSchema),
  stories: z.record(id, storySchema),
  events: z.record(id, mapEventSchema),
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

/** 一张图里所有 story 节点、event 节点设置得出来的标记 */
function settableFlags(map: MapDef, stories: Record<string, Story>, events: Record<string, MapEvent>): Set<string> {
  const flags = new Set<string>()
  for (const node of Object.values(map.nodes)) {
    if (node.type === "story") {
      for (const line of stories[node.story]?.lines ?? []) {
        if ("choice" in line) for (const choice of line.choice) choice.set.forEach((f) => flags.add(f))
      }
    } else if (node.type === "event") {
      for (const option of events[node.event]?.options ?? []) option.set.forEach((f) => flags.add(f))
    }
  }
  return flags
}

/** 校验整份出征内容；失败直接抛错（服务端因此拒绝启动） */
export function parseWorldContent(
  raw: { maps: Record<string, unknown>; rewards: Record<string, unknown>; stories: Record<string, unknown>; events?: Record<string, unknown> },
  battle: BattleContent,
): WorldContent {
  const input = { ...raw, events: raw.events ?? {} }
  const badIds = (["maps", "rewards", "stories", "events"] as const).flatMap((dir) =>
    Object.keys(input[dir]).filter((key) => !id.safeParse(key).success).map((key) => `${dir}/${key}.json`),
  )
  if (badIds.length > 0) {
    throw new Error(`出征内容校验失败：文件名就是 id，只能用字母、数字和连字符：${badIds.join(", ")}`)
  }
  const result = worldSchema.safeParse(input)
  if (!result.success) throw new Error(`出征内容校验失败：\n${prettifyError(result.error)}`)
  const world = result.data

  const problems: string[] = []
  const issue = (path: (string | number)[], message: string) => problems.push(`✖ ${message}\n  → at ${path.join(".")}`)

  for (const [eventId, event] of Object.entries(world.events)) {
    event.options.forEach((option, i) => {
      const path = ["events", eventId, "options", i]
      checkRewardPacks(option.reward, [...path, "reward"], issue)
      if (option.set.some((f, k) => option.set.indexOf(f) !== k)) issue([...path, "set"], "同一个选项里标记重复")
    })
  }

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
    if (map.rewards && !world.rewards[map.rewards]) issue([...base, "rewards"], `掉落表 ${map.rewards} 不存在`)
    if (map.unlock && !Object.hasOwn(CONTENT.unlocks, map.unlock)) {
      issue([...base, "unlock"], `功能 ${map.unlock} 不在 unlocks.json 里`)
    }
    for (const [poolId, entries] of Object.entries(map.pools ?? {})) {
      entries.forEach((entry, i) => {
        const path = [...base, "pools", poolId, i, "node"]
        if ((entry.node.type === "battle" || entry.node.type === "boss") && !battle.encounters[entry.node.encounter]) {
          issue([...path, "encounter"], `遭遇 ${entry.node.encounter} 不存在`)
        }
        if ("rewards" in entry.node && entry.node.rewards && !world.rewards[entry.node.rewards]) {
          issue([...path, "rewards"], `掉落表 ${entry.node.rewards} 不存在`)
        }
      })
    }

    if (map.generate) {
      const gen = map.generate
      const genBase = [...base, "generate"]
      if (Object.keys(map.nodes).length > 0) {
        issue([...base, "nodes"], "写了 generate 生成模板的地图不能同时手写 nodes")
      }
      if (map.pools) issue([...base, "pools"], "写了 generate 生成模板的地图不需要 pools")
      if (gen.battleRewards && !world.rewards[gen.battleRewards]) {
        issue([...genBase, "battleRewards"], `掉落表 ${gen.battleRewards} 不存在`)
      }
      if (gen.bossRewards && !world.rewards[gen.bossRewards]) {
        issue([...genBase, "bossRewards"], `掉落表 ${gen.bossRewards} 不存在`)
      }
      if (gen.danger?.rewards && !world.rewards[gen.danger.rewards]) {
        issue([...genBase, "danger", "rewards"], `掉落表 ${gen.danger.rewards} 不存在`)
      }
      if (map.objectives?.some((o) => "flag" in o)) {
        issue([...base, "objectives"], "日常随机生成的地图没有剧情和事件，通关目标只能写档位，不能写标记")
      }
      gen.battles.forEach((entry, i) => {
        if (!battle.encounters[entry.encounter]) issue([...genBase, "battles", i, "encounter"], `遭遇 ${entry.encounter} 不存在`)
        if (entry.rewards && !world.rewards[entry.rewards]) issue([...genBase, "battles", i, "rewards"], `掉落表 ${entry.rewards} 不存在`)
      })
      gen.bosses.forEach((entry, i) => {
        if (!battle.encounters[entry.encounter]) issue([...genBase, "bosses", i, "encounter"], `遭遇 ${entry.encounter} 不存在`)
        if (entry.rewards && !world.rewards[entry.rewards]) issue([...genBase, "bosses", i, "rewards"], `掉落表 ${entry.rewards} 不存在`)
      })
      if (gen.weights.treasure > 0 && gen.chests.length === 0) {
        issue([...genBase, "chests"], "treasure 权重 > 0 时必须配置 chests 宝箱掉落池")
      }
      gen.chests.forEach((entry, i) => {
        if (!world.rewards[entry.rewards]) issue([...genBase, "chests", i, "rewards"], `掉落表 ${entry.rewards} 不存在`)
      })
      continue
    }

    if (!map.nodes[map.start]) issue([...base, "start"], `起点 ${map.start} 不存在`)

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
      if (node.type === "event" && !world.events[node.event]) issue([...path, "event"], `事件 ${node.event} 不存在`)
      if (node.type === "slot" && !map.pools?.[node.pool]) {
        issue([...path, "pool"], `槽位池 ${node.pool} 不存在`)
      }
    }

    if (problems.length > 0 || !map.nodes[map.start]) continue

    const cycle = findCycle(map.nodes, map.start)
    if (cycle) issue([...base, "nodes", cycle], `节点 ${cycle} 在环上；地图必须是单向的`)
    const seen = reachable(map.nodes, map.start)
    for (const nodeId of Object.keys(map.nodes)) {
      if (!seen.has(nodeId)) issue([...base, "nodes", nodeId], `节点 ${nodeId} 从起点走不到`)
    }
    if (![...seen].some((nodeId) => map.nodes[nodeId]!.next.length === 0)) issue([...base, "nodes"], "地图没有终点（next 为空的节点）")

    const settable = settableFlags(map, world.stories, world.events)
    for (const [nodeId, node] of Object.entries(map.nodes)) {
      if (node.requires && !settable.has(node.requires.flag)) {
        issue([...base, "nodes", nodeId, "requires"], `标记 ${node.requires.flag} 没有任何剧情或事件能设置`)
      }
    }
    map.objectives?.forEach((objective, i) => {
      if ("flag" in objective && !settable.has(objective.flag)) {
        issue([...base, "objectives", i, "flag"], `标记 ${objective.flag} 没有任何剧情或事件能设置`)
      }
    })
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

/**
 * 这张图有几场战斗（已展开的成品图直接数 battle/boss；
 * 还没展开的日常模板按层数给代表值，周常槽位池若含战斗也算 1 场，给列表页展示用）。
 */
export function countMapFights(map: MapDef): number {
  if (map.generate) {
    const { layers, weights } = map.generate
    const total = weights.battle + weights.rest + weights.treasure + weights.empty
    return layers - Math.round(((layers - 2) * weights.empty) / total)
  }
  let count = 0
  for (const node of Object.values(map.nodes)) {
    if (isFightNode(node)) count += 1
    else if (node.type === "slot") {
      const pool = map.pools?.[node.pool] ?? []
      if (pool.some((entry) => entry.node.type === "battle" || entry.node.type === "boss")) count += 1
    }
  }
  return count
}

/** 这张图所有战斗节点拿满星是多少 */
export function maxMapStars(map: MapDef): number {
  return countMapFights(map) * 3
}

/** 地图里有没有运行时还不支持的节点（槽位在开始出征时由生成器展开，没展开的不能跑） */
export function unsupportedNode(map: MapDef): string | null {
  for (const [nodeId, node] of Object.entries(map.nodes)) {
    if (node.type === "slot") return `节点 ${nodeId} 是槽位，要先由生成器展开`
  }
  return null
}

