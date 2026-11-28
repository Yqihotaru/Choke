import { prettifyError, z } from "zod"

import { CONTENT } from "./content"
import type { WorldContent } from "./expedition/content"

/**
 * 离线补给箱：内容格式和计算规则。内容写在 content/supply.json，设计见 Design/补给箱系统 v0.1.md。
 * 这里只放纯规则，不碰数据库；服务端在 apps/api/src/supply.ts 里读写。
 *
 * 每个箱子有一个"每小时产出的价值"，按各资源的占比和折算价换成数量；
 * 选了倾向，倾向的资源占 focusShare%，其余按原占比分剩下的。总价值始终不变。
 */

/** 补给箱只给走量卡包：L 及以上三档加起来超过这个百分比的包、活动包都不能进箱子（设计文档 §2.4） */
export const SUPPLY_PACK_HIGH_RARITY_MAX_PERCENT = 2

function highRarityPercent(weights: Partial<Record<string, number>>): number {
  const total = Object.values(weights).reduce<number>((sum, w) => sum + (w ?? 0), 0)
  const high = (weights.L ?? 0) + (weights.Mythic ?? 0) + (weights.Prismatic ?? 0)
  return total > 0 ? (high / total) * 100 : 0
}

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, "id 只能用字母、数字和连字符")
const common = { id, name: z.string().min(1), worth: z.number().positive(), share: z.number().positive() }

export const supplyResourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...common, kind: z.literal("coins") }),
  z.strictObject({ ...common, kind: z.literal("pack"), pool: id }),
  z.strictObject({ ...common, kind: z.literal("expPool") }),
  z.strictObject({ ...common, kind: z.literal("item"), itemId: id }),
])
export type SupplyResource = z.infer<typeof supplyResourceSchema>

export const supplyBoxSchema = z.strictObject({
  name: z.string().min(1),
  summary: z.string().default(""),
  /** 解锁条件：通关某张主线地图；不写就是一开始（完成新手引导后）就有 */
  unlock: z.strictObject({ map: id.optional() }).default({}),
  /** 离线最多攒多少小时 */
  capHours: z.number().int().min(1).max(24 * 14),
  /** 每小时产出多少"价值"（折算后的统一单位） */
  valuePerHour: z.number().positive(),
  /** 选了倾向的资源占总价值的百分比；必须比任何资源的原占比都大 */
  focusShare: z.number().int().min(51).max(95),
  resources: z.array(supplyResourceSchema).min(2).max(8),
})
export type SupplyBox = z.infer<typeof supplyBoxSchema>

export const supplySchema = z.strictObject({ boxes: z.record(id, supplyBoxSchema) })
export type SupplyContent = z.infer<typeof supplySchema>

