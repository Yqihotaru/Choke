/**
 * 在线心跳的服务端测试：
 * 心跳只更新“最后在线时间”、时钟倒退不回退、多标签页并发没问题、心跳接口鉴权。
 * 用临时 PGlite 数据库，不碰开发库。
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
const { HEARTBEAT_MAX_MS, HEARTBEAT_MIN_MS, ONLINE_TIMEOUT_MS, isOnline, nextHeartbeatDelay } = await import(
  "@choke/shared/presence"
)

const app = Fastify()
app.setErrorHandler(handleError)
await app.register(cookie)
await app.register(presenceRoutes)
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

async function makeUser(id: string) {
  await db.insert(users).values({ id, username: id })
}

async function setLastSeen(id: string, at: number) {
  await db.update(users).set({ lastSeenAt: new Date(at) }).where(eq(users.id, id))
}

async function lastSeen(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id))
  return row!.lastSeenAt.getTime()
}

const NOON = Date.parse("2026-03-10T12:00:00+08:00")

await test("纯函数：心跳间隔随机范围、在线判定", () => {
  assert.equal(nextHeartbeatDelay(() => 0), HEARTBEAT_MIN_MS)
  assert.equal(nextHeartbeatDelay(() => 1), HEARTBEAT_MAX_MS)
  assert.ok(HEARTBEAT_MAX_MS < ONLINE_TIMEOUT_MS)
  assert.equal(isOnline(NOON, NOON + 30_000), true)
  assert.equal(isOnline(NOON, NOON + ONLINE_TIMEOUT_MS + 1), false)
  assert.equal(isOnline(null, NOON), false)
})

await test("正常心跳：最后在线时间推到这次心跳", async () => {
  await makeUser("pr-normal")
  await setLastSeen("pr-normal", NOON - 30_000)
  assert.equal(await recordBeat("pr-normal", NOON), true)
  assert.equal(await lastSeen("pr-normal"), NOON)
  assert.equal(await recordBeat("pr-normal", NOON + 25_000), true)
  assert.equal(await lastSeen("pr-normal"), NOON + 25_000)
})

await test("时钟倒退：最后在线时间不回退", async () => {
  await makeUser("pr-clock")
  await setLastSeen("pr-clock", NOON)
  assert.equal(await recordBeat("pr-clock", NOON - 10_000), true)
  assert.equal(await lastSeen("pr-clock"), NOON)
})

await test("多标签页同时发心跳：都成功，时间取最新的", async () => {
  await makeUser("pr-tabs")
  await setLastSeen("pr-tabs", NOON - 30_000)
  const results = await Promise.all(Array.from({ length: 8 }, () => recordBeat("pr-tabs", NOON)))
  assert.ok(results.every(Boolean))
  assert.equal(await lastSeen("pr-tabs"), NOON)
})

await test("用户不存在：返回 false", async () => {
  assert.equal(await recordBeat("pr-nobody", NOON), false)
})

await test("心跳接口：未登录 401，登录后 200", async () => {
  await makeUser("pr-http")
  const anon = await app.inject({ method: "POST", url: "/presence/beat" })
  assert.equal(anon.statusCode, 401)
  const ok = await app.inject({ method: "POST", url: "/presence/beat", headers: auth("pr-http") })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().ok, true)
})

console.log(`\n全部通过：${passed} 项`)
await app.close()
await dropTestDb()
