/**
 * 功能解锁的服务端校验：没解锁的功能直接调接口会被拒（403 feature_locked），
 * 不能只靠前端藏按钮。等级、引导、是否绑定 osu! 全部以数据库为准。
 * 用临时 PGlite 数据库，不碰开发库。
 *
 *   pnpm test:feature-locks
 */
import assert from "node:assert/strict"

import { setupTestDb } from "./test-db"

const dropTestDb = await setupTestDb("feature-locks")

const { eq } = await import("drizzle-orm")
const { default: Fastify } = await import("fastify")
const { default: cookie } = await import("@fastify/cookie")

const { db } = await import("../src/db/client")
const { users, expeditions } = await import("../src/db/schema")
const { COOKIE_NAME, makeSession } = await import("../src/auth/osu")
const { handleError } = await import("../src/error-handler")
const { questRoutes } = await import("../src/routes/quests")
const { progressionRoutes } = await import("../src/routes/progression")
const { progressRoutes } = await import("../src/routes/progress")
const { marketRoutes } = await import("../src/routes/market")
const { expeditionRoutes } = await import("../src/routes/expeditions")
const { CONTENT } = await import("@choke/shared/content")
const { FEATURE_IDS } = await import("@choke/shared/unlocks")

const app = Fastify()
app.setErrorHandler(handleError)
await app.register(cookie)
for (const routes of [questRoutes, progressionRoutes, progressRoutes, marketRoutes, expeditionRoutes]) {
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

let seq = 0
async function newUser(patch: Partial<typeof users.$inferInsert> = {}) {
  seq += 1
  const id = `lock-test-${seq}`
  await db.insert(users).values({
    id,
    username: id,
    osuId: 500_000 + seq,
    tutorialDone: true,
    playerLevel: 60,
    coins: 1000,
    ...patch,
  })
  return id
}

const call = async (userId: string, method: "GET" | "POST", url: string, payload?: unknown) => {
  const res = await app.inject({
    method,
    url,
    payload: payload as never,
    headers: { cookie: `${COOKIE_NAME}=${makeSession(userId)}` },
  })
  return { status: res.statusCode, body: res.json() }
}

/** 每个功能对应的一个代表接口。请求体故意写得不合法：没解锁时必须先被解锁校验拦下，到不了参数检查 */
const ENDPOINTS: Array<{ feature: string; method: "GET" | "POST"; url: (u: string) => string; body?: unknown }> = [
  { feature: "feed", method: "POST", url: (u) => `/users/${u}/cards/1/feed`, body: { cards: [] } },
  { feature: "fuse", method: "POST", url: (u) => `/users/${u}/cards/1/constellation` },
  { feature: "foil", method: "POST", url: (u) => `/users/${u}/cards/1/enhance`, body: { action: "foil" } },
  { feature: "dismantle", method: "POST", url: (u) => `/users/${u}/cards/1/dismantle` },
  { feature: "npc-recycle", method: "GET", url: (u) => `/users/${u}/cards/recycle` },
  { feature: "npc-recycle", method: "POST", url: (u) => `/users/${u}/cards/recycle`, body: { cards: [] } },
  { feature: "quests", method: "GET", url: (u) => `/users/${u}/quests` },
  { feature: "quests", method: "POST", url: (u) => `/users/${u}/quests/claim-all` },
  { feature: "quests", method: "POST", url: (u) => `/users/${u}/sign-in` },
  { feature: "market", method: "POST", url: (u) => `/users/${u}/market/list`, body: {} },
  { feature: "market", method: "POST", url: (u) => `/users/${u}/market/buy/1` },
]

type Reply = {
  status: number
  body: {
    error?: { code?: string; reason?: string; feature?: string; level?: number; message?: string }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any
  }
}
const isLocked = (res: Reply) => res.status === 403 && res.body?.error?.code === "feature_locked"

console.log("feature lock tests")

await test("白纸新号（Lv1、没做完引导、没绑 osu!）：所有受限接口都被拒，并说明是哪个功能", async () => {
  const guest = await newUser({ osuId: null, tutorialDone: false, playerLevel: 1 })
  for (const e of ENDPOINTS) {
    const res = await call(guest, e.method, e.url(guest), e.body)
    assert.ok(isLocked(res), `${e.method} ${e.url(guest)} 应该被拒：${res.status} ${JSON.stringify(res.body)}`)
    assert.equal(res.body.error.feature, e.feature)
    assert.equal(typeof res.body.error.message, "string")
    assert.equal(typeof res.body.error.level, "number")
  }
})

await test("等级差一级都不行，到了就放行（放行后可能被别的校验拒，但不能再是 feature_locked）", async () => {
  const levels: Record<string, number> = {}
  for (const e of ENDPOINTS) {
    const need = CONTENT.unlocks[e.feature as keyof typeof CONTENT.unlocks].level
    levels[e.feature] = need
    const below = await newUser({ playerLevel: need - 1 })
    const at = await newUser({ playerLevel: need })
    const lowRes = await call(below, e.method, e.url(below), e.body)
    assert.ok(isLocked(lowRes), `Lv${need - 1} 应该被拒：${e.method} ${e.url(below)} ${JSON.stringify(lowRes.body)}`)
    assert.equal(lowRes.body.error.reason, "level")
    assert.equal(lowRes.body.error.level, need)
    const okRes = await call(at, e.method, e.url(at), e.body)
    assert.ok(!isLocked(okRes), `Lv${need} 应该放行：${e.method} ${e.url(at)} ${JSON.stringify(okRes.body)}`)
  }
})

await test("要完成引导的功能：等级够了但引导没做完，照样拒绝", async () => {
  for (const e of ENDPOINTS.filter((x) => CONTENT.unlocks[x.feature as keyof typeof CONTENT.unlocks].tutorial)) {
    const user = await newUser({ tutorialDone: false, playerLevel: 60 })
    const res = await call(user, e.method, e.url(user), e.body)
    assert.ok(isLocked(res), `${e.method} ${e.url(user)} ${JSON.stringify(res.body)}`)
    assert.equal(res.body.error.reason, "tutorial")
  }
})

await test("市场：游客和只有邮箱的账号不行，绑定了 osu! 的才行", async () => {
  const guest = await newUser({ osuId: null, email: null })
  const emailOnly = await newUser({ osuId: null, email: "mail-only@test.local" })
  const linked = await newUser({ playerLevel: 3 })
  for (const user of [guest, emailOnly]) {
    for (const url of [`/users/${user}/market/list`, `/users/${user}/market/buy/1`]) {
      const res = await call(user, "POST", url, {})
      assert.ok(isLocked(res), JSON.stringify(res.body))
      assert.equal(res.body.error.feature, "market")
      assert.equal(res.body.error.reason, "account")
    }
  }
  const res = await call(linked, "POST", `/users/${linked}/market/list`, {})
  assert.ok(!isLocked(res), JSON.stringify(res.body))
})

await test("市场：游客也能看（浏览挂单不受限）", async () => {
  const guest = await newUser({ osuId: null, email: null, playerLevel: 1, tutorialDone: false })
  const res = await call(guest, "GET", `/users/${guest}/market/listings`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
})

await test("任务：Lv2 被拒，Lv3 放行", async () => {
  const early = await newUser({ playerLevel: 2 })
  const res = await call(early, "GET", `/users/${early}/quests`)
  assert.ok(isLocked(res))
  const open = await newUser({ playerLevel: 3 })
  assert.equal((await call(open, "GET", `/users/${open}/quests`)).status, 200)
})

await test("出征：主线要 Lv5，日常和周常不设限；被拒时不会留下出征", async () => {
  const user = await newUser({ playerLevel: 4 })
  const base = `/users/${user}/expeditions`
  const body = (mapId: string) => ({
    mapId,
    cardIds: [1],
    allocation: { slots: 4, apUpgrade: false, maxRarity: "L" },
  })
  const main = await call(user, "POST", base, body("test-trial"))
  assert.ok(isLocked(main), JSON.stringify(main.body))
  assert.equal(main.body.error.feature, "mainline")
  const daily = await call(user, "POST", base, body("test-daily"))
  assert.ok(!isLocked(daily), `日常图不应该被解锁表拦：${JSON.stringify(daily.body)}`)
  const rows = await db.select().from(expeditions).where(eq(expeditions.userId, user))
  assert.equal(rows.length, 0)
})

await test("出征地图列表：没解锁的图标 startable=false 并带原因，日常图照常可开", async () => {
  const user = await newUser({ playerLevel: 4 })
  const res = await call(user, "GET", `/users/${user}/expeditions/maps`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const maps: Array<{ id: string; startable: boolean; lockedReason: string | null }> = res.body.data
  const byId = new Map(maps.map((m) => [m.id, m]))
  assert.equal(byId.get("test-trial")?.startable, false)
  assert.equal(typeof byId.get("test-trial")?.lockedReason, "string")
  assert.equal(byId.get("test-daily")?.startable, true)
  assert.equal(byId.get("test-daily")?.lockedReason, null)

  const high = await newUser({ playerLevel: 60 })
  const all: Array<{ startable: boolean; lockedReason: string | null }> = (
    await call(high, "GET", `/users/${high}/expeditions/maps`)
  ).body.data
  assert.ok(all.every((m) => m.startable && m.lockedReason === null))
})

await test("/progress 带上每个功能的锁状态，和服务端实际校验一致", async () => {
  const user = await newUser({ playerLevel: 5, tutorialDone: true, osuId: null })
  const res = await call(user, "GET", `/users/${user}/progress`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.data.linkedAccount, false, "没绑 osu! 的号要告诉前端")
  const locks = res.body.data.locks as Record<string, { reason: string; level: number; message: string } | null>
  assert.deepEqual(Object.keys(locks).sort(), [...FEATURE_IDS].sort())
  assert.equal(locks["feed"], null)
  assert.equal(locks["mainline"], null)
  assert.equal(locks["fuse"]?.reason, "level")
  assert.equal(locks["fuse"]?.level, CONTENT.unlocks.fuse.level)
  assert.equal(locks["market"]?.reason, "account")
  assert.equal(typeof locks["market"]?.message, "string")
})

await test("不信前端：身份只看数据库，别人的号也碰不到", async () => {
  const victim = await newUser({ playerLevel: 1, tutorialDone: false })
  const attacker = await newUser({ playerLevel: 60 })
  const res = await call(attacker, "POST", `/users/${victim}/cards/1/feed`, { cards: [] })
  assert.equal(res.status, 403)
  assert.notEqual(res.body.error.code, "feature_locked", "越权应该是 forbidden，而不是解锁问题")
})

console.log(`\n${passed} passed`)
await cleanup()