/** 校验 content/supply.json：格式、资源 id 不重复、卡包 / 道具 / 地图存在、倾向占比合理 */
export function parseSupplyContent(raw: unknown, world: Pick<WorldContent, "maps">): SupplyContent {
  const result = supplySchema.safeParse(raw)
  if (!result.success) throw new Error(`content/supply.json 校验失败：\n${prettifyError(result.error)}`)
  const content = result.data

  const problems: string[] = []
  for (const [boxId, box] of Object.entries(content.boxes)) {
    const at = `boxes.${boxId}`
    const map = box.unlock.map
    if (map !== undefined) {
      const def = world.maps[map]
      if (!def) problems.push(`${at}.unlock.map：地图 ${map} 不存在`)
      else if (def.kind !== "main") problems.push(`${at}.unlock.map：${map} 不是主线地图`)
    }
    const seen = new Set<string>()
    const totalShare = box.resources.reduce((sum, r) => sum + r.share, 0)
    for (const [i, r] of box.resources.entries()) {
      const rAt = `${at}.resources[${i}]`
      if (seen.has(r.id)) problems.push(`${rAt}：资源 id ${r.id} 重复`)
      seen.add(r.id)
      if (r.kind === "pack") {
        if (!Object.hasOwn(CONTENT.packs.packs, r.pool)) problems.push(`${rAt}.pool：卡包 ${r.pool} 不存在`)
        else {
          const pack = CONTENT.packs.packs[r.pool as keyof typeof CONTENT.packs.packs]
          if (pack.event) problems.push(`${rAt}.pool：${r.pool} 是活动包，补给箱不给`)
          else if (highRarityPercent(pack.weights) > SUPPLY_PACK_HIGH_RARITY_MAX_PERCENT) {
            problems.push(`${rAt}.pool：${r.pool} 的 L 及以上占比超过 ${SUPPLY_PACK_HIGH_RARITY_MAX_PERCENT}%，补给箱只给走量包`)
          }
        }
      }
      if (r.kind === "item" && !Object.hasOwn(CONTENT.items, r.itemId)) problems.push(`${rAt}.itemId：物品 ${r.itemId} 不存在`)
      if ((r.share / totalShare) * 100 >= box.focusShare) {
        problems.push(`${rAt}：原占比不能达到或超过倾向占比 ${box.focusShare}%，否则选倾向没有意义`)
      }
    }
  }
  // 同一个资源 id 在不同箱子里必须是同一种东西、同一个折算价：倾向按资源 id 选，折算价不能各说各的
  const first = new Map<string, SupplyResource>()
  for (const [boxId, box] of Object.entries(content.boxes)) {
    for (const r of box.resources) {
      const base = first.get(r.id)
      if (!base) first.set(r.id, r)
      else if (JSON.stringify({ ...base, share: 0 }) !== JSON.stringify({ ...r, share: 0 })) {
        problems.push(`boxes.${boxId}：资源 ${r.id} 和别的箱子里的定义不一致（种类、名字、折算价必须相同，只有占比可以不同）`)
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`content/supply.json 校验失败：\n${problems.map((p) => `  ${p}`).join("\n")}`)
  }
  return content
}

// ---------- 计算 ----------

const HOUR_MS = 3_600_000
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** 一个玩家一个箱子的存档；stock 是已结算但还没领的数量（可以带小数，领的时候只发整数部分） */
export interface SupplyState {
  /** 从这一刻起继续攒（上次领取或改倾向的时刻） */
  accruedFrom: number
  /** stock 里已经折算了多少小时，和新攒的小时合起来受封顶约束 */
  stockHours: number
  stock: Record<string, number>
  focus: string | null
}

/** 各资源的价值占比，加起来为 1。focus 为 null 就按原占比 */
export function resourceShares(box: SupplyBox, focus: string | null): Record<string, number> {
  const total = box.resources.reduce((sum, r) => sum + r.share, 0)
  const picked = focus === null ? undefined : box.resources.find((r) => r.id === focus)
  const rest = picked ? total - picked.share : total
  const out: Record<string, number> = {}
  for (const r of box.resources) {
    out[r.id] = picked ? (r === picked ? box.focusShare / 100 : ((1 - box.focusShare / 100) * r.share) / rest) : r.share / total
  }
  return out
}

/** 这段时间新攒了多少小时：不能为负，也不能让总小时数超过封顶 */
export function newHours(box: SupplyBox, state: SupplyState, nowMs: number): number {
  const elapsed = Math.max(0, (nowMs - state.accruedFrom) / HOUR_MS)
  return Math.max(0, Math.min(elapsed, box.capHours - state.stockHours))
}

/** 攒了 hours 小时、按 focus 倾向，每种资源是多少（带小数） */
export function amountsFor(box: SupplyBox, hours: number, focus: string | null): Record<string, number> {
  const shares = resourceShares(box, focus)
  const out: Record<string, number> = {}
  for (const r of box.resources) out[r.id] = (hours * box.valuePerHour * shares[r.id]!) / r.worth
  return out
}

/** 存货加新攒的，按当前倾向算出每种资源总共多少（带小数）；存货里的旧资源 id 已不在内容里就丢掉 */
export function totalsOf(box: SupplyBox, state: SupplyState, nowMs: number): Record<string, number> {
  const fresh = amountsFor(box, newHours(box, state, nowMs), state.focus)
  const out: Record<string, number> = {}
  for (const r of box.resources) out[r.id] = round6((state.stock[r.id] ?? 0) + (fresh[r.id] ?? 0))
  return out
}

/** 现在能领多少：每种资源取整数部分 */
export function payoutOf(box: SupplyBox, state: SupplyState, nowMs: number): Record<string, number> {
  const totals = totalsOf(box, state, nowMs)
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(totals)) out[key] = Math.floor(value + 1e-9)
  return out
}

/** 把已攒的按当前倾向结算进存货，从 now 重新开始攒。改倾向前必须先结算，否则能套利 */
export function settle(box: SupplyBox, state: SupplyState, nowMs: number): SupplyState {
  return {
    accruedFrom: nowMs,
    stockHours: round6(state.stockHours + newHours(box, state, nowMs)),
    stock: totalsOf(box, state, nowMs),
    focus: state.focus,
  }
}

/** 领完之后：整数部分发走，小数部分留着，小时清零，从 now 重新攒 */
export function afterClaim(box: SupplyBox, state: SupplyState, nowMs: number): SupplyState {
  const totals = totalsOf(box, state, nowMs)
  const pay = payoutOf(box, state, nowMs)
  const stock: Record<string, number> = {}
  for (const [key, value] of Object.entries(totals)) {
    const left = round6(value - (pay[key] ?? 0))
    if (left > 0) stock[key] = left
  }
  return { accruedFrom: nowMs, stockHours: 0, stock, focus: state.focus }
}

// ---------- 接口返回的形状（服务端和前端共用） ----------

export interface SupplyResourceView {
  id: string
  kind: SupplyResource["kind"]
  /** 给玩家看的名字：金币、普通卡包、经验池…… */
  label: string
  /** 现在能领的整数数量 */
  amount: number
  /** 按当前倾向，每天大约产出多少 */
  perDay: number
  /** 价值占比（百分数，按当前倾向） */
  sharePercent: number
}

export interface SupplyBoxView {
  id: string
  name: string
  summary: string
  locked: boolean
  lockedReason?: string
  capHours: number
  /** 已攒的小时数（含已结算的），最多到封顶 */
  hours: number
  full: boolean
  /** 当前倾向的资源 id；null 是不偏 */
  focus: string | null
  /** 选倾向后，倾向资源占总价值的百分数 */
  focusSharePercent: number
  resources: SupplyResourceView[]
}

export interface SupplyView {
  boxes: SupplyBoxView[]
  /** 至少有一个箱子现在能领到东西 */
  canClaim: boolean
  serverTime: string
}

export interface SupplyGain {
  boxId: string
  resourceId: string
  kind: SupplyResource["kind"]
  label: string
  count: number
}
