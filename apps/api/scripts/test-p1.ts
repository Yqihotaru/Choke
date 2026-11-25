/**
 * P1 经济闭环服务端测试：
 * 1. 挂机包（idle）每日 60 包领取与上限拦截
 * 2. NPC 回收（价格表、日限 20 张、本体卡拦截、记账）
 * 3. 卡牌 40+ 突破金币消耗（300/500/500/700）
 * 4. 市场 2% 上架税 + 5% 成交税 + ±40% 价格带 + 7 天过期 + 成交历史
 */
import assert from "node:assert/strict"

import { setupTestDb } from "./test-db"

const dropTestDb = await setupTestDb("p1")

const { eq } = await import("drizzle-orm")
const { default: Fastify } = await import("fastify")
const { default: cookie } = await import("@fastify/cookie")
const { db } = await import("../src/db/client")
const { users, cards, userCards, marketListings } = await import("../src/db/schema")
const { COOKIE_NAME, makeSession } = await import("../src/auth/osu")
const { handleError } = await import("../src/error-handler")
const { packRoutes } = await import("../src/routes/packs")
const { progressionRoutes } = await import("../src/routes/progression")
const { marketRoutes } = await import("../src/routes/market")
const { breakthroughCoinCost } = await import("@choke/shared/progression")

const app = Fastify()
app.setErrorHandler(handleError)
await app.register(cookie)
await app.register(packRoutes)
await app.register(progressionRoutes)
await app.register(marketRoutes)
await app.ready()

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

function auth(userId: string) {
  return { cookie: `${COOKIE_NAME}=${makeSession(userId)}` }
}

await test("挂机包：每日领取上限 60 包，领完后拦截", async () => {
  const userId = "p1-idle-user"
  await db.insert(users).values({ id: userId, username: userId, tutorialDone: true, playerLevel: 60, staminaUpdatedAt: Date.now() })

  const r1 = await app.inject({
    method: "POST",
    url: `/users/${userId}/packs/idle/claim`,
    headers: auth(userId),
    payload: { count: 25 },
  })
  assert.equal(r1.statusCode, 200)
  assert.equal(r1.json().data.claimed, 25)
  assert.equal(r1.json().data.remaining, 35)

  const r2 = await app.inject({
    method: "POST",
    url: `/users/${userId}/packs/idle/claim`,
    headers: auth(userId),
  })
  assert.equal(r2.statusCode, 200)
  assert.equal(r2.json().data.claimed, 35)
  assert.equal(r2.json().data.count, 60)

  const r3 = await app.inject({
    method: "POST",
    url: `/users/${userId}/packs/idle/claim`,
    headers: auth(userId),
  })
  assert.equal(r3.statusCode, 400)
  assert.equal(r3.json().error.code, "daily_limit_reached")
})

