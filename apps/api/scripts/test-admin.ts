/**
 * 管理员后台发信的服务端测试：权限（未登录 401 / 非管理员 403 / 撤销立刻生效）、
 * 收件人（指定、全体、按等级）、人数确认、附件上限、发信记录。
 * 用临时 PGlite 数据库，不碰开发库。
 *
 *   pnpm test:admin
 */
import assert from "node:assert/strict"

import { setupTestDb } from "./test-db"

const dropTestDb = await setupTestDb("admin")

const { eq } = await import("drizzle-orm")
const { default: Fastify } = await import("fastify")
const { default: cookie } = await import("@fastify/cookie")
const { db } = await import("../src/db/client")
const { users, mails, adminMailBatches } = await import("../src/db/schema")
const { makeSession } = await import("../src/auth/osu")
const { COOKIE_NAME } = await import("../src/auth/osu")
const { handleError } = await import("../src/error-handler")
const { adminRoutes } = await import("../src/routes/admin")
const { ADMIN_ATTACHMENT_LIMITS } = await import("@choke/shared/mail")

const app = Fastify()
app.setErrorHandler(handleError)
await app.register(cookie)
await app.register(adminRoutes)
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

const call = async (userId: string | null, method: "GET" | "POST", url: string, payload?: unknown) => {
  const res = await app.inject({
    method,
    url,
    payload: payload as never,
    headers: userId ? { cookie: `${COOKIE_NAME}=${makeSession(userId)}` } : {},
  })
  return {
    status: res.statusCode,
    body: res.json() as {
      ok: boolean
      data: { recipients: number; batchId: number; users: { id: string }[]; batches: { title: string }[] }
      error?: { code: string; message: string }
    },
  }
}

const addUser = (id: string, patch: Partial<typeof users.$inferInsert> = {}) =>
  db.insert(users).values({ id, username: `name-${id}`, staminaUpdatedAt: Date.now(), ...patch })
const mailCount = async (userId: string) =>
  (await db.select().from(mails).where(eq(mails.userId, userId))).length

await addUser("boss", { isAdmin: true, playerLevel: 50 })
await addUser("p1", { playerLevel: 5 })
await addUser("p2", { playerLevel: 20 })
await addUser("p3", { playerLevel: 40 })

console.log("admin tests")

await test("未登录 401，不是管理员 403，所有后台接口一视同仁", async () => {
  for (const [method, url, payload] of [
    ["GET", "/admin/users?q=a", undefined],
    ["POST", "/admin/mails/preview", { audience: { type: "all" } }],
    ["POST", "/admin/mails", { audience: { type: "all" }, title: "x", confirmCount: 4 }],
    ["GET", "/admin/mail-batches", undefined],
  ] as const) {
    assert.equal((await call(null, method, url, payload)).status, 401, `${url} 未登录`)
    const denied = await call("p1", method, url, payload)
    assert.equal(denied.status, 403, `${url} 普通玩家`)
    assert.equal(denied.body.error?.code, "forbidden")
  }
  assert.equal(await mailCount("p1"), 0, "被拒绝的请求没有发出任何邮件")
})

