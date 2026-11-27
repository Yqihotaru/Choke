/**
 * 每日推荐谱面：轮换规则、内容校验、成绩判定（纯规则），以及检查接口的服务端行为
 * （假 osu! 接口：通过 / 没成绩 / 昨天的成绩 / 条件不够 / 同一成绩只能用一次 / 冷却 / 限频 / 接口出错 / 并发）。
 * 用临时 PGlite 数据库和假的 osu! 接口，不联网。
 *
 *   pnpm test:osu-daily
 */
import assert from "node:assert/strict"

import { setupTestDb } from "./test-db"

const dropTestDb = await setupTestDb("osu-daily")

const { and, eq } = await import("drizzle-orm")
const { default: Fastify } = await import("fastify")
const { default: cookie } = await import("@fastify/cookie")

const { db } = await import("../src/db/client")
const { users, userPacks, osuScoreClaims, questProgress } = await import("../src/db/schema")
const { COOKIE_NAME, makeSession } = await import("../src/auth/osu")
const { handleError } = await import("../src/error-handler")
const { TxAbort } = await import("../src/tx")
const { OSU_DAILY_CONTENT, QUEST_CONTENT } = await import("../src/content")
const { OsuApiError, setOsuApi } = await import("../src/osu-api")
const { checkOsuDaily, getOsuDaily, resetOsuDailyState } = await import("../src/osu-daily")
const quests = await import("../src/quests")
const { questRoutes } = await import("../src/routes/quests")
const osu = await import("@choke/shared/osu-daily")
const { resetDayKey } = await import("@choke/shared/reset")
const { questPeriodKey } = await import("@choke/shared/quests")

const app = Fastify()
app.setErrorHandler(handleError)
await app.register(cookie)
await app.register(questRoutes)
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
    setOsuApi(null)
    await cleanup()
    process.exit(1)
  }
}

async function cleanup() {
  await app.close().catch(() => {})
  await dropTestDb()
}

const rejectsWith = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error) => error instanceof TxAbort && error.code === code)

/** 北京时间 → 时间戳 */
const bj = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h - 8, min)

console.log("osu-daily tests")

// ---------- 轮换（纯规则） ----------

const makePool = (n: number): import("@choke/shared/osu-daily").OsuDailyContent => ({
  pool: Array.from({ length: n }, (_, i) => ({ beatmapId: 1000 + i, title: `map ${i}` })),
  schedule: {},
})
const dayKeyAt = (offset: number) => new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10)
const dayNumberOf = (key: string) => Math.floor(new Date(`${key}T00:00:00Z`).getTime() / 86_400_000)

await test("轮换：一圈之内不重复，相邻两天不会是同一张，同一天算出来永远一样", async () => {
  for (const n of [3, 4, 5, 7, 20]) {
    const content = makePool(n)
    const cycles = new Map<number, number[]>()
    let previous: number | null = null
    for (let i = 0; i < n * 12; i += 1) {
      const key = dayKeyAt(i)
      const entry = osu.osuDailyFor(content, key)!
      assert.equal(osu.osuDailyFor(content, key)!.beatmapId, entry.beatmapId, "同一天结果一致")
      assert.notEqual(entry.beatmapId, previous, `池子 ${n} 张：${key} 和前一天重复`)
      previous = entry.beatmapId
      const cycle = Math.floor(dayNumberOf(key) / n)
      cycles.set(cycle, [...(cycles.get(cycle) ?? []), entry.beatmapId])
    }
    for (const [cycle, ids] of cycles) {
      // 首尾两圈可能只走了一部分，只检查已经走到的部分没有重复
      assert.equal(new Set(ids).size, ids.length, `池子 ${n} 张：第 ${cycle} 圈内重复`)
    }
  }
})

