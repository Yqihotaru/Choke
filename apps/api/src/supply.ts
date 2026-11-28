import { eq, and } from "drizzle-orm"

import type { ItemId } from "@choke/shared/items"
import {
  afterClaim,
  newHours,
  payoutOf,
  resourceShares,
  settle,
  totalsOf,
  type SupplyBox,
  type SupplyBoxView,
  type SupplyGain,
  type SupplyState,
  type SupplyView,
} from "@choke/shared/supply"

import { SUPPLY_CONTENT, WORLD_CONTENT } from "./content"
import { addExpPool } from "./card-exp"
import { db } from "./db/client"
import { mapClears, supplyBoxes, supplyPrefs, users } from "./db/schema"
import { grantAttachment } from "./rewards"
import { TxAbort, lockUser, type Tx } from "./tx"

/**
 * 离线补给箱的服务端：数据怎么存、怎么领、怎么改倾向。规则（怎么算）在 packages/shared/src/supply.ts。
 * 只信服务器时间，所以每个入口都带 now（毫秒），测试可以拨时间。
 * 领取和改倾向都先 lockUser，重复点、并发点只会生效一次。
 */

const BOXES = Object.entries(SUPPLY_CONTENT.boxes)

type Reader = Tx | typeof db

interface Loaded {
  tutorialDone: boolean
  focus: string | null
  /** 已经有存档的箱子 */
  states: Map<string, SupplyState>
}

async function load(exec: Reader, userId: string): Promise<Loaded> {
  const [user] = await exec.select({ tutorialDone: users.tutorialDone }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new TxAbort(404, "not_found", "用户不存在")
  const [prefs] = await exec.select({ focus: supplyPrefs.focus }).from(supplyPrefs).where(eq(supplyPrefs.userId, userId)).limit(1)
  const focus = prefs?.focus ?? null
  const rows = await exec.select().from(supplyBoxes).where(eq(supplyBoxes.userId, userId))
  const states = new Map<string, SupplyState>()
  for (const row of rows) {
    if (!Object.hasOwn(SUPPLY_CONTENT.boxes, row.boxId)) continue
    states.set(row.boxId, { accruedFrom: row.accruedFrom.getTime(), stockHours: row.stockHours, stock: row.stock, focus })
  }
  return { tutorialDone: user.tutorialDone, focus, states }
}

/**
 * 给刚满足解锁条件的箱子建存档：从解锁那一刻开始攒，不补发解锁之前的。
 * 完成新手引导之前一个箱子都不攒。重复调用安全（已有存档的不动）。
 */
async function openNewBoxes(exec: Reader, userId: string, loaded: Loaded, now: number): Promise<void> {
  if (!loaded.tutorialDone) return
  const created: { userId: string; boxId: string; accruedFrom: Date }[] = []
  for (const [boxId, box] of BOXES) {
    if (loaded.states.has(boxId)) continue
    let from = now
    if (box.unlock.map) {
      const [clear] = await exec
        .select({ at: mapClears.firstClearedAt })
        .from(mapClears)
        .where(and(eq(mapClears.userId, userId), eq(mapClears.mapId, box.unlock.map)))
        .limit(1)
      if (!clear) continue
      from = Math.min(clear.at.getTime(), now)
    }
    created.push({ userId, boxId, accruedFrom: new Date(from) })
    loaded.states.set(boxId, { accruedFrom: from, stockHours: 0, stock: {}, focus: loaded.focus })
  }
  if (created.length > 0) await exec.insert(supplyBoxes).values(created).onConflictDoNothing()
}

function lockedReasonOf(box: SupplyBox): string {
  const map = box.unlock.map ? WORLD_CONTENT.maps[box.unlock.map] : undefined
  return map ? `通关「${map.name}」后解锁` : "完成新手引导后解锁"
}

function boxView(boxId: string, box: SupplyBox, state: SupplyState | undefined, now: number): SupplyBoxView {
  const base = { id: boxId, name: box.name, summary: box.summary, capHours: box.capHours, focusSharePercent: box.focusShare }
  const focus = state?.focus ?? null
  const shares = resourceShares(box, focus)
  const perDay = (r: SupplyBox["resources"][number]) => Math.round(((24 * box.valuePerHour * shares[r.id]!) / r.worth) * 100) / 100
  if (!state) {
    return {
      ...base,
      locked: true,
      lockedReason: lockedReasonOf(box),
      hours: 0,
      full: false,
      focus,
      resources: box.resources.map((r) => ({
        id: r.id,
        kind: r.kind,
        label: r.name,
        amount: 0,
        perDay: perDay(r),
        sharePercent: Math.round(shares[r.id]! * 100),
      })),
    }
  }
  const pay = payoutOf(box, state, now)
  const hours = Math.min(box.capHours, state.stockHours + newHours(box, state, now))
  return {
    ...base,
    locked: false,
    hours: Math.round(hours * 100) / 100,
    full: hours >= box.capHours - 1e-9,
    focus,
    resources: box.resources.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.name,
      amount: pay[r.id] ?? 0,
      perDay: perDay(r),
      sharePercent: Math.round(shares[r.id]! * 100),
    })),
  }
}

