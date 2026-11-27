/**
 * 账号绑定与进度继承：游客号 / 邮箱号绑定 osu!、osu! 号反向补绑邮箱、二选一后封存落选账号。
 * osu! 的 OAuth 用假的 fetch 顶替，用临时 PGlite 数据库，不碰开发库。
 *
 *   pnpm test:account-binding
 */
import assert from "node:assert/strict"

import { setupTestDb } from "./test-db"

const dropTestDb = await setupTestDb("account-binding")

const { and, eq } = await import("drizzle-orm")
const { default: Fastify } = await import("fastify")
const { default: cookie } = await import("@fastify/cookie")

const { db } = await import("../src/db/client")
const { cards, marketListings, userCards, userPacks, users } = await import("../src/db/schema")
const { COOKIE_NAME, makeSession, readSession } = await import("../src/auth/osu")
const { hashPassword } = await import("../src/auth/email")
const { handleError } = await import("../src/error-handler")
const { authRoutes } = await import("../src/routes/auth")
const { accountRoutes } = await import("../src/routes/account")
const { rejectSealedSession } = await import("../src/account-binding")

const app = Fastify()
app.setErrorHandler(handleError)
await app.register(cookie)
app.addHook("onRequest", rejectSealedSession)
await app.register(authRoutes)
await app.register(accountRoutes)
await app.ready()

/* ---------- 假的 osu! OAuth：token 随便给，/me 返回 nextMe ---------- */
interface FakeMe {
  id: number
  username: string
}
let nextMe: FakeMe = { id: 1, username: "x" }
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = String(input)
  if (url.includes("osu.ppy.sh/oauth/token")) return Response.json({ access_token: "fake" })
  if (url.includes("osu.ppy.sh/api/v2/me/osu")) {
    return Response.json({
      id: nextMe.id,
      username: nextMe.username,
      avatar_url: "",
      country_code: "CN",
      follower_count: 0,
      statistics: { pp: 100 },
    })
  }
  return realFetch(input, init)
}) as typeof fetch

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
  globalThis.fetch = realFetch
  await app.close().catch(() => {})
  await dropTestDb()
}

/* ---------- 小工具 ---------- */
let seq = 0
async function newUser(patch: Partial<typeof users.$inferInsert> = {}) {
  seq += 1
  const id = patch.id ?? `bind-test-${seq}`
  await db.insert(users).values({
    id,
    username: id,
    tutorialDone: true,
    playerLevel: 5,
    coins: 100,
    ...patch,
  })
  return id
}

const as = (userId?: string) => (userId ? { cookie: `${COOKIE_NAME}=${makeSession(userId)}` } : {})
const api = (method: "GET" | "POST", url: string, userId?: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as never, headers: as(userId) })

const stateOf = (location: string | undefined) => new URL(location!).searchParams.get("state")!

/** 已登录账号发起绑定 → 假 osu! 回调；返回前端会看到的 bind 结果 */
async function bindAs(userId: string, me: FakeMe, cookieUserId: string | undefined = userId) {
  const start = await api("GET", "/auth/osu/bind", userId)
  assert.equal(start.statusCode, 302)
  const state = stateOf(start.headers.location as string)
  nextMe = me
  const res = await api("GET", `/auth/osu/callback?code=c&state=${state}`, cookieUserId)
  assert.equal(res.statusCode, 302, res.body)
  const back = new URL(res.headers.location as string)
  return { bind: back.searchParams.get("bind"), reason: back.searchParams.get("reason") }
}

/** 不带绑定的普通 osu! 登录：返回登录后的账号 id */
async function osuLogin(me: FakeMe) {
  const start = await api("GET", "/auth/osu")
  const state = stateOf(start.headers.location as string)
  nextMe = me
  const res = await api("GET", `/auth/osu/callback?code=c&state=${state}`)
  assert.equal(res.statusCode, 302, res.body)
  const session = res.cookies.find((c) => c.name === COOKIE_NAME)
  assert.ok(session, "登录后要写登录态")
  return readSession(session.value)!
}

const packsOf = async (userId: string, pool = "mystery") => {
  const [row] = await db
    .select({ count: userPacks.count })
    .from(userPacks)
    .where(and(eq(userPacks.userId, userId), eq(userPacks.pool, pool)))
  return row?.count ?? 0
}
const rowOf = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]!