await test("轮换：池子只有 1–2 张也能转；池子是空的返回 null", async () => {
  assert.equal(osu.osuDailyFor(makePool(0), "2026-11-24"), null)
  assert.equal(osu.osuDailyFor(makePool(1), "2026-11-24")!.beatmapId, 1000)
  const two = makePool(2)
  const a = osu.osuDailyFor(two, "2026-11-24")!.beatmapId
  const b = osu.osuDailyFor(two, "2026-11-25")!.beatmapId
  assert.notEqual(a, b)
})

await test("轮换：schedule 手动指定某天；没指定的天照常轮换，不受影响", async () => {
  const content = makePool(10)
  const natural = osu.osuDailyFor(content, "2026-11-25")!.beatmapId
  const forced = content.pool.find((entry) => entry.beatmapId !== natural)!.beatmapId
  const withSchedule = { ...content, schedule: { "2026-11-25": forced } }
  assert.equal(osu.osuDailyFor(withSchedule, "2026-11-25")!.beatmapId, forced)
  assert.equal(osu.osuDailyFor(withSchedule, "2026-11-24")!.beatmapId, osu.osuDailyFor(content, "2026-11-24")!.beatmapId)
  assert.equal(osu.osuDailyFor(withSchedule, "2026-11-26")!.beatmapId, osu.osuDailyFor(content, "2026-11-26")!.beatmapId)
})

await test("真实内容能通过校验，池子不是空的，每天都有谱面", async () => {
  assert.ok(OSU_DAILY_CONTENT.pool.length > 0)
  for (let i = 0; i < 30; i += 1) assert.ok(osu.osuDailyFor(OSU_DAILY_CONTENT, dayKeyAt(i)))
})

// ---------- 内容校验 ----------

await test("内容校验：重复谱面、假日期、指向池外的谱面、越界条件、多余字段都会被拦下", async () => {
  const base = { pool: [{ beatmapId: 1, title: "a" }], schedule: {} }
  assert.doesNotThrow(() => osu.parseOsuDailyContent(base))
  assert.doesNotThrow(() => osu.parseOsuDailyContent({ pool: [] }), "schedule 可以不写")
  assert.throws(() => osu.parseOsuDailyContent({ pool: [base.pool[0], base.pool[0]] }), /重复/)
  assert.throws(() => osu.parseOsuDailyContent({ ...base, schedule: { "2026-02-30": 1 } }), /真实日期/)
  assert.throws(() => osu.parseOsuDailyContent({ ...base, schedule: { "11-24": 1 } }), /真实日期/)
  assert.throws(() => osu.parseOsuDailyContent({ ...base, schedule: { "2026-11-24": 2 } }), /不在 pool 里/)
  assert.throws(() => osu.parseOsuDailyContent({ pool: [{ beatmapId: 1, title: "a", minAccuracy: 101 }] }))
  assert.throws(() => osu.parseOsuDailyContent({ pool: [{ beatmapId: 1, title: "a", minRank: "SSS" }] }))
  assert.throws(() => osu.parseOsuDailyContent({ pool: [{ beatmapId: 1, title: "a", mode: 3 }] }))
})

// ---------- 判定（纯规则） ----------

const window = osu.dayWindow(bj(2026, 11, 24, 12))
const score = (patch: Partial<import("@choke/shared/osu-daily").OsuScore> = {}): import("@choke/shared/osu-daily").OsuScore => ({
  id: 1,
  passed: true,
  ended_at: new Date(bj(2026, 11, 24, 10)).toISOString(),
  accuracy: 0.9,
  rank: "A",
  ruleset_id: 0,
  ...patch,
})
const plain = { beatmapId: 1, title: "x" }

