/**
 * 流水的服务端测试：每一种会改货币 / 道具 / 卡包 / 卡牌的操作都要记账，
 * 而且账和余额对得上；只能看自己的流水；翻页和按类别筛选。
 * 用临时 PGlite 数据库，不碰开发库。
 *
 *   pnpm test:ledger
 */
import assert from "node:assert/strict"

import { setupTestDb } from "./test-db"

const dropTestDb = await setupTestDb("ledger")

const { eq } = await import("drizzle-orm")
const { default: Fastify } = await import("fastify")
const { default: cookie } = await import("@fastify/cookie")
const { db } = await import("../src/db/client")
const { users, cards, ledgerEntries, mapClears, userPacks } = await import("../src/db/schema")
const { COOKIE_NAME, makeSession } = await import("../src/auth/osu")
const { handleError } = await import("../src/error-handler")
const { grantCard } = await import("../src/gacha/open")
const { grantPacks } = await import("../src/packs/inventory")
const { ledgerRoutes } = await import("../src/routes/ledger")
const { progressionRoutes } = await import("../src/routes/progression")
const { dungeonRoutes } = await import("../src/routes/dungeons")
const { marketRoutes } = await import("../src/routes/market")
const { packRoutes } = await import("../src/routes/packs")
const { shardItemId, SHARDS_PER_DISMANTLE } = await import("@choke/shared/items")

const app = Fastify()
app.setErrorHandler(handleError)
await app.register(cookie)
for (const routes of [ledgerRoutes, progressionRoutes, dungeonRoutes, marketRoutes, packRoutes]) {
  await app.register(routes)
}
await app.ready()

let passed = 0
async function test(name: string, fn: () => Promise<void>) {
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

async function cleanup() {
  await app.close().catch(() => {})
  await dropTestDb()
}

interface Reply {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}
const call = async (userId: string | null, method: "GET" | "POST", url: string, payload?: unknown): Promise<Reply> => {
  const res = await app.inject({
    method,
    url,
    payload: payload as never,
    headers: userId ? { cookie: `${COOKIE_NAME}=${makeSession(userId)}` } : {},
  })
  return { status: res.statusCode, body: res.json() }
}

let seq = 0
async function newUser(patch: Partial<typeof users.$inferInsert> = {}) {
  seq += 1
  const id = `ledger-test-${seq}`
  await db
    .insert(users)
    .values({ id, username: id, email: `${id}@test.local`, osuId: 800_000 + seq, tutorialDone: true, playerLevel: 60, staminaUpdatedAt: Date.now(), ...patch })
  return id
}

const RARITIES = ["C", "UC", "R", "E", "L", "Mythic", "Prismatic"]
for (const rarity of RARITIES) {
  await db.insert(cards).values({ id: `lt-${rarity}`, name: `测试卡 ${rarity}`, rarity, job: "warrior", no: 1, total: 1 })
}
const give = async (userId: string, cardId: string, foil = false) =>
  (await db.transaction((tx) => grantCard(tx, { userId, cardId, foil }))).userCardId

const entriesOf = (userId: string) => db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, userId))
const sumOf = async (userId: string, kind: string, ref?: string) =>
  (await entriesOf(userId))
    .filter((e) => e.kind === kind && (ref === undefined || e.ref === ref))
    .reduce((sum, e) => sum + e.delta, 0)
const userOf = async (userId: string) => (await db.select().from(users).where(eq(users.id, userId)))[0]!

console.log("ledger tests")

await test("副本：体力、精华、卡包、道具都记账，且与余额对得上（副本不产金币）；未首通拦截不记账", async () => {
  const locked = await newUser({ stamina: 200 })
  const lockedRes = await call(locked, "POST", `/users/${locked}/dungeons/shards/sweep`)
  assert.equal(lockedRes.status, 400)
  assert.equal(lockedRes.body.error.code, "first_clear_required")
  assert.equal((await entriesOf(locked)).length, 0)

  const userId = await newUser({ coins: 0, essence: 0, stamina: 200 })
  for (const mapId of ["dungeon-shards", "dungeon-essence", "dungeon-packs", "dungeon-exp"]) {
    await db.insert(mapClears).values({ userId, mapId, clears: 1, bestStars: 9, bestObjectives: 2 })
  }
  for (const dungeon of ["shards", "essence", "packs", "exp"]) {
    const res = await call(userId, "POST", `/users/${userId}/dungeons/${dungeon}/run`)
    assert.equal(res.status, 200, JSON.stringify(res.body))
  }
  const user = await userOf(userId)
  assert.equal(user.coins, 0)
  assert.equal(await sumOf(userId, "coins"), 0)
  assert.equal(await sumOf(userId, "essence"), user.essence)
  assert.equal(await sumOf(userId, "stamina"), -(20 + 20 + 60 + 20))
  assert.equal(await sumOf(userId, "pack", "normal"), 1)
  assert.equal(await sumOf(userId, "item", "exp-medium"), 3)
  assert.equal(await sumOf(userId, "item", "shard-C"), 4)
  const dungeonSources = new Set((await entriesOf(userId)).map((e) => e.source))
  assert.deepEqual([...dungeonSources], ["dungeon"])
})

