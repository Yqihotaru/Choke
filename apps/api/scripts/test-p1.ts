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
const { users, cards, userCards, userItems, marketListings } = await import("../src/db/schema")
const { COOKIE_NAME, makeSession } = await import("../src/auth/osu")
const { handleError } = await import("../src/error-handler")
const { packRoutes } = await import("../src/routes/packs")
const { progressionRoutes } = await import("../src/routes/progression")
const { marketRoutes } = await import("../src/routes/market")
const { shopRoutes } = await import("../src/routes/shop")
const { breakthroughCoinCost, breakthroughShardCost } = await import("@choke/shared/progression")

const app = Fastify()
app.setErrorHandler(handleError)
await app.register(cookie)
await app.register(packRoutes)
await app.register(progressionRoutes)
await app.register(marketRoutes)
await app.register(shopRoutes)
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

await test("卡牌 40+ 突破金币与同品质碎片消耗：40→41 扣 300 金币 + 2 片同品质碎片", async () => {
  assert.equal(breakthroughCoinCost(40, false), 300)
  assert.equal(breakthroughCoinCost(50, false), 500)
  assert.equal(breakthroughCoinCost(60, false), 500)
  assert.equal(breakthroughCoinCost(70, false), 700)
  assert.equal(breakthroughCoinCost(40, true), 0)

  assert.equal(breakthroughShardCost(40, "C", false), 2)
  assert.equal(breakthroughShardCost(70, "L", false), 8)
  assert.equal(breakthroughShardCost(70, "Mythic", false), 4)
  assert.equal(breakthroughShardCost(70, "Prismatic", false), 2)
  assert.equal(breakthroughShardCost(40, "L", true), 0)

  const userId = "p1-bt-user"
  await db.insert(users).values({ id: userId, username: userId, coins: 200, tutorialDone: true, playerLevel: 60, staminaUpdatedAt: Date.now() })
  await db.insert(cards).values({ id: "p1-bt-c", name: "突破卡", rarity: "C", job: "tank", no: 1, total: 1 })
  const [uc] = await db
    .insert(userCards)
    .values({ userId, cardId: "p1-bt-c", level: 40, exp: 1000, serial: 1 })
    .returning()

  // 金币不足 300 时被拦截
  const failCoinRes = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/${uc!.id}/level`,
    headers: auth(userId),
  })
  assert.equal(failCoinRes.statusCode, 400)
  assert.equal(failCoinRes.json().error.code, "not_enough_coins")

  // 补足金币但缺同品质碎片时被拦截，且金币不能被误扣
  await db.update(users).set({ coins: 500 }).where(eq(users.id, userId))
  const failShardRes = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/${uc!.id}/level`,
    headers: auth(userId),
  })
  assert.equal(failShardRes.statusCode, 400)
  assert.equal(failShardRes.json().error.code, "not_enough_items")

  // 补足 2 片 C 碎片后突破成功
  await db.insert(userItems).values({ userId, itemId: "shard-C", count: 3 })
  const okRes = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/${uc!.id}/level`,
    headers: auth(userId),
  })
  assert.equal(okRes.statusCode, 200)
  assert.equal(okRes.json().data.card.level, 41)
  assert.equal(okRes.json().data.coinsSpent, 300)
  assert.equal(okRes.json().data.shardsSpent, 2)
  assert.equal(okRes.json().data.coins, 200)
  assert.equal(okRes.json().data.items["shard-C"], 1)

  // 喂养连续升级跨 40 级：缺碎片时停在 40 级、保留经验并返回 blockedShards；补足碎片后顺利突破
  const [ucFeed] = await db
    .insert(userCards)
    .values({ userId, cardId: "p1-bt-c", level: 39, exp: 0, serial: 2 })
    .returning()
  await db.update(users).set({ coins: 1000 }).where(eq(users.id, userId))
  await db.insert(userItems).values({ userId, itemId: "exp-medium", count: 2 })
  const feedBlocked = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/${ucFeed!.id}/feed`,
    headers: auth(userId),
    payload: { items: [{ itemId: "exp-medium", count: 1 }] },
  })
  assert.equal(feedBlocked.statusCode, 200)
  assert.equal(feedBlocked.json().data.card.level, 40)
  assert.equal(feedBlocked.json().data.blockedShards, 2)
  assert.equal(feedBlocked.json().data.shardsSpent, 0)
  assert.ok(feedBlocked.json().data.card.exp > 0)

  // 补齐碎片后继续喂养，成功跨过 40 级并扣除金币与碎片
  await db.update(userItems).set({ count: 2 }).where(eq(userItems.itemId, "shard-C"))
  const feedOk = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/${ucFeed!.id}/feed`,
    headers: auth(userId),
    payload: { items: [{ itemId: "exp-medium", count: 1 }] },
  })
  assert.equal(feedOk.statusCode, 200)
  assert.ok(feedOk.json().data.card.level > 40)
  assert.equal(feedOk.json().data.coinsSpent, 300)
  assert.equal(feedOk.json().data.shardsSpent, 2)
  assert.equal(feedOk.json().data.blockedShards, 0)
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

await test("碎片+金币「逢 5 自选」洗技能：单卡独立计数、严格同品质碎片、第 5 次自选并归零", async () => {
  const userId = "p1-reroll-user"
  await db.insert(users).values({ id: userId, username: userId, coins: 100, tutorialDone: true, playerLevel: 60, staminaUpdatedAt: Date.now() })
  await db.insert(cards).values([
    { id: "p1-rr-l", name: "洗技能L卡", rarity: "L", job: "warrior", no: 1, total: 1 },
    { id: "hero-777", name: "本体卡", rarity: "L", job: "warrior", no: 2, total: 1, cardType: "hero" },
  ])
  const [lCard] = await db
    .insert(userCards)
    .values({
      userId,
      cardId: "p1-rr-l",
      serial: 1,
      skillRefs: [{ skillId: "ranger_volley" }, { skillId: "berserker_blood" }],
    })
    .returning()
  const [heroCard] = await db
    .insert(userCards)
    .values({
      userId,
      cardId: "hero-777",
      serial: 1,
      skillRefs: [{ skillId: "ranger_volley" }, { skillId: "berserker_blood" }],
    })
    .returning()

  // 本体卡被拦截
  const heroRes = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/${heroCard!.id}/reroll-skill`,
    headers: auth(userId),
    payload: { slot: 0 },
  })
  assert.equal(heroRes.statusCode, 400)
  assert.equal(heroRes.json().error.code, "hero_protected")

  // 金币不足 150 时被拦截
  const noCoin = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/${lCard!.id}/reroll-skill`,
    headers: auth(userId),
    payload: { slot: 0 },
  })
  assert.equal(noCoin.statusCode, 400)
  assert.equal(noCoin.json().error.code, "not_enough_coins")

  // 补足金币但缺 L 碎片时被拦截且不误扣金币
  await db.update(users).set({ coins: 1000 }).where(eq(users.id, userId))
  const noShard = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/${lCard!.id}/reroll-skill`,
    headers: auth(userId),
    payload: { slot: 0 },
  })
  assert.equal(noShard.statusCode, 400)
  assert.equal(noShard.json().error.code, "not_enough_items")

  // 未满 5 次不能提前自选
  await db.insert(userItems).values({ userId, itemId: "shard-L", count: 24 })
  const earlySelect = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/${lCard!.id}/reroll-skill`,
    headers: auth(userId),
    payload: { slot: 0, skillId: "breaker_rend" },
  })
  assert.equal(earlySelect.statusCode, 400)
  assert.equal(earlySelect.json().error.code, "select_not_ready")

  // 连续 4 次随机重洗：每次都不与原技能或另一槽重复，计数递增到 4
  for (let i = 1; i <= 4; i += 1) {
    const r = await app.inject({
      method: "POST",
      url: `/users/${userId}/cards/${lCard!.id}/reroll-skill`,
      headers: auth(userId),
      payload: { slot: 0 },
    })
    assert.equal(r.statusCode, 200)
    const d = r.json().data
    assert.equal(d.mode, "random")
    assert.equal(d.skillRerollCount, i)
    assert.equal(d.coinsSpent, 150)
    assert.equal(d.shardsSpent, 4)
    assert.notEqual(d.newSkillId, d.previousSkillId)
    assert.notEqual(d.newSkillId, d.card.skillRefs[1].skillId)
  }

  // 查询状态：已触发自选
  const infoRes = await app.inject({
    method: "GET",
    url: `/users/${userId}/cards/${lCard!.id}/reroll-skill`,
    headers: auth(userId),
  })
  assert.equal(infoRes.statusCode, 200)
  assert.equal(infoRes.json().data.selectReady, true)
  const candidates: { id: string }[] = infoRes.json().data.candidates
  assert.ok(candidates.length > 0)

  // 第 5 次不传 skillId 被拦截
  const missingSelect = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/${lCard!.id}/reroll-skill`,
    headers: auth(userId),
    payload: { slot: 0 },
  })
  assert.equal(missingSelect.statusCode, 400)
  assert.equal(missingSelect.json().error.code, "skill_id_required")

  // 第 5 次传入候选池中的技能：自选成功且计数归零
  const targetSkillId = candidates[0]!.id
  const selectRes = await app.inject({
    method: "POST",
    url: `/users/${userId}/cards/${lCard!.id}/reroll-skill`,
    headers: auth(userId),
    payload: { slot: 0, skillId: targetSkillId },
  })
  assert.equal(selectRes.statusCode, 200)
  const sd = selectRes.json().data
  assert.equal(sd.mode, "select")
  assert.equal(sd.newSkillId, targetSkillId)
  assert.equal(sd.card.skillRefs[0].skillId, targetSkillId)
  assert.equal(sd.skillRerollCount, 0)
  assert.equal(sd.selectReady, false)
  assert.equal(sd.coins, 1000 - 150 * 5)
  assert.equal(sd.items["shard-L"], 24 - 4 * 5)
})