await test("判定：当天 4:00 到次日 4:00 的 Pass 才算；只认 standard；挂什么 mod 都行", async () => {
  assert.deepEqual([window.from, window.to], [bj(2026, 11, 24, 4), bj(2026, 11, 25, 4)])
  assert.equal(osu.judgeScore(score(), plain, window), "ok")
  assert.equal(osu.judgeScore(score({ passed: false }), plain, window), "failed")
  assert.equal(osu.judgeScore(score({ ruleset_id: 3 }), plain, window), "wrong-mode")
  assert.equal(osu.judgeScore(score({ ended_at: new Date(bj(2026, 11, 24, 3, 59)).toISOString() }), plain, window), "not-today")
  assert.equal(osu.judgeScore(score({ ended_at: new Date(bj(2026, 11, 24, 4)).toISOString() }), plain, window), "ok")
  assert.equal(osu.judgeScore(score({ ended_at: new Date(bj(2026, 11, 25, 4)).toISOString() }), plain, window), "not-today")
  assert.equal(osu.judgeScore(score({ ended_at: "垃圾" }), plain, window), "not-today")
  // 接口返回的评级里没有 mods 之类的字段也不影响：我们根本不看 mod
  assert.equal(osu.judgeScore({ ...score(), mods: [{ acronym: "NF" }] } as never, plain, window), "ok")
})

await test("判定：最低准度和最低评级写了才判断；X / XH 算 SS，SH 算 S", async () => {
  const strict = { ...plain, minAccuracy: 95, minRank: "S" as const }
  assert.equal(osu.judgeScore(score({ accuracy: 0.9, rank: "A" }), strict, window), "low-accuracy")
  assert.equal(osu.judgeScore(score({ accuracy: 0.96, rank: "A" }), strict, window), "low-rank")
  assert.equal(osu.judgeScore(score({ accuracy: 0.96, rank: "S" }), strict, window), "ok")
  assert.equal(osu.judgeScore(score({ accuracy: 0.96, rank: "SH" }), strict, window), "ok")
  assert.equal(osu.judgeScore(score({ accuracy: 1, rank: "XH" }), strict, window), "ok")
  assert.equal(osu.judgeScore(score({ accuracy: 0.95, rank: "S" }), strict, window), "ok", "正好等于下限算达标")
  assert.equal(osu.judgeScore(score({ accuracy: 0.96, rank: "???" }), strict, window), "low-rank")
  assert.equal(osu.judgeScore(score({ accuracy: 0.5, rank: "D" }), plain, window), "ok", "没写条件就不限")
})

// ---------- 服务端：假 osu! 接口 ----------

const NOW = bj(2026, 11, 24, 12)
const TODAY = resetDayKey(NOW)
const entry = osu.osuDailyFor(OSU_DAILY_CONTENT, TODAY)!

let seq = 0
async function newUser(patch: Partial<typeof users.$inferInsert> = {}) {
  seq += 1
  const id = `osu-daily-test-${seq}`
  await db.insert(users).values({
    id,
    username: id,
    email: `${id}@test.local`,
    osuId: 900_000 + seq,
    tutorialDone: true,
    playerLevel: 60,
    coins: 0,
    ...patch,
  })
  return id
}
const osuIdOf = async (userId: string) => (await db.select({ v: users.osuId }).from(users).where(eq(users.id, userId)))[0]!.v!

let nextScoreId = 5_000_000
const scoreAt = (patch: Partial<import("@choke/shared/osu-daily").OsuScore> = {}) => {
  nextScoreId += 1
  return score({ id: nextScoreId, ...patch })
}

/** 假接口：按 osu id 返回事先放好的成绩，并记下被调用的次数 */
const fake = {
  scores: new Map<number, import("@choke/shared/osu-daily").OsuScore[]>(),
  calls: [] as { beatmapId: number; osuUserId: number }[],
  fail: false,
}
setOsuApi({
  async userScoresOnBeatmap(beatmapId, osuUserId) {
    fake.calls.push({ beatmapId, osuUserId })
    if (fake.fail) throw new OsuApiError("假的故障")
    return fake.scores.get(osuUserId) ?? []
  },
})
const give = async (userId: string, ...scores: import("@choke/shared/osu-daily").OsuScore[]) =>
  fake.scores.set(await osuIdOf(userId), scores)