await test("体力不够时副本不记账", async () => {
  const userId = await newUser({ stamina: 0 })
  await db.insert(mapClears).values({ userId, mapId: "dungeon-shards", clears: 1, bestStars: 9, bestObjectives: 0 })
  const res = await call(userId, "POST", `/users/${userId}/dungeons/shards/run`)
  assert.equal(res.status, 400)
  assert.equal((await entriesOf(userId)).length, 0)
})

await test("开包：卡包 −1，每张卡 +1，带上卡的实例 id", async () => {
  const userId = await newUser()
  await db.insert(userPacks).values({ userId, pool: "normal", count: 2 })
  const res = await call(userId, "POST", "/packs/normal/open", {})
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const entries = await entriesOf(userId)
  assert.equal(entries.filter((e) => e.kind === "pack").reduce((s, e) => s + e.delta, 0), -1)
  const cardRows = entries.filter((e) => e.kind === "card")
  assert.equal(cardRows.length, res.body.data.results.length + (res.body.data.bonus ? 1 : 0))
  assert.ok(cardRows.every((e) => e.delta === 1 && e.userCardId !== null && e.source === "pack-open"))
  assert.deepEqual(
    cardRows.map((e) => e.userCardId).sort(),
    [...res.body.data.results, ...(res.body.data.bonus ? [res.body.data.bonus] : [])].map((c: { userCardId: number }) => c.userCardId).sort(),
  )
})