let osuSeq = 700_000
const freshOsu = (name = "player") => ({ id: ++osuSeq, username: `${name}${osuSeq}` })

await db.insert(cards).values({ id: "bind-card-e", name: "bind-card-e", rarity: "E", job: "warrior", no: 1, total: 1 })

/* ============================ 测试 ============================ */

await test("游客绑定没人用过的 osu! 号：直接挂上，补发一个神秘卡包", async () => {
  const guest = await newUser({ id: "guest-bindtest1" })
  const me = freshOsu()
  assert.deepEqual(await bindAs(guest, me), { bind: "linked", reason: null })
  const row = await rowOf(guest)
  assert.equal(row.osuId, me.id)
  assert.equal(await packsOf(guest), 1)

  const info = (await api("GET", "/auth/me", guest)).json().data
  assert.equal(info.kind, "osu")
  assert.equal(info.osuId, me.id)
})

await test("邮箱号手上已有神秘卡包：绑定不重复补发", async () => {
  const mail = await newUser({ id: "email-bindtest2", email: "a@test.dev", passwordHash: hashPassword("password1") })
  await db.insert(userPacks).values({ userId: mail, pool: "mystery", count: 1 })
  assert.deepEqual(await bindAs(mail, freshOsu()), { bind: "linked", reason: null })
  assert.equal(await packsOf(mail), 1)
})

await test("已经绑过 osu! 的号不能再绑", async () => {
  const user = await newUser({ osuId: ++osuSeq })
  assert.deepEqual(await bindAs(user, freshOsu()), { bind: "error", reason: "already_linked" })
})

await test("回调时登录态不是发起绑定的那个：拒绝，什么都不改", async () => {
  const a = await newUser()
  const b = await newUser()
  const me = freshOsu()
  assert.deepEqual(await bindAs(a, me, b), { bind: "error", reason: "session_changed" })
  assert.equal((await rowOf(a)).osuId, null)
  assert.equal((await rowOf(b)).osuId, null)
})

await test("state 只能用一次", async () => {
  const user = await newUser()
  const start = await api("GET", "/auth/osu/bind", user)
  const state = stateOf(start.headers.location as string)
  nextMe = freshOsu()
  assert.equal((await api("GET", `/auth/osu/callback?code=c&state=${state}`, user)).statusCode, 302)
  assert.equal((await api("GET", `/auth/osu/callback?code=c&state=${state}`, user)).statusCode, 400)
})

await test("没登录不能发起绑定", async () => {
  const res = await api("GET", "/auth/osu/bind")
  assert.equal(res.statusCode, 302)
  assert.match(String(res.headers.location), /reason=unauthorized/)
})

/* ---------- 冲突：二选一 ---------- */

/** 造一个「已经有进度的 osu! 号」：等级、一张卡、一条在售挂单（押金 30） */
async function progressedOsuUser(patch: Partial<typeof users.$inferInsert> = {}) {
  const me = freshOsu("veteran")
  const id = await newUser({ id: `osu-${me.id}`, osuId: me.id, playerLevel: 30, coins: 5000, ...patch })
  const [card] = await db.insert(userCards).values({ userId: id, cardId: "bind-card-e" }).returning({ id: userCards.id })
  await db.insert(marketListings).values({ sellerId: id, userCardId: card!.id, price: 50, deposit: 30 })
  return { id, me, userCardId: card!.id }
}

await test("没有待确认的绑定时，resolve 返回 404；没带确认返回 400", async () => {
  const user = await newUser()
  const none = await api("POST", "/auth/bind/resolve", user, { choice: "keep-current", confirm: true })
  assert.equal(none.statusCode, 404)
  assert.equal(none.json().error.code, "no_pending_bind")
  const bad = await api("POST", "/auth/bind/resolve", user, { choice: "keep-current" })
  assert.equal(bad.statusCode, 400)
})