const claimsOf = (userId: string) => db.select().from(osuScoreClaims).where(eq(osuScoreClaims.userId, userId))
const progressOf = async (userId: string) =>
  (await db.select().from(questProgress).where(eq(questProgress.userId, userId))).find((r) => r.questId === "daily-osu-beatmap")?.progress ?? 0

await test("没有用 osu! 账号登录的玩家：提示需要绑定，不调用接口", async () => {
  resetOsuDailyState()
  const userId = await newUser({ osuId: null })
  fake.calls = []
  await rejectsWith(checkOsuDaily(userId, NOW), "osu_not_linked")
  assert.equal(fake.calls.length, 0)
})

await test("还没有成绩：返回 no-score，用的是今天这张谱面和玩家自己的 osu id", async () => {
  resetOsuDailyState()
  const userId = await newUser()
  fake.calls = []
  assert.deepEqual(await checkOsuDaily(userId, NOW), { passed: false, reason: "no-score", found: 0 })
  assert.deepEqual(fake.calls, [{ beatmapId: entry.beatmapId, osuUserId: await osuIdOf(userId) }])
  assert.equal(await progressOf(userId), 0)
})

await test("没通过的、昨天的、别的模式的成绩都不算", async () => {
  resetOsuDailyState()
  const userId = await newUser()
  await give(
    userId,
    scoreAt({ passed: false }),
    scoreAt({ ended_at: new Date(bj(2026, 11, 24, 3, 30)).toISOString() }),
    scoreAt({ ruleset_id: 1 }),
  )
  assert.deepEqual(await checkOsuDaily(userId, NOW), { passed: false, reason: "no-score", found: 0 })
  assert.equal((await claimsOf(userId)).length, 0)
})

await test("通过（挂 NF 也算）：记一次进度，成绩被登记；再领任务得到卡包", async () => {
  resetOsuDailyState()
  const userId = await newUser()
  await give(userId, { ...scoreAt({ accuracy: 0.8, rank: "B" }), mods: [{ acronym: "NF" }] } as never)
  assert.deepEqual(await checkOsuDaily(userId, NOW), { passed: true, alreadyPassed: false })
  const claims = await claimsOf(userId)
  assert.equal(claims.length, 1)
  assert.equal(claims[0]!.dayKey, TODAY)
  assert.equal(claims[0]!.beatmapId, entry.beatmapId)
  // 任务进度按「当前时间」的周期记，这里用 NOW 对应的日常周期
  const rows = await db.select().from(questProgress).where(eq(questProgress.userId, userId))
  const row = rows.find((r) => r.questId === "daily-osu-beatmap")!
  assert.equal(row.periodKey, questPeriodKey("daily", NOW))
  assert.equal(row.progress, 1)

  await quests.claimQuest(userId, "daily-osu-beatmap", NOW)
  const packs = QUEST_CONTENT.quests["daily-osu-beatmap"]!.rewards.packs!
  for (const pack of packs) {
    const [owned] = await db.select().from(userPacks).where(and(eq(userPacks.userId, userId), eq(userPacks.pool, pack.pool as "normal")))
    assert.equal(owned?.count, pack.count)
  }
})

await test("今天已经通过：再点检查直接返回已通过，不再调用接口，也不重复记进度", async () => {
  resetOsuDailyState()
  const userId = await newUser()
  await give(userId, scoreAt())
  await checkOsuDaily(userId, NOW)
  fake.calls = []
  assert.deepEqual(await checkOsuDaily(userId, NOW + 5_000), { passed: true, alreadyPassed: true })
  assert.equal(fake.calls.length, 0)
  assert.equal(await progressOf(userId), 1)
  assert.equal((await claimsOf(userId)).length, 1)
})

