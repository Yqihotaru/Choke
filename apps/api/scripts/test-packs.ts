/**
 * 开包与卡包库存的事务测试：
 * 开包失败整体回滚不丢包、最后两个新手包同时开只触发一次保底、桌面卡包 token 只核销一次、
 * 神秘包并发领取只发一张本体卡、无包/无效 token 的拒绝。用临时 PGlite 数据库，不碰开发库。
 *
 *   pnpm --filter @choke/api exec tsx scripts/test-packs.ts
 */
import assert from "node:assert/strict"

import { setupTestDb } from "./test-db"

const dropTestDb = await setupTestDb("packs")

const { and, eq } = await import("drizzle-orm")
const { default: Fastify } = await import("fastify")
const { default: cookie } = await import("@fastify/cookie")
const { db } = await import("../src/db/client")
const { cards, ledgerEntries, packTokens, userCards, userPacks, users } = await import("../src/db/schema")
const { COOKIE_NAME, makeSession } = await import("../src/auth/osu")
const { handleError } = await import("../src/error-handler")
const { packRoutes } = await import("../src/routes/packs")
const { invalidateCardCache } = await import("../src/gacha/open")
const { createPackToken } = await import("../src/packs/inventory")

const app = Fastify()
app.setErrorHandler(handleError)
await app.register(cookie)
await app.register(packRoutes)
await app.ready()

let passed = 0
async function test(name: string, fn: () => Promise<void> | void) {
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

async function makeUser(id: string, packs: Record<string, number>, patch: Partial<typeof users.$inferInsert> = {}) {
  await db.insert(users).values({
    id,
    username: id,
    onboarded: true,
    tutorialDone: true,
    ...patch,
  })
  for (const [pool, count] of Object.entries(packs)) {
    await db.insert(userPacks).values({ userId: id, pool, count })
  }
}

async function packCount(userId: string, pool: string) {
  const [row] = await db
    .select({ count: userPacks.count })
    .from(userPacks)
    .where(and(eq(userPacks.userId, userId), eq(userPacks.pool, pool)))
  return row?.count ?? 0
}

function openAs(userId: string, pool: string, token?: string) {
  return app.inject({
    method: "POST",
    url: `/packs/${pool}/open`,
    headers: auth(userId),
    payload: token ? { token } : {},
  })
}

const HIGH = new Set(["L", "Mythic", "Prismatic"])

// 卡池里一张卡都没有：开包必然失败。这一组要最先跑（卡池 id 会被缓存）
await test("开包失败：整体回滚，包还在、没有多余的流水", async () => {
  await makeUser("pk-fail", { normal: 1 })
  const res = await openAs("pk-fail", "normal")
  assert.equal(res.statusCode, 500)
  assert.equal(await packCount("pk-fail", "normal"), 1)
  const ledger = await db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, "pk-fail"))
  assert.equal(ledger.length, 0)
})

// 每个稀有度放一张卡，再清掉缓存
const rarities = ["C", "UC", "R", "E", "L", "Mythic", "Prismatic"] as const
await db.insert(cards).values(
  rarities.map((rarity, i) => ({
    id: `pk-card-${rarity}`,
    name: `卡${rarity}`,
    rarity,
    job: "warrior" as const,
    no: i + 1,
    total: rarities.length,
  })),
)
invalidateCardCache()

await test("没有这个卡包：400 no_packs，且不会变成负数", async () => {
  await makeUser("pk-empty", {})
  const res = await openAs("pk-empty", "normal")
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error.code, "no_packs")
  assert.equal(await packCount("pk-empty", "normal"), 0)
})

await test("开包：扣一包，发 5 张卡，流水里有 -1 个包", async () => {
  await makeUser("pk-ok", { normal: 2 })
  const res = await openAs("pk-ok", "normal")
  assert.equal(res.statusCode, 200, res.body)
  assert.equal(res.json().data.results.length, 5)
  assert.equal(await packCount("pk-ok", "normal"), 1)
  const packLedger = await db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.userId, "pk-ok"), eq(ledgerEntries.kind, "pack")))
  assert.equal(packLedger.reduce((sum, row) => sum + row.delta, 0), -1)
})

await test("同时点开 5 次、只有 2 个包：只成功 2 次，库存归零", async () => {
  await makeUser("pk-burst", { normal: 2 })
  const results = await Promise.all(Array.from({ length: 5 }, () => openAs("pk-burst", "normal")))
  assert.equal(results.filter((r) => r.statusCode === 200).length, 2)
  assert.equal(results.filter((r) => r.statusCode === 400).length, 3)
  assert.equal(await packCount("pk-burst", "normal"), 0)
  const owned = await db.select().from(userCards).where(eq(userCards.userId, "pk-burst"))
  assert.equal(owned.length >= 10, true)
})