function viewOf(loaded: Loaded, now: number): SupplyView {
  const boxes = BOXES.map(([boxId, box]) => boxView(boxId, box, loaded.states.get(boxId), now))
  return {
    boxes,
    canClaim: boxes.some((b) => !b.locked && b.resources.some((r) => r.amount > 0)),
    serverTime: new Date(now).toISOString(),
  }
}

/** 已解锁箱子里能选的倾向资源（按资源 id 去重） */
function focusOptions(loaded: Loaded): { id: string; label: string }[] {
  const out = new Map<string, string>()
  for (const [boxId, box] of BOXES) {
    if (!loaded.states.has(boxId)) continue
    for (const r of box.resources) out.set(r.id, r.name)
  }
  return [...out].map(([id, label]) => ({ id, label }))
}

export type SupplyViewWithFocus = SupplyView & { focus: string | null; focusOptions: { id: string; label: string }[] }

function withFocus(loaded: Loaded, now: number): SupplyViewWithFocus {
  return { ...viewOf(loaded, now), focus: loaded.focus, focusOptions: focusOptions(loaded) }
}

async function saveState(tx: Tx, userId: string, boxId: string, state: SupplyState): Promise<void> {
  await tx
    .update(supplyBoxes)
    .set({ accruedFrom: new Date(state.accruedFrom), stockHours: state.stockHours, stock: state.stock })
    .where(and(eq(supplyBoxes.userId, userId), eq(supplyBoxes.boxId, boxId)))
}

/** 看现在的补给箱。只可能新建刚解锁的存档，不改任何已攒的数量 */
export async function getSupply(userId: string, now: number): Promise<SupplyViewWithFocus> {
  return db.transaction(async (tx) => {
    const loaded = await load(tx, userId)
    await openNewBoxes(tx, userId, loaded, now)
    return withFocus(loaded, now)
  })
}

/** 一键领取所有已解锁箱子；什么都没攒到（连 1 个整数都不够）就拒绝，不重置计时 */
export async function claimSupply(
  userId: string,
  now: number,
): Promise<{ gains: SupplyGain[]; supply: SupplyViewWithFocus }> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId)
    const loaded = await load(tx, userId)
    await openNewBoxes(tx, userId, loaded, now)

    const gains: SupplyGain[] = []
    const next = new Map<string, SupplyState>()
    for (const [boxId, box] of BOXES) {
      const state = loaded.states.get(boxId)
      if (!state) continue
      const pay = payoutOf(box, state, now)
      for (const r of box.resources) {
        const count = pay[r.id] ?? 0
        if (count > 0) gains.push({ boxId, resourceId: r.id, kind: r.kind, label: r.name, count })
      }
      next.set(boxId, afterClaim(box, state, now))
    }
    if (gains.length === 0) throw new TxAbort(400, "nothing_to_claim", "补给箱里还没攒到东西，过一会儿再来")

    const attachment: Parameters<typeof grantAttachment>[2] = { coins: 0, packs: [], items: [] }
    let expPool = 0
    for (const gain of gains) {
      const resource = SUPPLY_CONTENT.boxes[gain.boxId]!.resources.find((r) => r.id === gain.resourceId)!
      if (resource.kind === "coins") attachment.coins = (attachment.coins ?? 0) + gain.count
      else if (resource.kind === "pack") attachment.packs!.push({ pool: resource.pool, count: gain.count })
      else if (resource.kind === "item") attachment.items!.push({ itemId: resource.itemId as ItemId, count: gain.count })
      else expPool += gain.count
    }
    const origin = { source: "supply-box", sourceRef: `claim@${new Date(now).toISOString()}` }
    await grantAttachment(tx, userId, attachment, origin)
    await addExpPool(tx, userId, expPool, origin)

    for (const [boxId, state] of next) {
      await saveState(tx, userId, boxId, state)
      loaded.states.set(boxId, state)
    }
    return { gains, supply: withFocus(loaded, now) }
  })
}

/**
 * 改倾向：先把每个箱子已攒的按旧倾向结算进存货，再换倾向、从现在起按新倾向攒。
 * 不这么做的话，攒满了再改成最值钱的资源就能白拿。focus 为 null 是取消倾向。
 */
export async function setSupplyFocus(userId: string, focus: string | null, now: number): Promise<SupplyViewWithFocus> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId)
    const loaded = await load(tx, userId)
    await openNewBoxes(tx, userId, loaded, now)

    if (focus !== null && !focusOptions(loaded).some((o) => o.id === focus)) {
      throw new TxAbort(400, "bad_focus", "这个倾向还没解锁，或者不存在")
    }
    if (focus === loaded.focus) return withFocus(loaded, now)

    for (const [boxId, box] of BOXES) {
      const state = loaded.states.get(boxId)
      if (!state) continue
      const settled = settle(box, state, now)
      await saveState(tx, userId, boxId, settled)
      loaded.states.set(boxId, { ...settled, focus })
    }
    await tx
      .insert(supplyPrefs)
      .values({ userId, focus })
      .onConflictDoUpdate({ target: supplyPrefs.userId, set: { focus, updatedAt: new Date(now) } })
    loaded.focus = focus
    return withFocus(loaded, now)
  })
}

export { totalsOf }
