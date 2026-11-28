/**
 * 离线补给箱的测试：规则（占比、封顶、改倾向不能套利）、内容校验、
 * 服务端（解锁、领取、账本、并发只发一次、改倾向先结算）。用临时 PGlite 数据库。
 *
 *   pnpm exec tsx scripts/test-supply.ts
 */
import assert from "node:assert/strict"

import { setupTestDb } from "./test-db"

const dropTestDb = await setupTestDb("supply")

const { eq } = await import("drizzle-orm")
const { default: Fastify } = await import("fastify")
const { default: cookie } = await import("@fastify/cookie")
const { db } = await import("../src/db/client")
const { users, userPacks, ledgerEntries, mapClears } = await import("../src/db/schema")
const { COOKIE_NAME, makeSession } = await import("../src/auth/osu")
const { handleError } = await import("../src/error-handler")
const { SUPPLY_CONTENT, WORLD_CONTENT } = await import("../src/content")
const shared = await import("@choke/shared/supply")

// 给测试加一个要通关序章才开的箱子：必须赶在 supply 模块被加载之前
const MAIN = SUPPLY_CONTENT.boxes.prologue!
SUPPLY_CONTENT.boxes["t-gated"] = {
  name: "测试经验箱",
  summary: "",
  unlock: { map: "story-prologue" },
  capHours: 72,
  valuePerHour: 10,
  focusShare: 70,
  resources: [
    { id: "coins", kind: "coins", name: "金币", worth: 1, share: 50 },
    { id: "exp", kind: "expPool", name: "经验池", worth: 1, share: 50 },
  ],
}
const { getSupply, claimSupply, setSupplyFocus } = await import("../src/supply")
const { supplyRoutes } = await import("../src/routes/supply")

const app = Fastify()
app.setErrorHandler(handleError)
await app.register(cookie)
await app.register(supplyRoutes)
await app.ready()

let passed = 0
async function cleanup() {
  await app.close().catch(() => {})
  await dropTestDb()
}
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    console.error(`FAIL  ${name}`)
    console.error(error)
    await cleanup()
    process.exit(1)
  }
}
const rejects = async (fn: () => Promise<unknown>, code: string) => {
  try {
    await fn()
  } catch (error) {
    assert.equal((error as { code?: string }).code, code, String(error))
    return
  }
  assert.fail(`应该被拒绝：${code}`)
}

const HOUR = 3_600_000
const T0 = Date.parse("2026-11-28T00:00:00Z")
let seq = 0
async function newUser(patch: Partial<typeof users.$inferInsert> = {}) {
  seq += 1
  const id = `supply-test-${seq}`
  await db.insert(users).values({ id, username: id, email: `${id}@test.local`, osuId: 900_000 + seq, tutorialDone: true, coins: 0, ...patch })
  return id
}
const coinsOf = async (id: string) => (await db.select({ c: users.coins }).from(users).where(eq(users.id, id)))[0]!.c
const poolOf = async (id: string) => (await db.select({ c: users.expPool }).from(users).where(eq(users.id, id)))[0]!.c
const packsOf = async (id: string) => (await db.select().from(userPacks).where(eq(userPacks.userId, id))).find((p) => p.pool === "normal")?.count ?? 0
const ledgerOf = async (id: string) => (await db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, id))).filter((e) => e.source === "supply-box")
const boxOf = (view: Awaited<ReturnType<typeof getSupply>>, id: string) => view.boxes.find((b) => b.id === id)!
const amountOf = (view: Awaited<ReturnType<typeof getSupply>>, box: string, res: string) => boxOf(view, box).resources.find((r) => r.id === res)!.amount

console.log("supply tests")

// ---------- 规则 ----------

await test("占比：不选倾向按原占比；选了倾向，它占 focusShare，其余按原占比分剩下的；总价值不变", () => {
  const even = shared.resourceShares(MAIN, null)
  assert.deepEqual(even, { coins: 0.5, "normal-pack": 0.5 })
  const coins = shared.resourceShares(MAIN, "coins")
  assert.equal(coins.coins, 0.7)
  assert.ok(Math.abs(coins["normal-pack"]! - 0.3) < 1e-9)
  const unknown = shared.resourceShares(MAIN, "nope")
  assert.deepEqual(unknown, even, "不认识的倾向等于不偏")
  for (const focus of [null, "coins", "normal-pack"]) {
    const value = Object.entries(shared.amountsFor(MAIN, 10, focus)).reduce(
      (sum, [id, n]) => sum + n * MAIN.resources.find((r) => r.id === id)!.worth,
      0,
    )
    assert.ok(Math.abs(value - 10 * MAIN.valuePerHour) < 1e-6, `倾向 ${focus} 的总价值应是 ${10 * MAIN.valuePerHour}，实际 ${value}`)
  }
})