await test("NPC 回收：按稀有度给金币、每日限 20 张、本体卡禁止回收", async () => {
  const userId = "p1-recycle-user"
  await db.insert(users).values({ id: userId, username: userId, coins: 0, tutorialDone: true, playerLevel: 60, staminaUpdatedAt: Date.now() })
  await db.insert(cards).values([
    { id: "p1-c", name: "C卡", rarity: "C", job: "tank", no: 1, total: 1 },
    { id: "p1-l", name: "L卡", rarity: "L", job: "warrior", no: 2, total: 1 },
    { id: "hero-888", name: "本体", rarity: "L", job: "warrior", no: 3, total: 1, cardType: "hero" },
  ])

  const ids: number[] = []
  for (let i = 0; i < 19; i += 1) {
    const [uc] = await db.insert(userCards).values({ userId, cardId: "p1-c", serial: i + 1 }).returning()
    ids.push(uc!.id)
  }
  const [lCard] = await db.insert(userCards).values({ userId, cardId: "p1-l", serial: 1 }).returning()
  ids.push(lCard!.id)
  const [extra] = await db.insert(userCards).values({ userId, cardId: "p1-c", serial: 99 }).returning()
  const [hero] = await db.insert(userCards).values({ userId, cardId: "hero-888", serial: 1 }).returning()

  // 本体卡被拦截
  const heroRes = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/recycle`,
    headers: auth(userId),
    payload: { userCardIds: [hero!.id] },
  })
  assert.equal(heroRes.statusCode, 400)
  assert.equal(heroRes.json().error.code, "hero_protected")

  // 一次回收 20 张：19*2 + 75 = 113 金币
  const res = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/recycle`,
    headers: auth(userId),
    payload: { userCardIds: ids },
  })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().data.coinsGained, 19 * 2 + 75)
  assert.equal(res.json().data.remaining, 0)

  // 超出日限 20 张被拦截
  const overRes = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/recycle`,
    headers: auth(userId),
    payload: { userCardIds: [extra!.id] },
  })
  assert.equal(overRes.statusCode, 400)
  assert.equal(overRes.json().error.code, "daily_limit_reached")

  // 培养过的卡回收时按返还经验每 1000 点 +1 金币
  const trainedUser = "p1-recycle-trained"
  await db.insert(users).values({ id: trainedUser, username: trainedUser, coins: 0, tutorialDone: true, playerLevel: 60, staminaUpdatedAt: Date.now() })
  const [trainedCard] = await db
    .insert(userCards)
    .values({ userId: trainedUser, cardId: "p1-c", level: 40, exp: 0, serial: 1 })
    .returning()
  const trainedRes = await app.inject({
    method: "POST",
    url: `/users/${trainedUser}/cards/recycle`,
    headers: auth(trainedUser),
    payload: { userCardIds: [trainedCard!.id] },
  })
  assert.equal(trainedRes.statusCode, 200)
  // C 卡 40 级累计经验 5000，75% 返还 = 3750，/ 1000 = +3 金币 => 基础 2 + 3 = 5
  assert.equal(trainedRes.json().data.coinsGained, 5)
})

await test("卡牌 40+ 突破金币消耗：40→41 扣 300 金币", async () => {
  assert.equal(breakthroughCoinCost(40, false), 300)
  assert.equal(breakthroughCoinCost(50, false), 500)
  assert.equal(breakthroughCoinCost(60, false), 500)
  assert.equal(breakthroughCoinCost(70, false), 700)
  assert.equal(breakthroughCoinCost(40, true), 0)

  const userId = "p1-bt-user"
  await db.insert(users).values({ id: userId, username: userId, coins: 200, tutorialDone: true, playerLevel: 60, staminaUpdatedAt: Date.now() })
  await db.insert(cards).values({ id: "p1-bt-c", name: "突破卡", rarity: "C", job: "tank", no: 1, total: 1 })
  const [uc] = await db
    .insert(userCards)
    .values({ userId, cardId: "p1-bt-c", level: 40, exp: 1000, serial: 1 })
    .returning()

  // 金币不足 300 时被拦截
  const failRes = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/${uc!.id}/level`,
    headers: auth(userId),
  })
  assert.equal(failRes.statusCode, 400)
  assert.equal(failRes.json().error.code, "not_enough_coins")

  // 补足金币后突破成功
  await db.update(users).set({ coins: 500 }).where(eq(users.id, userId))
  const okRes = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/${uc!.id}/level`,
    headers: auth(userId),
  })
  assert.equal(okRes.statusCode, 200)
  assert.equal(okRes.json().data.card.level, 41)
  assert.equal(okRes.json().data.coinsSpent, 300)
  assert.equal(okRes.json().data.coins, 200)
})

await test("市场：±40% 价格带校验、7 天过期与成交历史", async () => {
  const seller = "p1-mkt-seller"
  const buyer = "p1-mkt-buyer"
  await db.insert(users).values([
    { id: seller, username: seller, osuId: 1001, playerLevel: 5, tutorialDone: true, coins: 500, staminaUpdatedAt: Date.now() },
    { id: buyer, username: buyer, osuId: 1002, playerLevel: 5, tutorialDone: true, coins: 2000, staminaUpdatedAt: Date.now() },
  ])
  await db.insert(cards).values({ id: "p1-mkt-card", name: "市场卡", rarity: "E", job: "mage", no: 1, total: 1 })
  const [c1] = await db.insert(userCards).values({ userId: seller, cardId: "p1-mkt-card", serial: 1 }).returning()
  const [c2] = await db.insert(userCards).values({ userId: seller, cardId: "p1-mkt-card", serial: 2 }).returning()
  const [c3] = await db.insert(userCards).values({ userId: seller, cardId: "p1-mkt-card", serial: 3 }).returning()

  // 首单成交 1000 金币，建立参考均价 1000（±40% => 600..1400）
  const l1 = await app.inject({
    method: "POST",
    url: `/users/${seller}/market/list`,
    headers: auth(seller),
    payload: { userCardId: c1!.id, price: 1000 },
  })
  assert.equal(l1.statusCode, 200)
  const b1 = await app.inject({
    method: "POST",
    url: `/users/${buyer}/market/buy/${l1.json().data.id}`,
    headers: auth(buyer),
  })
  assert.equal(b1.statusCode, 200)

  // 超出 ±40% 价格带（比如 2000）被拒
  const outBand = await app.inject({
    method: "POST",
    url: `/users/${seller}/market/list`,
    headers: auth(seller),
    payload: { userCardId: c2!.id, price: 2000 },
  })
  assert.equal(outBand.statusCode, 400)
  assert.equal(outBand.json().error.code, "price_out_of_band")

  // 查询成交历史接口
  const hist = await app.inject({ method: "GET", url: "/market/history?cardId=p1-mkt-card" })
  assert.equal(hist.statusCode, 200)
  assert.equal(hist.json().data.sales.length, 1)
  assert.equal(hist.json().data.priceBand.avgPrice, 1000)

  // 8 天前的挂单触发过期：自动取消、退还押金、上架税不退
  const [sellerBeforeExp] = await db.select({ coins: users.coins }).from(users).where(eq(users.id, seller))
  const [expiredListing] = await db
    .insert(marketListings)
    .values({
      sellerId: seller,
      userCardId: c3!.id,
      price: 1000,
      deposit: 50,
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    })
    .returning()
  const buyExp = await app.inject({
    method: "POST",
    url: `/users/${buyer}/market/buy/${expiredListing!.id}`,
    headers: auth(buyer),
  })
  assert.equal(buyExp.statusCode, 400)
  assert.equal(buyExp.json().error.code, "listing_expired")
  const [expiredRow] = await db.select().from(marketListings).where(eq(marketListings.id, expiredListing!.id))
  assert.equal(expiredRow!.status, "expired")
  const [sellerAfterExp] = await db.select({ coins: users.coins }).from(users).where(eq(users.id, seller))
  assert.equal(sellerAfterExp!.coins, sellerBeforeExp!.coins + 50)
})

console.log(`\n${passed} p1 tests passed`)
await app.close()
await dropTestDb()