await test("喂养：被吃的卡 −1、用掉的道具 −n、闪卡精华 +n", async () => {
  const userId = await newUser({ essence: 0 })
  const target = await give(userId, "lt-R")
  const fodder = await give(userId, "lt-C", true)
  await db.transaction(async (tx) => {
    const { grantItems } = await import("../src/items")
    await grantItems(tx, userId, [{ itemId: "exp-small", count: 3 }])
  })
  const res = await call(userId, "POST", `/users/${userId}/cards/${target}/feed`, {
    cards: [fodder],
    items: [{ itemId: "exp-small", count: 2 }],
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(await sumOf(userId, "card", "lt-C"), -1)
  assert.equal(await sumOf(userId, "item", "exp-small"), -2)
  const user = await userOf(userId)
  assert.ok(user.essence > 0, "闪卡应该给精华")
  assert.equal(await sumOf(userId, "essence"), user.essence)
})

await test("分解：卡 −1、碎片 +4、精华 +n", async () => {
  const userId = await newUser({ essence: 0 })
  const card = await give(userId, "lt-E", true)
  const res = await call(userId, "POST", `/users/${userId}/cards/${card}/dismantle`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(await sumOf(userId, "card", "lt-E"), -1)
  assert.equal(await sumOf(userId, "item", shardItemId("E")), SHARDS_PER_DISMANTLE)
  assert.equal(await sumOf(userId, "essence"), (await userOf(userId)).essence)
  assert.ok((await userOf(userId)).essence > 0)
})

await test("融合：吃掉的同名卡 −1", async () => {
  const userId = await newUser()
  const keep = await give(userId, "lt-R")
  await give(userId, "lt-R")
  const res = await call(userId, "POST", `/users/${userId}/cards/${keep}/constellation`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const rows = (await entriesOf(userId)).filter((e) => e.source === "fuse")
  assert.equal(rows.length, 1)
  assert.deepEqual([rows[0]!.kind, rows[0]!.ref, rows[0]!.delta], ["card", "lt-R", -1])
})

await test("闪卡强化：精华 −n", async () => {
  const userId = await newUser({ essence: 10_000 })
  const card = await give(userId, "lt-R")
  const res = await call(userId, "POST", `/users/${userId}/cards/${card}/enhance`, { action: "foil" })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(await sumOf(userId, "essence"), -res.body.data.cost)
})

await test("市场：买家扣金币得卡，卖家扣 2% 上架税 + 5% 押金，成交后退押金并收 95% 货款", async () => {
  const seller = await newUser({ coins: 100 })
  const buyer = await newUser({ coins: 1000 })
  const card = await give(seller, "lt-UC")
  const listed = await call(seller, "POST", `/users/${seller}/market/list`, { userCardId: card, price: 300 })
  assert.equal(listed.status, 200, JSON.stringify(listed.body))
  assert.equal(listed.body.data.listTax, 6)
  assert.equal(listed.body.data.deposit, 15)
  const bought = await call(buyer, "POST", `/users/${buyer}/market/buy/${listed.body.data.id}`)
  assert.equal(bought.status, 200, JSON.stringify(bought.body))
  assert.equal(bought.body.data.tradeTax, 15)

  assert.equal(await sumOf(buyer, "coins"), -300)
  assert.equal(await sumOf(buyer, "card", "lt-UC"), 1)
  assert.equal(await sumOf(seller, "coins"), 285 - 6)
  assert.equal(await sumOf(seller, "card", "lt-UC"), -1)
  assert.equal((await userOf(buyer)).coins + (await userOf(seller)).coins, 1100 - 6 - 15)
  assert.equal((await entriesOf(buyer))[0]!.source, "market-buy")
  const sellerSources = new Set((await entriesOf(seller)).map((e) => e.source))
  assert.ok(sellerSources.has("market-tax") && sellerSources.has("market-deposit") && sellerSources.has("market-deposit-refund") && sellerSources.has("market-sell"))
})

await test("买不起时市场购买不记账", async () => {
  const seller = await newUser({ coins: 100 })
  const buyer = await newUser({ coins: 5 })
  const card = await give(seller, "lt-UC")
  const listed = await call(seller, "POST", `/users/${seller}/market/list`, { userCardId: card, price: 300 })
  const bought = await call(buyer, "POST", `/users/${buyer}/market/buy/${listed.body.data.id}`)
  assert.equal(bought.status, 400)
  assert.equal((await entriesOf(buyer)).length, 0)
  assert.equal((await entriesOf(seller)).filter((e) => e.source === "market-sell").length, 0)
})

await test("发新手包写流水", async () => {
  const userId = await newUser()
  await grantPacks(userId, { starter: 30, mystery: 1 }, { source: "starter" })
  assert.equal(await sumOf(userId, "pack", "starter"), 30)
  assert.equal(await sumOf(userId, "pack", "mystery"), 1)
})

await test("流水接口：新的在前、翻页、按类别筛选、中文名；别人的流水看不了", async () => {
  const userId = await newUser()
  const other = await newUser()
  await db.insert(ledgerEntries).values(
    Array.from({ length: 7 }, (_, i) => ({
      userId,
      kind: i % 2 === 0 ? "coins" : "card",
      ref: i % 2 === 0 ? "" : "lt-R",
      delta: i + 1,
      source: i % 2 === 0 ? "dungeon" : "pack-open",
    })),
  )
  const first = await call(userId, "GET", `/users/${userId}/ledger?limit=3`)
  assert.equal(first.status, 200)
  assert.equal(first.body.data.entries.length, 3)
  assert.equal(first.body.data.hasMore, true)
  assert.deepEqual(first.body.data.entries.map((e: { delta: number }) => e.delta), [7, 6, 5])
  assert.equal(first.body.data.entries[0].label, "金币")
  assert.equal(first.body.data.entries[0].sourceLabel, "副本")
  assert.equal(first.body.data.entries[1].label, "测试卡 R")
  assert.equal(first.body.data.entries[1].rarity, "R")

  const lastId = first.body.data.entries[2].id
  const second = await call(userId, "GET", `/users/${userId}/ledger?limit=10&before=${lastId}`)
  assert.deepEqual(second.body.data.entries.map((e: { delta: number }) => e.delta), [4, 3, 2, 1])
  assert.equal(second.body.data.hasMore, false)

  const onlyCards = await call(userId, "GET", `/users/${userId}/ledger?kind=card`)
  assert.ok(onlyCards.body.data.entries.every((e: { kind: string }) => e.kind === "card"))
  assert.equal(onlyCards.body.data.entries.length, 3)

  assert.equal((await call(other, "GET", `/users/${userId}/ledger`)).status, 403)
  assert.equal((await call(null, "GET", `/users/${userId}/ledger`)).status, 401)
  assert.equal((await call(userId, "GET", `/users/${userId}/ledger?kind=bogus`)).status, 400)
})

console.log(`${passed} ledger tests passed`)
await cleanup()