await test("封顶：攒满 capHours 就停，不为负", () => {
  const state: import("@choke/shared/supply").SupplyState = { accruedFrom: T0, stockHours: 0, stock: {}, focus: null }
  assert.equal(shared.newHours(MAIN, state, T0 + 10 * HOUR), 10)
  assert.equal(shared.newHours(MAIN, state, T0 + 500 * HOUR), MAIN.capHours)
  assert.equal(shared.newHours(MAIN, state, T0 - HOUR), 0, "时间倒流不能攒负数")
  assert.equal(shared.newHours(MAIN, { ...state, stockHours: 60 }, T0 + 500 * HOUR), 12, "存货的小时数也算进封顶")
})

await test("改倾向前先结算：攒满后改倾向，总量不会超过封顶，也比不改多不出价值", () => {
  const state: import("@choke/shared/supply").SupplyState = { accruedFrom: T0, stockHours: 0, stock: {}, focus: null }
  const settled = shared.settle(MAIN, state, T0 + 72 * HOUR)
  const after = { ...settled, focus: "normal-pack" }
  const later = T0 + 72 * HOUR + 500 * HOUR
  const value = (s: import("@choke/shared/supply").SupplyState, now: number) =>
    Object.entries(shared.totalsOf(MAIN, s, now)).reduce((sum, [id, n]) => sum + n * MAIN.resources.find((r) => r.id === id)!.worth, 0)
  assert.ok(Math.abs(value(after, later) - 72 * MAIN.valuePerHour) < 1e-4, "改倾向后总价值仍然只有 72 小时的量")
  const noSwitch = { ...state }
  assert.ok(Math.abs(value(noSwitch, later) - 72 * MAIN.valuePerHour) < 1e-4)
})

await test("领完：整数发走，小数留着，小时清零", () => {
  const state: import("@choke/shared/supply").SupplyState = { accruedFrom: T0, stockHours: 0, stock: {}, focus: null }
  const now = T0 + 10 * HOUR // 金币 100，卡包 0.8333…
  assert.deepEqual(shared.payoutOf(MAIN, state, now), { coins: 100, "normal-pack": 0 })
  const left = shared.afterClaim(MAIN, state, now)
  assert.equal(left.stockHours, 0)
  assert.equal(left.accruedFrom, now)
  assert.equal(left.stock.coins, undefined)
  assert.ok(Math.abs(left.stock["normal-pack"]! - 0.833333) < 1e-5)
})

// ---------- 内容校验 ----------

await test("内容校验：高稀有度包、活动包、不存在的地图、倾向占比不够大都被拦下", () => {
  const world = { maps: WORLD_CONTENT.maps }
  const withResource = (patch: object) => ({
    boxes: { a: { ...MAIN, resources: [MAIN.resources[0], { ...MAIN.resources[1], ...patch }] } },
  })
  assert.doesNotThrow(() => shared.parseSupplyContent({ boxes: { a: MAIN } }, world))
  assert.throws(() => shared.parseSupplyContent(withResource({ pool: "golden" }), world), /L 及以上占比超过/)
  assert.throws(() => shared.parseSupplyContent(withResource({ pool: "starter" }), world), /活动包/)
  assert.throws(() => shared.parseSupplyContent(withResource({ pool: "ghost" }), world), /卡包 ghost 不存在/)
  assert.throws(() => shared.parseSupplyContent({ boxes: { a: { ...MAIN, unlock: { map: "nowhere" } } } }, world), /地图 nowhere 不存在/)
  assert.throws(() => shared.parseSupplyContent({ boxes: { a: { ...MAIN, unlock: { map: "test-daily" } } } }, world), /不是主线地图/)
  assert.throws(() => shared.parseSupplyContent({ boxes: { a: { ...MAIN, focusShare: 51, resources: [{ ...MAIN.resources[0], share: 90 }, { ...MAIN.resources[1], share: 10 }] } } }, world), /原占比不能达到或超过/)
  assert.throws(() => shared.parseSupplyContent(withResource({ id: "coins" }), world), /重复/)
})

