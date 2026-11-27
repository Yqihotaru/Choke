/**
 * 在线心跳与挂机包累计的服务端测试：
 * 正常计时、离线超时不补发、每日封顶、北京时间 4:00 换日清零、多标签页并发不重复计时、
 * 心跳接口鉴权、挂机包按累计分钟领取。用临时 PGlite 数据库，不碰开发库。
 *
 *   pnpm --filter @choke/api exec tsx scripts/test-presence.ts
 */
import assert from "node:assert/strict"

import { setupTestDb } from "./test-db"

const dropTestDb = await setupTestDb("presence")

const { eq } = await import("drizzle-orm")
const { default: Fastify } = await import("fastify")
const { default: cookie } = await import("@fastify/cookie")
const { db } = await import("../src/db/client")
const { users } = await import("../src/db/schema")
const { COOKIE_NAME, makeSession } = await import("../src/auth/osu")
const { handleError } = await import("../src/error-handler")
const { recordBeat } = await import("../src/presence")
const { presenceRoutes } = await import("../src/routes/presence")
const { packRoutes } = await import("../src/routes/packs")
const {
  HEARTBEAT_MAX_MS,
  HEARTBEAT_MIN_MS,
  IDLE_PACKS_DAILY_LIMIT,
  ONLINE_TIMEOUT_MS,
  idlePacksEarned,
  isOnline,
  nextHeartbeatDelay,
} = await import("@choke/shared/presence")
const { resetDayKey } = await import("@choke/shared/reset")

const app = Fastify()
app.setErrorHandler(handleError)
await app.register(cookie)
await app.register(presenceRoutes)
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