await test("统一商店：日/周限购、体力药共用上限、碎片博弈盲盒与限量保底兑换", async () => {
  const userId = "p1-shop-user"
  await db.insert(users).values({
    id: userId,
    username: userId,
    coins: 2000,
    stamina: 100,
    tutorialDone: true,
    playerLevel: 60,
    staminaUpdatedAt: Date.now(),
  })
  await db.insert(userItems).values([
    { userId, itemId: "shard-C", count: 40 },
    { userId, itemId: "shard-E", count: 50 },
  ])

  const listRes = await app.inject({
    method: "GET",
    url: `/users/${userId}/shop`,
    headers: auth(userId),
  })
  assert.equal(listRes.statusCode, 200)
  const listItems: { id: string; remaining: number }[] = listRes.json().data.items
  assert.ok(listItems.some((i) => i.id === "stamina-potion" && i.remaining === 2))
  assert.ok(listItems.some((i) => i.id === "shard-box-high" && i.remaining === 3))

  // 买 2 瓶体力药（达到日限 2）→ 第 3 瓶被限购拦截
  const buyPotion = await app.inject({
    method: "POST",
    url: `/users/${userId}/shop/buy`,
    headers: auth(userId),
    payload: { itemId: "stamina-potion", count: 2 },
  })
  assert.equal(buyPotion.statusCode, 200)
  assert.equal(buyPotion.json().data.granted.stamina, 120)
  assert.equal(buyPotion.json().data.remaining, 0)

  const overPotion = await app.inject({
    method: "POST",
    url: `/users/${userId}/shop/buy`,
    headers: auth(userId),
    payload: { itemId: "stamina-potion", count: 1 },
  })
  assert.equal(overPotion.statusCode, 400)
  assert.equal(overPotion.json().error.code, "shop_limit_reached")

  // 碎片博弈盲盒（低阶）：扣 20 C 碎片 + 40 金币，产出随机碎片
  const buyLowBox = await app.inject({
    method: "POST",
    url: `/users/${userId}/shop/buy`,
    headers: auth(userId),
    payload: { itemId: "shard-box-low", count: 1 },
  })
  assert.equal(buyLowBox.statusCode, 200)
  assert.equal(buyLowBox.json().data.items["shard-C"], 20)
  assert.ok(buyLowBox.json().data.granted.items.length > 0)

  // 限量 L 碎片包：买 2 次后周限耗尽，共获得 4 片 L 碎片
  const buyPity = await app.inject({
    method: "POST",
    url: `/users/${userId}/shop/buy`,
    headers: auth(userId),
    payload: { itemId: "shard-l-pity", count: 2 },
  })
  assert.equal(buyPity.statusCode, 200)
  assert.equal(buyPity.json().data.remaining, 0)
  assert.equal(buyPity.json().data.items["shard-E"], 10)
  assert.ok((buyPity.json().data.items["shard-L"] ?? 0) >= 4)

  const overPity = await app.inject({
    method: "POST",
    url: `/users/${userId}/shop/buy`,
    headers: auth(userId),
    payload: { itemId: "shard-l-pity", count: 1 },
  })
  assert.equal(overPity.statusCode, 400)
  assert.equal(overPity.json().error.code, "shop_limit_reached")

  // 碎片不足买高阶赌箱（需 24 E，当前仅剩 10 E）被拦截且不误扣金币
  const coinsBeforeFail = buyPity.json().data.coins
  const failHighBox = await app.inject({
    method: "POST",
    url: `/users/${userId}/shop/buy`,
    headers: auth(userId),
    payload: { itemId: "shard-box-high", count: 1 },
  })
  assert.equal(failHighBox.statusCode, 400)
  assert.equal(failHighBox.json().error.code, "not_enough_items")
  const [uAfterFail] = await db.select({ coins: users.coins }).from(users).where(eq(users.id, userId))
  assert.equal(uAfterFail!.coins, coinsBeforeFail)
})

console.log(`\n${passed} p1 tests passed`)
await app.close()
await dropTestDb()