await test("osu! 号已有进度：先给玩家看对比，不动任何一边", async () => {
  const veteran = await progressedOsuUser()
  const guest = await newUser({ id: "guest-bindtest3", playerLevel: 7, coins: 120 })
  assert.deepEqual(await bindAs(guest, veteran.me), { bind: "choose", reason: null })

  const { pending } = (await api("GET", "/auth/bind/pending", guest)).json().data
  assert.equal(pending.osuId, veteran.me.id)
  assert.equal(pending.current.id, guest)
  assert.equal(pending.current.level, 7)
  assert.equal(pending.current.kind, "guest")
  assert.equal(pending.osu.id, veteran.id)
  assert.equal(pending.osu.level, 30)
  assert.equal(pending.osu.cardCount, 1)
  assert.equal(pending.osu.bestRarity, "E")
  assert.equal(pending.osu.coins, 5000)

  assert.equal((await rowOf(guest)).osuId, null, "没确认前不能改")
  assert.equal((await rowOf(veteran.id)).osuId, veteran.me.id)
  // 别人看不到这个待确认
  const other = await newUser()
  assert.equal((await api("GET", "/auth/bind/pending", other)).json().data.pending, null)
})

await test("保留当前账号：osu! 号落选封存，挂单下架退押金，osu! id 挪到当前账号", async () => {
  const veteran = await progressedOsuUser()
  const guest = await newUser({ id: "guest-bindtest4" })
  await bindAs(guest, veteran.me)

  const res = await api("POST", "/auth/bind/resolve", guest, { choice: "keep-current", confirm: true })
  assert.equal(res.statusCode, 200, res.body)
  assert.deepEqual(res.json().data, { userId: guest, sealedUserId: veteran.id, kept: "current" })
  const session = res.cookies.find((c) => c.name === COOKIE_NAME)
  assert.equal(readSession(session!.value), guest)

  const winner = await rowOf(guest)
  assert.equal(winner.osuId, veteran.me.id)
  assert.equal(await packsOf(guest), 1, "留下来的账号补发神秘卡包去领本体卡")

  const loser = await rowOf(veteran.id)
  assert.ok(loser.sealedAt)
  assert.equal(loser.sealedInto, guest)
  assert.equal(loser.sealedOsuId, veteran.me.id)
  assert.equal(loser.osuId, null)
  assert.equal(loser.coins, 5030, "挂单押金退还")
  const [listing] = await db.select().from(marketListings).where(eq(marketListings.sellerId, veteran.id))
  assert.equal(listing!.status, "cancelled")
  // 不合并：封存账号的卡还在它自己名下
  assert.equal((await db.select().from(userCards).where(eq(userCards.userId, veteran.id))).length, 1)
  assert.equal((await db.select().from(userCards).where(eq(userCards.userId, guest))).length, 0)

  // 待确认已用掉
  assert.equal((await api("GET", "/auth/bind/pending", guest)).json().data.pending, null)
})

await test("封存的账号登录态失效；用 osu! 登录会进到留下来的账号", async () => {
  const veteran = await progressedOsuUser()
  const guest = await newUser({ id: "guest-bindtest5" })
  await bindAs(guest, veteran.me)
  await api("POST", "/auth/bind/resolve", guest, { choice: "keep-current", confirm: true })

  const sealed = await api("GET", "/auth/me", veteran.id)
  assert.equal(sealed.statusCode, 401)
  assert.ok(sealed.cookies.some((c) => c.name === COOKIE_NAME && c.value === ""), "顺手清掉 cookie")

  assert.equal(await osuLogin(veteran.me), guest)
})

await test("保留 osu! 账号：当前账号封存，邮箱和密码跟着走，邮箱登录进到 osu! 号", async () => {
  const veteran = await progressedOsuUser()
  const mail = await newUser({
    id: "email-bindtest6",
    email: "Keep@Test.dev".toLowerCase(),
    passwordHash: hashPassword("password1"),
    playerLevel: 3,
  })
  await bindAs(mail, veteran.me)

  const res = await api("POST", "/auth/bind/resolve", mail, { choice: "keep-osu", confirm: true })
  assert.equal(res.statusCode, 200, res.body)
  assert.deepEqual(res.json().data, { userId: veteran.id, sealedUserId: mail, kept: "osu" })
  assert.equal(readSession(res.cookies.find((c) => c.name === COOKIE_NAME)!.value), veteran.id)

  const sealed = await rowOf(mail)
  assert.ok(sealed.sealedAt)
  assert.equal(sealed.email, null)
  assert.equal(sealed.sealedEmail, "keep@test.dev")
  assert.equal((await rowOf(veteran.id)).email, "keep@test.dev")
  assert.equal((await rowOf(veteran.id)).osuId, veteran.me.id)
  // 在售挂单是留下来的账号的，不动
  const [listing] = await db.select().from(marketListings).where(eq(marketListings.sellerId, veteran.id))
  assert.equal(listing!.status, "active")

  const login = await api("POST", "/auth/email/login", undefined, { email: "keep@test.dev", password: "password1" })
  assert.equal(login.statusCode, 200)
  assert.equal(login.json().data.id, veteran.id)
})