await test("条件：写了最低准度 / 评级就要达到；找到成绩但不够返回 not-good-enough，达标后能通过", async () => {
  resetOsuDailyState()
  const userId = await newUser()
  const original = { minAccuracy: entry.minAccuracy, minRank: entry.minRank }
  entry.minAccuracy = 95
  entry.minRank = "S"
  try {
    await give(userId, scoreAt({ accuracy: 0.9, rank: "A" }))
    assert.deepEqual(await checkOsuDaily(userId, NOW), { passed: false, reason: "not-good-enough", found: 1 })
    assert.equal(await progressOf(userId), 0)
    await give(userId, scoreAt({ accuracy: 0.9, rank: "A" }), scoreAt({ accuracy: 0.97, rank: "SH" }))
    assert.deepEqual(await checkOsuDaily(userId, NOW + 61_000), { passed: true, alreadyPassed: false })
    const view = await getOsuDaily(userId, NOW + 61_000)
    assert.equal(view.beatmap?.minAccuracy, 95)
    assert.equal(view.beatmap?.minRank, "S")
  } finally {
    if (original.minAccuracy === undefined) delete entry.minAccuracy
    else entry.minAccuracy = original.minAccuracy
    if (original.minRank === undefined) delete entry.minRank
    else entry.minRank = original.minRank
  }
})

await test("同一条成绩只能用一次：别人拿同一个 score id 来换不了", async () => {
  resetOsuDailyState()
  const first = await newUser()
  const second = await newUser()
  const shared = scoreAt()
  await give(first, shared)
  await give(second, shared)
  assert.deepEqual(await checkOsuDaily(first, NOW), { passed: true, alreadyPassed: false })
  assert.deepEqual(await checkOsuDaily(second, NOW), { passed: false, reason: "not-good-enough", found: 1 })
  assert.equal(await progressOf(second), 0)
  assert.equal((await claimsOf(second)).length, 0)
})

await test("冷却：60 秒内不能再检查（返回剩余秒数），到点就可以；换成别的玩家不受影响", async () => {
  resetOsuDailyState()
  const userId = await newUser()
  const other = await newUser()
  await checkOsuDaily(userId, NOW)
  await assert.rejects(checkOsuDaily(userId, NOW + 20_000), (error) => {
    return error instanceof TxAbort && error.code === "cooldown" && error.status === 429 && error.extra.cooldownSeconds === 40
  })
  assert.equal((await getOsuDaily(userId, NOW + 20_000)).cooldownSeconds, 40)
  assert.equal((await getOsuDaily(userId, NOW + 60_000)).cooldownSeconds, 0)
  await checkOsuDaily(other, NOW + 20_000)
  await give(userId, scoreAt())
  assert.deepEqual(await checkOsuDaily(userId, NOW + 60_000), { passed: true, alreadyPassed: false })
})

await test("osu! 接口出错：提示稍后再试，不占冷却，也不记进度", async () => {
  resetOsuDailyState()
  const userId = await newUser()
  await give(userId, scoreAt())
  fake.fail = true
  try {
    await rejectsWith(checkOsuDaily(userId, NOW), "osu_unavailable")
  } finally {
    fake.fail = false
  }
  assert.equal((await getOsuDaily(userId, NOW)).cooldownSeconds, 0)
  assert.equal(await progressOf(userId), 0)
  assert.deepEqual(await checkOsuDaily(userId, NOW + 1_000), { passed: true, alreadyPassed: false })
})

await test("并发：同一个玩家同时点两次，只放一个去查，奖励只记一次", async () => {
  resetOsuDailyState()
  const userId = await newUser()
  await give(userId, scoreAt())
  const results = await Promise.allSettled([checkOsuDaily(userId, NOW), checkOsuDaily(userId, NOW)])
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1)
  assert.equal(results.filter((r) => r.status === "rejected").length, 1)
  assert.equal(await progressOf(userId), 1)
  assert.equal((await claimsOf(userId)).length, 1)
})

await test("全服限频：一分钟内最多 40 次查询，超过的提示稍后再试；过一分钟恢复", async () => {
  resetOsuDailyState()
  const people: string[] = []
  for (let i = 0; i < 41; i += 1) people.push(await newUser())
  for (const userId of people.slice(0, 40)) await checkOsuDaily(userId, NOW)
  await rejectsWith(checkOsuDaily(people[40]!, NOW + 1_000), "osu_busy")
  assert.equal((await getOsuDaily(people[40]!, NOW + 1_000)).cooldownSeconds, 0, "被限频的不占冷却")
  await checkOsuDaily(people[40]!, NOW + 61_000)
})