// ---------- 服务端 ----------

await test("没完成新手引导：不攒，领不到", async () => {
  const id = await newUser({ tutorialDone: false })
  const view = await getSupply(id, T0)
  assert.equal(boxOf(view, "prologue").locked, true)
  assert.equal(view.canClaim, false)
  await rejects(() => claimSupply(id, T0 + 10 * HOUR), "nothing_to_claim")
})

await test("领取：第一次看到才开始攒；10 小时领 100 金币，卡包的小数留着；写账本；立刻再领被拒", async () => {
  const id = await newUser()
  const first = await getSupply(id, T0)
  assert.equal(boxOf(first, "prologue").locked, false)
  assert.equal(boxOf(first, "prologue").hours, 0)
  assert.equal(first.canClaim, false)

  const view = await getSupply(id, T0 + 10 * HOUR)
  assert.equal(amountOf(view, "prologue", "coins"), 100)
  assert.equal(view.canClaim, true)

  const done = await claimSupply(id, T0 + 10 * HOUR)
  assert.deepEqual(done.gains.map((g) => [g.resourceId, g.count]), [["coins", 100]])
  assert.equal(await coinsOf(id), 100)
  const rows = await ledgerOf(id)
  assert.deepEqual(rows.map((r) => [r.kind, r.delta]), [["coins", 100]])
  assert.match(rows[0]!.sourceRef ?? "", /^claim@/)
  await rejects(() => claimSupply(id, T0 + 10 * HOUR), "nothing_to_claim")

  // 再攒 2 小时：卡包 0.8333 + 0.1667 = 1，正好够 1 包
  const second = await claimSupply(id, T0 + 12 * HOUR)
  assert.deepEqual(second.gains.map((g) => [g.resourceId, g.count]).sort(), [["coins", 20], ["normal-pack", 1]])
  assert.equal(await packsOf(id), 1)
  assert.equal(await coinsOf(id), 120)
})

await test("封顶：离线很久也只领 72 小时的量", async () => {
  const id = await newUser()
  await getSupply(id, T0)
  const done = await claimSupply(id, T0 + 1000 * HOUR)
  assert.equal(done.gains.find((g) => g.resourceId === "coins")!.count, 72 * 10)
  assert.equal(done.gains.find((g) => g.resourceId === "normal-pack")!.count, 6)
  assert.equal(boxOf(done.supply, "prologue").hours, 0)
})

await test("并发：同时点两次领取，只发一份", async () => {
  const id = await newUser()
  await getSupply(id, T0)
  const results = await Promise.allSettled([claimSupply(id, T0 + 20 * HOUR), claimSupply(id, T0 + 20 * HOUR)])
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1)
  assert.equal(await coinsOf(id), 200)
  assert.deepEqual((await ledgerOf(id)).map((r) => r.kind).sort(), ["coins", "pack"], "金币和卡包各记一条，没有第二份")
})

await test("解锁：通关序章才开经验池箱，从通关那一刻开始攒；领取发经验池并记账", async () => {
  const id = await newUser()
  const before = await getSupply(id, T0)
  const locked = boxOf(before, "t-gated")
  assert.equal(locked.locked, true)
  assert.match(locked.lockedReason ?? "", /序章/)
  assert.deepEqual(before.focusOptions.map((o) => o.id), ["coins", "normal-pack"], "没解锁的箱子里的资源不能选")

  await db.insert(mapClears).values({ userId: id, mapId: "story-prologue", clears: 1, firstClearedAt: new Date(T0 + 5 * HOUR) })
  const view = await getSupply(id, T0 + 15 * HOUR)
  assert.equal(boxOf(view, "t-gated").locked, false)
  assert.equal(boxOf(view, "t-gated").hours, 10, "从通关那一刻算起，不补发之前的")
  assert.deepEqual(view.focusOptions.map((o) => o.id).sort(), ["coins", "exp", "normal-pack"])

  const done = await claimSupply(id, T0 + 15 * HOUR)
  assert.equal(done.gains.find((g) => g.boxId === "t-gated" && g.resourceId === "exp")!.count, 50)
  assert.equal(await poolOf(id), 50)
  const rows = await ledgerOf(id)
  assert.ok(rows.some((r) => r.kind === "expPool" && r.delta === 50))
  assert.equal(rows.filter((r) => r.kind === "coins").reduce((s, r) => s + r.delta, 0), 150 + 50, "主箱 15 小时 150 金币 + 测试箱 10 小时 50 金币")
})