await test("保留 osu! 账号：对方已有邮箱时，当前账号的邮箱只是释放", async () => {
  const veteran = await progressedOsuUser({ email: "owner@test.dev", passwordHash: hashPassword("password1") })
  const mail = await newUser({ email: "loser@test.dev", passwordHash: hashPassword("password2") })
  await bindAs(mail, veteran.me)
  await api("POST", "/auth/bind/resolve", mail, { choice: "keep-osu", confirm: true })
  assert.equal((await rowOf(veteran.id)).email, "owner@test.dev")
  assert.equal((await rowOf(mail)).email, null)
  // 释放后这个邮箱可以重新注册
  const again = await api("POST", "/auth/email/register", undefined, { email: "loser@test.dev", password: "password3" })
  assert.equal(again.statusCode, 200, again.body)
})

await test("取消待确认：什么都不变", async () => {
  const veteran = await progressedOsuUser()
  const guest = await newUser()
  await bindAs(guest, veteran.me)
  assert.equal((await api("POST", "/auth/bind/cancel", guest)).statusCode, 200)
  assert.equal((await api("GET", "/auth/bind/pending", guest)).json().data.pending, null)
  assert.equal((await rowOf(veteran.id)).sealedAt, null)
  assert.equal((await rowOf(guest)).osuId, null)
})

await test("没绑过的 osu! 号直接登录：新建 osu-xxx 账号", async () => {
  const me = freshOsu()
  assert.equal(await osuLogin(me), `osu-${me.id}`)
  assert.equal(await osuLogin(me), `osu-${me.id}`, "再登录还是同一个")
})

/* ---------- 反向绑定：补邮箱 ---------- */

await test("osu! 号补绑邮箱：之后能用邮箱登录同一个号", async () => {
  const osu = await newUser({ osuId: ++osuSeq })
  const res = await api("POST", "/auth/email/bind", osu, { email: "Late@Test.dev", password: "password1" })
  assert.equal(res.statusCode, 200, res.body)
  assert.equal(res.json().data.email, "late@test.dev")
  const login = await api("POST", "/auth/email/login", undefined, { email: "late@test.dev", password: "password1" })
  assert.equal(login.statusCode, 200)
  assert.equal(login.json().data.id, osu)

  const info = (await api("GET", "/auth/me", osu)).json().data
  assert.equal(info.hasEmail, true)
  assert.equal(info.kind, "osu")
})

await test("补绑邮箱：已有邮箱、邮箱被占、格式不对都拒绝", async () => {
  const osu = await newUser({ osuId: ++osuSeq })
  const taken = await api("POST", "/auth/email/bind", osu, { email: "late@test.dev", password: "password1" })
  assert.equal(taken.statusCode, 409)
  assert.equal(taken.json().error.code, "email_taken")

  const bad = await api("POST", "/auth/email/bind", osu, { email: "nope", password: "password1" })
  assert.equal(bad.statusCode, 400)
  const short = await api("POST", "/auth/email/bind", osu, { email: "ok@test.dev", password: "123" })
  assert.equal(short.statusCode, 400)

  assert.equal((await api("POST", "/auth/email/bind", osu, { email: "ok@test.dev", password: "password1" })).statusCode, 200)
  const twice = await api("POST", "/auth/email/bind", osu, { email: "ok2@test.dev", password: "password1" })
  assert.equal(twice.statusCode, 409)
  assert.equal(twice.json().error.code, "email_already_bound")

  assert.equal((await api("POST", "/auth/email/bind", undefined, { email: "x@test.dev", password: "password1" })).statusCode, 401)
})

await test("游客也能补邮箱（等于把游客号升级成邮箱号）", async () => {
  const guest = await newUser({ id: "guest-bindtest7" })
  assert.equal((await api("POST", "/auth/email/bind", guest, { email: "g@test.dev", password: "password1" })).statusCode, 200)
  assert.equal((await api("GET", "/auth/me", guest)).json().data.kind, "email")
})

console.log(`\n${passed} passed`)
await cleanup()