await test("指定玩家发信：每人一封，写批次记录，邮件带批次号", async () => {
  const res = await call("boss", "POST", "/admin/mails", {
    audience: { type: "users", userIds: ["p1", "p2", "p1"] },
    title: "补偿",
    body: "抱歉",
    attachment: { coins: 500 },
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.data.recipients, 2, "重复的 id 只发一封")
  assert.equal(await mailCount("p1"), 1)
  assert.equal(await mailCount("p2"), 1)
  assert.equal(await mailCount("p3"), 0)
  const [batch] = await db.select().from(adminMailBatches).where(eq(adminMailBatches.id, res.body.data.batchId))
  assert.equal(batch!.adminId, "boss")
  assert.equal(batch!.recipientCount, 2)
  const [mail] = await db.select().from(mails).where(eq(mails.userId, "p1"))
  assert.equal(mail!.batchId, batch!.id)
  assert.deepEqual(mail!.attachment, { coins: 500 })
})

await test("指定了不存在的玩家：整笔拒绝，一封都不发", async () => {
  const before = await mailCount("p3")
  const res = await call("boss", "POST", "/admin/mails", {
    audience: { type: "users", userIds: ["p3", "nobody"] },
    title: "x",
  })
  assert.equal(res.status, 400)
  assert.equal(res.body.error?.code, "unknown_users")
  assert.equal(await mailCount("p3"), before)
})

await test("全体 / 按等级发送必须带对人数，对不上就拒绝", async () => {
  const preview = await call("boss", "POST", "/admin/mails/preview", { audience: { type: "level", minLevel: 20 } })
  assert.equal(preview.status, 200)
  assert.equal(preview.body.data.recipients, 3, "boss、p2、p3")

  const noConfirm = await call("boss", "POST", "/admin/mails", { audience: { type: "all" }, title: "公告" })
  assert.equal(noConfirm.status, 409)
  assert.equal(noConfirm.body.error?.code, "confirm_mismatch")
  const wrong = await call("boss", "POST", "/admin/mails", { audience: { type: "all" }, title: "公告", confirmCount: 3 })
  assert.equal(wrong.status, 409)
  assert.equal(await mailCount("p3"), 0)

  const ok = await call("boss", "POST", "/admin/mails", {
    audience: { type: "level", minLevel: 20 },
    title: "高等级公告",
    confirmCount: 3,
  })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(ok.body.data.recipients, 3)
  assert.equal(await mailCount("p1"), 1, "p1 等级不够，没收到新的")
  assert.equal(await mailCount("p3"), 1)

  const all = await call("boss", "POST", "/admin/mails", { audience: { type: "all" }, title: "全体", confirmCount: 4 })
  assert.equal(all.status, 200)
  assert.equal(all.body.data.recipients, 4)
})

await test("附件超过后台单封上限被拒绝；没有收件人被拒绝", async () => {
  const tooMuch = await call("boss", "POST", "/admin/mails", {
    audience: { type: "users", userIds: ["p1"] },
    title: "多打了个 0",
    attachment: { coins: ADMIN_ATTACHMENT_LIMITS.coins * 10 },
  })
  assert.equal(tooMuch.status, 400)
  assert.equal(tooMuch.body.error?.code, "attachment_too_big")

  const noOne = await call("boss", "POST", "/admin/mails", {
    audience: { type: "level", minLevel: 999 },
    title: "没人",
    confirmCount: 0,
  })
  assert.equal(noOne.status, 400)
  assert.equal(noOne.body.error?.code, "no_recipients")
})

await test("参数不合法返回 400：空标题、坏附件、坏收件人", async () => {
  for (const payload of [
    { audience: { type: "users", userIds: ["p1"] }, title: "  " },
    { audience: { type: "users", userIds: ["p1"] }, title: "x", attachment: { coins: -1 } },
    { audience: { type: "users", userIds: [] }, title: "x" },
    { audience: { type: "everyone" }, title: "x" },
  ]) {
    assert.equal((await call("boss", "POST", "/admin/mails", payload)).status, 400, JSON.stringify(payload))
  }
})

await test("搜索玩家：按名字、id 搜；% 和 _ 不当通配符", async () => {
  const byName = await call("boss", "GET", "/admin/users?q=name-p")
  assert.equal(byName.status, 200)
  assert.deepEqual(byName.body.data.users.map((u: { id: string }) => u.id).sort(), ["p1", "p2", "p3"])
  const byId = await call("boss", "GET", "/admin/users?q=boss")
  assert.deepEqual(byId.body.data.users.map((u: { id: string }) => u.id), ["boss"])
  const wildcard = await call("boss", "GET", `/admin/users?q=${encodeURIComponent("%")}`)
  assert.equal(wildcard.body.data.users.length, 0)
})

await test("发信记录能查到，最新的在前", async () => {
  const res = await call("boss", "GET", "/admin/mail-batches")
  assert.equal(res.status, 200)
  const titles = res.body.data.batches.map((b: { title: string }) => b.title)
  assert.equal(titles[0], "全体")
  assert.ok(titles.includes("补偿"))
})

await test("撤销管理员立刻生效", async () => {
  await db.update(users).set({ isAdmin: false }).where(eq(users.id, "boss"))
  assert.equal((await call("boss", "GET", "/admin/mail-batches")).status, 403)
})

console.log(`\n${passed} admin tests passed`)
await cleanup()
process.exit(0)