await test("第二天换谱面：昨天的通过不影响今天，昨天的成绩今天也不算", async () => {
  resetOsuDailyState()
  const userId = await newUser()
  const old = scoreAt()
  await give(userId, old)
  await checkOsuDaily(userId, NOW)
  const tomorrow = bj(2026, 11, 25, 12)
  assert.equal((await getOsuDaily(userId, tomorrow)).passed, false)
  assert.equal((await getOsuDaily(userId, NOW)).passed, true)
  assert.deepEqual(await checkOsuDaily(userId, tomorrow), { passed: false, reason: "no-score", found: 0 })
  await give(userId, old, scoreAt({ ended_at: new Date(bj(2026, 11, 25, 9)).toISOString() }))
  assert.deepEqual(await checkOsuDaily(userId, tomorrow + 61_000), { passed: true, alreadyPassed: false })
  assert.equal((await claimsOf(userId)).length, 2)
})

await test("今天的视图：谱面信息、链接、换图时间", async () => {
  resetOsuDailyState()
  const userId = await newUser()
  const view = await getOsuDaily(userId, NOW)
  assert.equal(view.day, TODAY)
  assert.equal(view.beatmap?.beatmapId, entry.beatmapId)
  assert.equal(view.beatmap?.url, `https://osu.ppy.sh/beatmaps/${entry.beatmapId}`)
  assert.equal(view.passed, false)
  assert.equal(view.resetsAt, new Date(bj(2026, 11, 25, 4)).toISOString())
})

// ---------- 接口 ----------

const sessionHeaders = (userId: string) => ({ cookie: `${COOKIE_NAME}=${makeSession(userId)}` })
const call = async (userId: string, method: "GET" | "POST", url: string) => {
  const res = await app.inject({ method, url, headers: sessionHeaders(userId) })
  return { status: res.statusCode, body: res.json() }
}

await test("接口：GET 看今天的谱面，POST 检查；错误码和状态码正确；只能查自己", async () => {
  resetOsuDailyState()
  const userId = await newUser()
  const other = await newUser()
  const todayNow = Date.now()
  const view = await call(userId, "GET", `/users/${userId}/osu-daily`)
  assert.equal(view.status, 200, JSON.stringify(view.body))
  assert.ok(view.body.data.beatmap.url.startsWith("https://osu.ppy.sh/beatmaps/"))
  assert.equal(view.body.data.passed, false)

  // 真实时间下今天的成绩
  await give(userId, scoreAt({ ended_at: new Date(todayNow - 1000).toISOString() }))
  const ok = await call(userId, "POST", `/users/${userId}/osu-daily/check`)
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.deepEqual(ok.body.data, { passed: true, alreadyPassed: false })
  assert.equal((await call(userId, "GET", `/users/${userId}/osu-daily`)).body.data.passed, true)

  const again = await call(other, "POST", `/users/${other}/osu-daily/check`)
  assert.equal(again.status, 200)
  const cooling = await call(other, "POST", `/users/${other}/osu-daily/check`)
  assert.equal(cooling.status, 429)
  assert.equal(cooling.body.error.code, "cooldown")
  assert.ok(cooling.body.error.cooldownSeconds > 0)

  const stranger = await call(other, "POST", `/users/${userId}/osu-daily/check`)
  assert.notEqual(stranger.status, 200)
  const unlinked = await newUser({ osuId: null })
  const noLink = await call(unlinked, "POST", `/users/${unlinked}/osu-daily/check`)
  assert.equal(noLink.status, 400)
  assert.equal(noLink.body.error.code, "osu_not_linked")
})

setOsuApi(null)
console.log(`\n${passed} 项通过`)
await cleanup()
process.exit(0)