await test("最后两个新手包同时开：保底只触发一次，且这 10 张里至少有一张传说及以上", async () => {
  for (let round = 0; round < 8; round += 1) {
    const id = `pk-starter-${round}`
    await makeUser(id, { starter: 2 })
    const [a, b] = await Promise.all([openAs(id, "starter"), openAs(id, "starter")])
    assert.equal(a.statusCode, 200, a.body)
    assert.equal(b.statusCode, 200, b.body)
    const all = [...a.json().data.results, ...b.json().data.results] as { rarity: string; guaranteed?: boolean }[]
    assert.ok(all.filter((card) => card.guaranteed).length <= 1, `第 ${round} 轮保底触发了两次`)
    assert.ok(all.some((card) => HIGH.has(card.rarity)), `第 ${round} 轮没有拿到传说`)
    assert.equal(await packCount(id, "starter"), 0)
  }
})

await test("桌面卡包 token：拿到桌面扣一次库存，开包核销 token，不会再扣背包", async () => {
  await makeUser("pk-token", { normal: 2 })
  const token = await createPackToken("pk-token", "normal")
  assert.ok(token)
  assert.equal(await packCount("pk-token", "normal"), 1)
  const res = await openAs("pk-token", "normal", token!)
  assert.equal(res.statusCode, 200, res.body)
  assert.equal(await packCount("pk-token", "normal"), 1)
  const left = await db.select().from(packTokens).where(eq(packTokens.userId, "pk-token"))
  assert.equal(left.length, 0)
  // 同一个 token 不能再用，也不能顺手扣背包
  const again = await openAs("pk-token", "normal", token!)
  assert.equal(again.statusCode, 400)
  assert.equal(again.json().error.code, "invalid_token")
  assert.equal(await packCount("pk-token", "normal"), 1)
})

await test("桌面卡包 token：同一个 token 同时开两次，只成功一次", async () => {
  await makeUser("pk-token2", { normal: 1 })
  const token = await createPackToken("pk-token2", "normal")
  const [a, b] = await Promise.all([openAs("pk-token2", "normal", token!), openAs("pk-token2", "normal", token!)])
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 400])
})

await test("拿到桌面再放回：库存回到原样，token 失效", async () => {
  await makeUser("pk-return", { normal: 1 })
  const token = await createPackToken("pk-return", "normal")
  assert.equal(await packCount("pk-return", "normal"), 0)
  const res = await app.inject({
    method: "POST",
    url: "/users/pk-return/packs/return",
    headers: auth("pk-return"),
    payload: { token },
  })
  assert.equal(res.statusCode, 200, res.body)
  assert.equal(await packCount("pk-return", "normal"), 1)
  const again = await app.inject({
    method: "POST",
    url: "/users/pk-return/packs/return",
    headers: auth("pk-return"),
    payload: { token },
  })
  assert.equal(again.statusCode, 400)
  assert.equal(await packCount("pk-return", "normal"), 1)
})

await test("神秘包：同时领两次，只发一张本体卡、只扣一个包", async () => {
  await db.insert(cards).values({
    id: "hero-4242",
    name: "本体",
    rarity: "L",
    job: "warrior",
    no: 99,
    total: 99,
    cardType: "hero",
  })
  await makeUser("pk-mystery", { mystery: 2 }, { osuId: 4242 })
  const call = () =>
    app.inject({
      method: "POST",
      url: "/users/pk-mystery/packs/mystery/open",
      headers: auth("pk-mystery"),
      payload: {},
    })
  const results = await Promise.all([call(), call(), call()])
  assert.equal(results.filter((r) => r.statusCode === 200).length, 1, results.map((r) => r.body).join("\n"))
  assert.ok(results.filter((r) => r.statusCode !== 200).every((r) => r.json().error.code === "hero_claimed"))
  const heroes = await db
    .select()
    .from(userCards)
    .where(and(eq(userCards.userId, "pk-mystery"), eq(userCards.cardId, "hero-4242")))
  assert.equal(heroes.length, 1)
  assert.equal(await packCount("pk-mystery", "mystery"), 1)
})

await test("神秘包：没有包就拒绝，不发本体卡", async () => {
  await db.insert(cards).values({
    id: "hero-4343",
    name: "本体2",
    rarity: "L",
    job: "warrior",
    no: 100,
    total: 99,
    cardType: "hero",
  })
  await makeUser("pk-mystery0", {}, { osuId: 4343 })
  const res = await app.inject({
    method: "POST",
    url: "/users/pk-mystery0/packs/mystery/open",
    headers: auth("pk-mystery0"),
    payload: {},
  })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error.code, "no_packs")
  const heroes = await db.select().from(userCards).where(eq(userCards.userId, "pk-mystery0"))
  assert.equal(heroes.length, 0)
})

console.log(`\n全部通过：${passed} 项`)
await app.close()
await dropTestDb()
