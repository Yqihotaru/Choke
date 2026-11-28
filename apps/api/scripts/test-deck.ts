/**
 * 卡组写入的服务端规则：归属、市场挂单、出征锁定都要在事务内校验。
 * 用临时 PGlite 数据库，不碰开发库。
 *
 *   pnpm test:deck
 */
import assert from "node:assert/strict"

import { setupTestDb } from "./test-db"

const dropTestDb = await setupTestDb("deck")

const { default: Fastify } = await import("fastify")
const { default: cookie } = await import("@fastify/cookie")

const { db } = await import("../src/db/client")
const { cards, expeditions, marketListings, userCards, users } = await import("../src/db/schema")
const { COOKIE_NAME, makeSession } = await import("../src/auth/osu")
const { handleError } = await import("../src/error-handler")
const { deckRoutes } = await import("../src/routes/decks")
const { DECK_SIZE } = await import("../src/config")

const app = Fastify()
app.setErrorHandler(handleError)
await app.register(cookie)
await app.register(deckRoutes)
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

let seq = 0
async function newUser() {
  seq += 1
  const id = `deck-test-${seq}`
  await db.insert(users).values({ id, username: id })
  return id
}

let cardSeq = 0
async function newCard(userId: string) {
  cardSeq += 1
  const cardId = `deck-card-${cardSeq}`
  await db.insert(cards).values({
    id: cardId,
    name: cardId,
    rarity: "R",
    job: "warrior",
    no: cardSeq,
    total: 1,
  })
  const [row] = await db
    .insert(userCards)
    .values({ userId, cardId })
    .returning({ id: userCards.id })
  return row!.id
}

const emptySlots = (): Array<number | null> => Array.from({ length: DECK_SIZE }, () => null)

const put = (userId: string, slots: Array<number | null>) =>
  app.inject({
    method: "PUT",
    url: `/users/${userId}/deck`,
    payload: { slots },
    headers: { cookie: `${COOKIE_NAME}=${makeSession(userId)}` },
  })

const getDeck = (userId: string) =>
  app.inject({
    method: "GET",
    url: `/users/${userId}/deck`,
    headers: { cookie: `${COOKIE_NAME}=${makeSession(userId)}` },
  })

console.log("deck rule tests")

await test("卡组能保存并读回", async () => {
  const userId = await newUser()
  const first = await newCard(userId)
  const second = await newCard(userId)
  const slots = emptySlots()
  slots[0] = first
  slots[1] = second

  const res = await put(userId, slots)
  assert.equal(res.statusCode, 200, res.body)
  const data = res.json().data
  assert.equal(data.slots[0].card.userCardId, first)
  assert.equal(data.slots[1].card.userCardId, second)

  const read = await getDeck(userId)
  assert.equal(read.statusCode, 200)
  assert.equal(read.json().data.slots[1].card.userCardId, second)
})

await test("挂单中的卡不能放进卡组", async () => {
  const userId = await newUser()
  const card = await newCard(userId)
  await db.insert(marketListings).values({ sellerId: userId, userCardId: card, price: 100 })

  const slots = emptySlots()
  slots[0] = card
  const res = await put(userId, slots)
  assert.equal(res.statusCode, 400, res.body)
  assert.equal(res.json().error.code, "card_listed")
})

await test("出征中的卡不能放进卡组", async () => {
  const userId = await newUser()
  const card = await newCard(userId)
  await db.insert(expeditions).values({
    userId,
    mapId: "test-trial",
    seed: "deck-test",
    contentVersion: "deck-test",
    map: {} as never,
    pool: [{ userCardId: card }] as never,
    allocation: {} as never,
    position: "n1",
    expiresAt: new Date(Date.now() + 3_600_000),
  })

  const slots = emptySlots()
  slots[0] = card
  const res = await put(userId, slots)
  assert.equal(res.statusCode, 400, res.body)
  assert.equal(res.json().error.code, "in_expedition")
})

await test("别人的卡不能写进卡组", async () => {
  const userId = await newUser()
  const other = await newUser()
  const card = await newCard(other)

  const slots = emptySlots()
  slots[0] = card
  const res = await put(userId, slots)
  assert.equal(res.statusCode, 400, res.body)
  assert.equal(res.json().error.code, "card_not_owned")
})

await test("写入被拒时原卡组保持不变", async () => {
  const userId = await newUser()
  const good = await newCard(userId)
  const listed = await newCard(userId)

  const before = emptySlots()
  before[0] = good
  assert.equal((await put(userId, before)).statusCode, 200)

  await db.insert(marketListings).values({ sellerId: userId, userCardId: listed, price: 100 })
  const after = emptySlots()
  after[0] = listed
  const rejected = await put(userId, after)
  assert.equal(rejected.statusCode, 400)
  assert.equal(rejected.json().error.code, "card_listed")

  const read = await getDeck(userId)
  assert.equal(read.json().data.slots[0].card.userCardId, good, "被拒的写入不能清空原卡组")
})

console.log(`\n${passed} passed`)
await cleanup()