/** 北京时间某天 hh:mm（换算成时间戳） */
function beijing(date: string, hh: number, mm = 0, ss = 0): number {
  return Date.parse(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}+08:00`)
}

async function makeUser(id: string, patch: Partial<typeof users.$inferInsert> = {}) {
  await db.insert(users).values({ id, username: id, staminaUpdatedAt: Date.now(), ...patch })
}

async function setLastSeen(id: string, at: number) {
  await db.update(users).set({ lastSeenAt: new Date(at) }).where(eq(users.id, id))
}

async function seconds(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id))
  return row!
}

const NOON = beijing("2026-03-10", 12)

await test("纯函数：心跳间隔随机范围、累计折算、在线判定", () => {
  assert.equal(nextHeartbeatDelay(() => 0), HEARTBEAT_MIN_MS)
  assert.equal(nextHeartbeatDelay(() => 1), HEARTBEAT_MAX_MS)
  assert.ok(HEARTBEAT_MAX_MS < ONLINE_TIMEOUT_MS)
  assert.equal(idlePacksEarned(0), 0)
  assert.equal(idlePacksEarned(59), 0)
  assert.equal(idlePacksEarned(60), 1)
  assert.equal(idlePacksEarned(125), 2)
  assert.equal(idlePacksEarned(10 ** 9), IDLE_PACKS_DAILY_LIMIT)
  assert.equal(idlePacksEarned(-5), 0)
  assert.equal(isOnline(NOON, NOON + 30_000), true)
  assert.equal(isOnline(NOON, NOON + ONLINE_TIMEOUT_MS + 1), false)
  assert.equal(isOnline(null, NOON), false)
})

await test("正常心跳：按两次心跳的间隔计时", async () => {
  await makeUser("pr-normal")
  await setLastSeen("pr-normal", NOON - 30_000)
  const a = await recordBeat("pr-normal", NOON)
  assert.equal(a?.onlineSeconds, 30)
  const b = await recordBeat("pr-normal", NOON + 25_000)
  assert.equal(b?.onlineSeconds, 55)
  const row = await seconds("pr-normal")
  assert.equal(row.onlineDay, resetDayKey(NOON))
  assert.equal(row.lastSeenAt.getTime(), NOON + 25_000)
})

await test("离线很久后回来：这段时间不补发", async () => {
  await makeUser("pr-gap")
  await setLastSeen("pr-gap", NOON - 3 * 3600_000)
  const a = await recordBeat("pr-gap", NOON)
  assert.equal(a?.onlineSeconds, 0)
  // 刚好卡在超时线上算在线
  await setLastSeen("pr-gap", NOON - ONLINE_TIMEOUT_MS)
  const b = await recordBeat("pr-gap", NOON)
  assert.equal(b?.onlineSeconds, ONLINE_TIMEOUT_MS / 1000)
  // 超过一点点就不算
  await setLastSeen("pr-gap", NOON - ONLINE_TIMEOUT_MS - 1000)
  const c = await recordBeat("pr-gap", NOON)
  assert.equal(c?.onlineSeconds, ONLINE_TIMEOUT_MS / 1000)
})

await test("时钟倒退或同一时刻重复心跳：不会计入负数或重复计时", async () => {
  await makeUser("pr-clock")
  await setLastSeen("pr-clock", NOON)
  assert.equal((await recordBeat("pr-clock", NOON - 10_000))?.onlineSeconds, 0)
  assert.equal((await recordBeat("pr-clock", NOON))?.onlineSeconds, 0)
  assert.equal((await seconds("pr-clock")).lastSeenAt.getTime(), NOON)
})

await test("多标签页同时发心跳：总量不超过真实经过的时间", async () => {
  await makeUser("pr-tabs")
  await setLastSeen("pr-tabs", NOON - 30_000)
  await Promise.all(Array.from({ length: 8 }, () => recordBeat("pr-tabs", NOON)))
  assert.equal((await seconds("pr-tabs")).onlineSeconds, 30)
})

await test("每日封顶：满额之后不再增长", async () => {
  await makeUser("pr-cap", { onlineDay: resetDayKey(NOON), onlineSeconds: IDLE_PACKS_DAILY_LIMIT * 60 - 10 })
  await setLastSeen("pr-cap", NOON - 30_000)
  const a = await recordBeat("pr-cap", NOON)
  assert.equal(a?.onlineSeconds, IDLE_PACKS_DAILY_LIMIT * 60)
  await setLastSeen("pr-cap", NOON + 60_000 - 30_000)
  const b = await recordBeat("pr-cap", NOON + 60_000)
  assert.equal(b?.onlineSeconds, IDLE_PACKS_DAILY_LIMIT * 60)
})

await test("北京时间 4:00 换日：累计清零，跨过 4:00 的那段算进新的一天", async () => {
  const before = beijing("2026-03-10", 3, 59, 40)
  const after = beijing("2026-03-10", 4, 0, 10)
  assert.notEqual(resetDayKey(before), resetDayKey(after))
  await makeUser("pr-day", { onlineDay: resetDayKey(before), onlineSeconds: 1800 })
  await setLastSeen("pr-day", before)
  const a = await recordBeat("pr-day", after)
  assert.equal(a?.onlineDay, resetDayKey(after))
  assert.equal(a?.onlineSeconds, 30)
})

await test("心跳接口：未登录 401，登录后返回今天的累计秒数", async () => {
  await makeUser("pr-http")
  const anon = await app.inject({ method: "POST", url: "/presence/beat" })
  assert.equal(anon.statusCode, 401)
  const ok = await app.inject({ method: "POST", url: "/presence/beat", headers: auth("pr-http") })
  assert.equal(ok.statusCode, 200)
  assert.equal(typeof ok.json().data.onlineSeconds, "number")
})

await test("挂机包：按累计分钟领取，累计不足时提示，新的一天重新累计", async () => {
  const now = Date.now()
  await makeUser("pr-claim", { onlineDay: resetDayKey(now), onlineSeconds: 185 })
  const info = await app.inject({ method: "GET", url: "/users/pr-claim/packs/idle", headers: auth("pr-claim") })
  assert.equal(info.json().data.earned, 3)
  assert.equal(info.json().data.claimable, 3)

  const first = await app.inject({ method: "POST", url: "/users/pr-claim/packs/idle/claim", headers: auth("pr-claim") })
  assert.equal(first.statusCode, 200)
  assert.equal(first.json().data.claimed, 3)

  const again = await app.inject({ method: "POST", url: "/users/pr-claim/packs/idle/claim", headers: auth("pr-claim") })
  assert.equal(again.statusCode, 400)
  assert.equal(again.json().error.code, "nothing_to_claim")

  // 再在线 1 分钟，又能领 1 个；已领的不会重复算
  await db.update(users).set({ onlineSeconds: 245 }).where(eq(users.id, "pr-claim"))
  const next = await app.inject({ method: "POST", url: "/users/pr-claim/packs/idle/claim", headers: auth("pr-claim") })
  assert.equal(next.json().data.claimed, 1)

  // 记录是前一天的：今天的累计视为 0
  await db.update(users).set({ onlineDay: "2000-01-01", onlineSeconds: 3000 }).where(eq(users.id, "pr-claim"))
  const stale = await app.inject({ method: "GET", url: "/users/pr-claim/packs/idle", headers: auth("pr-claim") })
  assert.equal(stale.json().data.earned, 0)
  assert.equal(stale.json().data.onlineSeconds, 0)
})

await test("挂机包：两个领取请求同时发，只发一份", async () => {
  const now = Date.now()
  await makeUser("pr-race", { onlineDay: resetDayKey(now), onlineSeconds: 600 })
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      app.inject({ method: "POST", url: "/users/pr-race/packs/idle/claim", headers: auth("pr-race") }),
    ),
  )
  const claimed = results.reduce((sum, res) => sum + (res.statusCode === 200 ? res.json().data.claimed : 0), 0)
  assert.equal(claimed, 10)
  assert.equal(results.filter((res) => res.statusCode === 200).length, 1)
})

console.log(`\n全部通过：${passed} 项`)
await app.close()
await dropTestDb()