await test("改倾向：先按旧倾向结算；不能选还没解锁的；改回去也不能多拿", async () => {
  const id = await newUser()
  await getSupply(id, T0)
  await rejects(() => setSupplyFocus(id, "exp", T0), "bad_focus")
  await rejects(() => setSupplyFocus(id, "nope", T0), "bad_focus")

  // 攒 20 小时（不偏：金币 200、卡包 1.67 包）后改成偏卡包
  const view = await setSupplyFocus(id, "normal-pack", T0 + 20 * HOUR)
  assert.equal(view.focus, "normal-pack")
  assert.equal(amountOf(view, "prologue", "coins"), 200, "改倾向前攒的按旧倾向，不会变成卡包")
  assert.equal(amountOf(view, "prologue", "normal-pack"), 1)

  // 再攒 10 小时偏卡包：卡包 10×20×0.7/120 = 1.1667，金币 10×20×0.3 = 60
  const later = await getSupply(id, T0 + 30 * HOUR)
  assert.equal(amountOf(later, "prologue", "coins"), 260)
  assert.equal(amountOf(later, "prologue", "normal-pack"), 2, "1.6667 + 1.1667 = 2.8333，取整 2")
  const total = (await claimSupply(id, T0 + 30 * HOUR)).gains
  assert.deepEqual(total.map((g) => [g.resourceId, g.count]).sort(), [["coins", 260], ["normal-pack", 2]])

  // 取消倾向也要结算，同样的值不重复结算
  const cleared = await setSupplyFocus(id, null, T0 + 31 * HOUR)
  assert.equal(cleared.focus, null)
  const same = await setSupplyFocus(id, null, T0 + 32 * HOUR)
  assert.equal(same.focus, null)
})

await test("改倾向不绕过封顶：攒满再改倾向，总量还是 72 小时的量", async () => {
  const id = await newUser()
  await getSupply(id, T0)
  await setSupplyFocus(id, "coins", T0 + 72 * HOUR)
  const done = await claimSupply(id, T0 + 500 * HOUR)
  const value = done.gains.reduce((sum, g) => sum + g.count * MAIN.resources.find((r) => r.id === g.resourceId)!.worth, 0)
  assert.ok(Math.abs(value - 72 * MAIN.valuePerHour) <= 120, `总价值 ${value} 应约等于 ${72 * MAIN.valuePerHour}（取整最多差一包）`)
})

await test("接口：只能看和领自己的；未登录 401", async () => {
  const id = await newUser()
  const other = await newUser()
  const headers = { cookie: `${COOKIE_NAME}=${makeSession(id)}` }
  const mine = await app.inject({ method: "GET", url: `/users/${id}/supply`, headers })
  assert.equal(mine.statusCode, 200, mine.body)
  assert.equal(mine.json().data.boxes[0].id, "prologue")
  const theirs = await app.inject({ method: "GET", url: `/users/${other}/supply`, headers })
  assert.notEqual(theirs.statusCode, 200)
  const anon = await app.inject({ method: "POST", url: `/users/${id}/supply/claim` })
  assert.equal(anon.statusCode, 401)
  const empty = await app.inject({ method: "POST", url: `/users/${id}/supply/claim`, headers })
  assert.equal(empty.statusCode, 400)
  assert.equal(empty.json().error.code, "nothing_to_claim")
  const bad = await app.inject({ method: "POST", url: `/users/${id}/supply/focus`, headers, payload: { focus: "exp" } })
  assert.equal(bad.statusCode, 400)
  assert.equal(bad.json().error.code, "bad_focus")
  const ok = await app.inject({ method: "POST", url: `/users/${id}/supply/focus`, headers, payload: { focus: "coins" } })
  assert.equal(ok.statusCode, 200, ok.body)
  assert.equal(ok.json().data.focus, "coins")
})

console.log(`${passed} supply tests passed`)
await cleanup()
