/**
 * 卡牌列表筛选：/users/:id/cards 的稀有度多选、职业、国家、闪卡、排序方向、limit 上限，
 * 以及 /users/:id/codex 的职业筛选与 ownedTotal。
 */
import assert from "node:assert/strict"

import { setupTestDb } from "./test-db"

const dropTestDb = await setupTestDb("card-filters")

// 必须动态导入：setupTestDb 先设好临时库的环境变量，db client 才能连到它。
const { default: Fastify } = await import("fastify")
const { default: cookie } = await import("@fastify/cookie")
const { db } = await import("../src/db/client")
const { users, cards, userCards } = await import("../src/db/schema")
const { COOKIE_NAME, makeSession } = await import("../src/auth/osu")
const { handleError } = await import("../src/error-handler")
const { cardRoutes } = await import("../src/routes/cards")

const app = Fastify()
app.setErrorHandler(handleError)
await app.register(cookie)
await app.register(cardRoutes)
await app.ready()

const headers = (userId: string) => ({ cookie: `${COOKIE_NAME}=${makeSession(userId)}` })

await db.insert(users).values([
  { id: "u1", username: "u1", staminaUpdatedAt: Date.now() },
  { id: "u2", username: "u2", staminaUpdatedAt: Date.now() },
])
const base = { no: 1, total: 4, cardType: "pool" }
await db.insert(cards).values([
  { ...base, id: "a", name: "A", rarity: "R", job: "mage", country: "JP", pp: "100" },
  { ...base, id: "b", name: "B", rarity: "L", job: "tank", country: "US", pp: "300" },
  { ...base, id: "c", name: "C", rarity: "L", job: "mage", country: "JP", pp: "200" },
  { ...base, id: "d", name: "D", rarity: "C", job: "support", country: null, pp: null },
])
await db.insert(userCards).values([
  { userId: "u1", cardId: "a", foil: true, level: 3 },
  { userId: "u1", cardId: "b" },
  { userId: "u1", cardId: "c", foil: true },
  { userId: "u1", cardId: "d" },
])

async function list(query: string) {
  const res = await app.inject({ method: "GET", url: `/users/u1/cards${query}`, headers: headers("u1") })
  return { status: res.statusCode, body: res.json() }
}
const ids = (r: { body: { data: { rows: { id: string }[] } } }) => r.body.data.rows.map((row) => row.id)

let passed = 0
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    console.error(`FAIL  ${name}`)
    throw error
  }
}

await test("稀有度单选与多选", async () => {
  assert.equal((await list("?rarity=L")).body.data.total, 2)
  const r = await list("?rarity=L,R&job=mage")
  assert.deepEqual(ids(r).sort(), ["a", "c"])
})

await test("非法稀有度被忽略，非法职业 400", async () => {
  assert.equal((await list("?rarity=X")).body.data.total, 4)
  assert.equal((await list("?job=dragon")).status, 400)
})

await test("闪卡与国家（大小写不敏感）", async () => {
  assert.deepEqual(ids(await list("?foil=1")).sort(), ["a", "c"])
  assert.deepEqual(ids(await list("?foil=0")).sort(), ["b", "d"])
  assert.deepEqual(ids(await list("?country=jp")).sort(), ["a", "c"])
})

await test("排序方向、null 排最后、等级排序", async () => {
  assert.deepEqual(ids(await list("?sort=pp&dir=asc")), ["a", "c", "b", "d"])
  assert.deepEqual(ids(await list("?sort=pp")), ["b", "c", "a", "d"])
  assert.equal(ids(await list("?sort=level"))[0], "a")
})

await test("limit 上限 200", async () => {
  assert.equal((await list("?limit=200")).status, 200)
  assert.equal((await list("?limit=201")).status, 400)
})

await test("图鉴职业筛选，ownedTotal 同步按职业", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/users/u1/codex?rarity=L&job=mage",
    headers: headers("u1"),
  })
  const data = res.json().data
  assert.equal(data.total, 1)
  assert.equal(data.ownedTotal, 1)
})

await test("他人不能读取", async () => {
  const res = await app.inject({ method: "GET", url: "/users/u1/cards", headers: headers("u2") })
  assert.equal(res.statusCode, 403)
})

console.log(`\n${passed} card-filters tests passed`)
await app.close()
await dropTestDb()
