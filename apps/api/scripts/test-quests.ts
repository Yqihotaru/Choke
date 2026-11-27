/**
 * 任务与签到的服务端测试：重置时间边界（4:00 / 周一 / 每月 1 日）、进度累加封顶、
 * 重复和并发领取只发一次、流水对得上、一键全领、签到、过期未领奖励转邮件、各动作的埋点。
 * 用临时 PGlite 数据库，不碰开发库。
 *
 *   pnpm test:quests
 */
import assert from "node:assert/strict"

import { setupTestDb } from "./test-db"

const dropTestDb = await setupTestDb("quests")

const { and, eq } = await import("drizzle-orm")
const { default: Fastify } = await import("fastify")
const { default: cookie } = await import("@fastify/cookie")

// 市场买卖没有样例任务，这里临时加两条只在测试里存在的任务；必须赶在 quest-events 被加载之前
const { QUEST_CONTENT } = await import("../src/content")
for (const event of ["market-buy", "market-sell"] as const) {
  QUEST_CONTENT.quests[`t-${event}`] = {
    period: "daily",
    name: "测试",
    desc: "测试",
    event,
    target: 1,
    rewards: { coins: 1 },
    points: 0,
  }
}

const { db } = await import("../src/db/client")
const { users, cards, userCards, userPacks, userItems, ledgerEntries, mails, questProgress } = await import(
  "../src/db/schema"
)
const { COOKIE_NAME, makeSession } = await import("../src/auth/osu")
const { handleError } = await import("../src/error-handler")
const { TxAbort } = await import("../src/tx")
const quests = await import("../src/quests")
const { recordQuestEvent } = await import("../src/quest-events")
const { questRoutes } = await import("../src/routes/quests")
const { progressionRoutes } = await import("../src/routes/progression")
const { marketRoutes } = await import("../src/routes/market")
const { packRoutes } = await import("../src/routes/packs")
const { nextReset, periodKey, resetDayKey, resetMonthDay, resetMonthKey, resetWeekKey } = await import(
  "@choke/shared/reset"
)
const { daysInMonthKey, mergeQuestRewards, signInRewardFor, questPeriodKey } = await import("@choke/shared/quests")
const { expToNextPlayerLevel } = await import("@choke/shared/player")

const app = Fastify()
app.setErrorHandler(handleError)
await app.register(cookie)
for (const routes of [questRoutes, progressionRoutes, marketRoutes, packRoutes]) await app.register(routes)
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

const rejectsWith = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error) => error instanceof TxAbort && error.code === code)

/** 北京时间 → 时间戳 */
const bj = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h - 8, min)

let seq = 0
async function newUser(patch: Partial<typeof users.$inferInsert> = {}) {
  seq += 1
  const id = `quest-test-${seq}`
  await db.insert(users).values({
    id,
    username: id,
    email: `${id}@test.local`,
    osuId: 600_000 + seq,
    tutorialDone: true,
    playerLevel: 9,
    stamina: 200,
    staminaUpdatedAt: Date.now(),
    coins: 0,
    ...patch,
  })
  return id
}

const coinsOf = async (userId: string) => (await db.select({ v: users.coins }).from(users).where(eq(users.id, userId)))[0]!.v
const packsOf = async (userId: string, pool: string) =>
  (await db.select().from(userPacks).where(and(eq(userPacks.userId, userId), eq(userPacks.pool, pool))))[0]?.count ?? 0
const ledgerOf = (userId: string) => db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, userId))
const mailsOf = (userId: string) => db.select().from(mails).where(eq(mails.userId, userId))
const rowsOf = (userId: string) => db.select().from(questProgress).where(eq(questProgress.userId, userId))
/** 这个任务现在所有周期的进度之和（测试里每个任务只会有一行时就是那一行） */
const progressOf = async (userId: string, questId: string) =>
  (await rowsOf(userId)).filter((row) => row.questId === questId).reduce((sum, row) => sum + row.progress, 0)
const defOf = (questId: string) => QUEST_CONTENT.quests[questId]!
const rewardCoins = (questId: string) => defOf(questId).rewards.coins ?? 0
/** 玩家总经验：升过级的经验换算回去，等级变化不影响比较 */
const expOf = async (userId: string) => {
  const [row] = await db.select({ level: users.playerLevel, exp: users.playerExp }).from(users).where(eq(users.id, userId))
  let total = row!.exp
  for (let level = 1; level < row!.level; level += 1) total += expToNextPlayerLevel(level)
  return total
}

console.log("quest tests")

// ---------- 重置时间 ----------

await test("日常 / 周常 / 月常的换日时间：每天 4:00、周一 4:00、每月 1 日 4:00", async () => {
  // 2026-11-24 是周二
  assert.equal(resetDayKey(bj(2026, 11, 24, 3, 59)), "2026-11-23")
  assert.equal(resetDayKey(bj(2026, 11, 24, 4, 0)), "2026-11-24")
  assert.equal(resetDayKey(bj(2026, 11, 24, 23, 59)), "2026-11-24")

  assert.equal(resetWeekKey(bj(2026, 11, 23, 3, 59)), "2026-11-16", "周一 4:00 之前还算上一周")
  assert.equal(resetWeekKey(bj(2026, 11, 23, 4, 0)), "2026-11-23")
  assert.equal(resetWeekKey(bj(2026, 11, 29, 23, 59)), "2026-11-23", "周日深夜还是这一周")
  assert.equal(resetWeekKey(bj(2026, 11, 30, 3, 59)), "2026-11-23", "下周一 4:00 之前还是这一周")
  assert.equal(resetWeekKey(bj(2026, 11, 30, 4, 0)), "2026-11-30")

  assert.equal(resetMonthKey(bj(2026, 12, 1, 3, 59)), "2026-11", "1 日 4:00 之前还算上个月")
  assert.equal(resetMonthKey(bj(2026, 12, 1, 4, 0)), "2026-12")
  assert.equal(resetMonthDay(bj(2026, 12, 1, 3, 59)), 30)
  assert.equal(resetMonthDay(bj(2026, 12, 1, 4, 0)), 1)
  assert.equal(resetWeekKey(bj(2027, 1, 1, 10)), "2026-12-28", "跨年的周编号")

  assert.equal(periodKey("daily", bj(2026, 11, 24, 10)), "2026-11-24")
  assert.equal(periodKey("weekly", bj(2026, 11, 24, 10)), "2026-11-23")
  assert.equal(periodKey("monthly", bj(2026, 11, 24, 10)), "2026-11")

  const t = bj(2026, 11, 24, 10)
  assert.equal(nextReset("daily", t), bj(2026, 11, 25, 4))
  assert.equal(nextReset("weekly", t), bj(2026, 11, 30, 4))
  assert.equal(nextReset("monthly", t), bj(2026, 12, 1, 4))
  assert.equal(nextReset("daily", bj(2026, 11, 24, 4, 0)), bj(2026, 11, 25, 4), "恰好在重置那一刻，返回的是之后那次")
  assert.equal(nextReset("monthly", bj(2026, 12, 31, 10)), bj(2027, 1, 1, 4))

  assert.equal(daysInMonthKey("2026-02"), 28)
  assert.equal(daysInMonthKey("2028-02"), 29)
  assert.equal(daysInMonthKey("2026-11"), 30)
  assert.equal(daysInMonthKey("2026-12"), 31)
})

// ---------- 进度与领取 ----------

await test("进度累加、封顶；没完成不能领；领一次只发一次，写一条来源是任务的流水", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  await recordQuestEvent(db, userId, "pack-open", { amount: 3, now: t })
  assert.equal(await progressOf(userId, "daily-open-pack"), 1, "日常目标 1，封顶")
  assert.equal(await progressOf(userId, "weekly-open-packs"), 3)
  await recordQuestEvent(db, userId, "pack-open", { now: t })
  assert.equal(await progressOf(userId, "weekly-open-packs"), 4)
  await recordQuestEvent(db, userId, "pack-open", { amount: 0, now: t })
  assert.equal(await progressOf(userId, "weekly-open-packs"), 4, "数量 0 不记")

  await rejectsWith(quests.claimQuest(userId, "weekly-open-packs", t), "not_done")
  await rejectsWith(quests.claimQuest(userId, "no-such-quest", t), "not_found")
  await rejectsWith(quests.claimQuest(userId, "sign-in", t), "not_found")

  const result = await quests.claimQuest(userId, "daily-open-pack", t)
  assert.equal(result.rewards[0]!.count, rewardCoins("daily-open-pack"))
  assert.equal(await coinsOf(userId), rewardCoins("daily-open-pack"))
  await rejectsWith(quests.claimQuest(userId, "daily-open-pack", t), "already_claimed")
  assert.equal(await coinsOf(userId), rewardCoins("daily-open-pack"))

  const ledger = await ledgerOf(userId)
  assert.equal(ledger.length, 1)
  assert.deepEqual(
    [ledger[0]!.kind, ledger[0]!.delta, ledger[0]!.source, ledger[0]!.sourceRef],
    ["coins", rewardCoins("daily-open-pack"), "quest", "daily-open-pack@2026-11-24"],
  )

  await recordQuestEvent(db, userId, "pack-open", { now: t })
  await rejectsWith(quests.claimQuest(userId, "daily-open-pack", t), "already_claimed")
})

await test("多种奖励（金币 + 道具）一起发，流水逐项对得上", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  await recordQuestEvent(db, userId, "expedition-clear", { now: t, mapKind: "daily" })
  await quests.claimQuest(userId, "daily-expedition-clear", t)
  const def = defOf("daily-expedition-clear")
  assert.equal(await coinsOf(userId), def.rewards.coins ?? 0)
  for (const { itemId, count } of def.rewards.items ?? []) {
    const [row] = await db.select().from(userItems).where(and(eq(userItems.userId, userId), eq(userItems.itemId, itemId)))
    assert.equal(row?.count, count)
    const logged = (await ledgerOf(userId)).filter((e) => e.kind === "item" && e.ref === itemId)
    assert.equal(logged.reduce((sum, e) => sum + e.delta, 0), count)
  }
})

await test("玩家经验：领任务才到账、只到账一次，不进流水，能带着升级", async () => {
  const t = bj(2026, 11, 24, 10)
  const gain = defOf("daily-osu-beatmap").rewards.playerExp!
  assert.ok(gain > 0)
  const userId = await newUser({ playerLevel: 5, playerExp: 0 })
  await recordQuestEvent(db, userId, "osu-daily-pass", { now: t })
  const before = await expOf(userId)
  assert.equal(before, await expOf(await newUser({ playerLevel: 5, playerExp: 0 })), "只记进度不会加经验")
  const result = await quests.claimQuest(userId, "daily-osu-beatmap", t)
  assert.deepEqual(
    result.rewards.find((line) => line.kind === "playerExp"),
    { kind: "playerExp", label: "玩家经验", count: gain },
  )
  assert.equal((await expOf(userId)) - before, gain)
  await rejectsWith(quests.claimQuest(userId, "daily-osu-beatmap", t), "already_claimed")
  assert.equal((await expOf(userId)) - before, gain, "重复领不会再加")
  assert.ok(!(await ledgerOf(userId)).some((entry) => entry.kind === ("playerExp" as never)), "经验不写流水")

  // 差一点就升级：领完等级要涨，多出来的经验留在新等级里
  const near = await newUser({ playerLevel: 5, playerExp: expToNextPlayerLevel(5) - 1 })
  await recordQuestEvent(db, near, "osu-daily-pass", { now: t })
  await quests.claimQuest(near, "daily-osu-beatmap", t)
  const [row] = await db.select({ level: users.playerLevel, exp: users.playerExp }).from(users).where(eq(users.id, near))
  assert.equal(row!.level, 6)
  assert.equal(row!.exp, gain - 1)
})

await test("玩家经验：活跃度宝箱、一键全领也会发，合并成一行展示", async () => {
  const t = bj(2026, 11, 24, 10)
  const userId = await newUser({ playerLevel: 5, playerExp: 0 })
  for (const event of ["sign-in", "pack-open", "feed", "fuse", "dismantle", "expedition-clear", "market-buy", "market-sell"] as const) {
    await recordQuestEvent(db, userId, event, { now: t, mapKind: "daily" })
  }
  const before = await expOf(userId)
  const all = await quests.claimAllQuests(userId, t)
  assert.ok(all.chests.length > 0, "攒够点数解锁了宝箱")
  const expected = mergeQuestRewards([
    ...all.claimed.map((id) => defOf(id).rewards),
    ...all.chests.map((key) => {
      const [period, at] = key.split("-") as ["daily", string]
      return QUEST_CONTENT.activity[period]!.find((chest) => chest.at === Number(at))!.rewards
    }),
  ]).playerExp!
  assert.ok(expected > 0)
  assert.deepEqual(all.rewards.filter((line) => line.kind === "playerExp"), [{ kind: "playerExp", label: "玩家经验", count: expected }])
  assert.equal((await expOf(userId)) - before, expected)
})

await test("并发领取同一条任务只成功一次", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  await recordQuestEvent(db, userId, "feed", { now: t })
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => quests.claimQuest(userId, "daily-feed", t)))
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1)
  assert.equal(await coinsOf(userId), rewardCoins("daily-feed"))
  assert.equal((await ledgerOf(userId)).length, 1)
})

await test("4:00 换日：4:00 前的进度属于前一天，4:00 后新的一天从 0 开始", async () => {
  const userId = await newUser()
  await recordQuestEvent(db, userId, "feed", { now: bj(2026, 11, 25, 3, 59) })
  const before = (await quests.getQuests(userId, bj(2026, 11, 25, 3, 59))).quests.find((q) => q.id === "daily-feed")!
  assert.equal(before.progress, 1)
  assert.equal(before.claimable, true)

  const after = (await quests.getQuests(userId, bj(2026, 11, 25, 4, 0))).quests.find((q) => q.id === "daily-feed")!
  assert.equal(after.progress, 0, "新的一天从 0 开始")
  assert.equal(after.claimable, false)
  await rejectsWith(quests.claimQuest(userId, "daily-feed", bj(2026, 11, 25, 4, 0)), "not_done")

  await recordQuestEvent(db, userId, "feed", { now: bj(2026, 11, 25, 4, 0) })
  assert.equal((await rowsOf(userId)).filter((r) => r.questId === "daily-feed").length, 2, "两天各一行")
})

await test("周常周一 4:00、月常每月 1 日 4:00 才重置", async () => {
  const userId = await newUser()
  await recordQuestEvent(db, userId, "pack-open", { amount: 2, now: bj(2026, 11, 29, 23) }) // 周日
  const view = async (now: number) => (await quests.getQuests(userId, now)).quests
  const weekly = (list: Awaited<ReturnType<typeof view>>) => list.find((q) => q.id === "weekly-open-packs")!.progress
  const monthly = (list: Awaited<ReturnType<typeof view>>) => list.find((q) => q.id === "monthly-open-packs")!.progress

  assert.equal(weekly(await view(bj(2026, 11, 30, 3, 59))), 2, "周一 4:00 之前仍是同一周")
  assert.equal(weekly(await view(bj(2026, 11, 30, 4, 0))), 0)
  assert.equal(monthly(await view(bj(2026, 11, 30, 4, 0))), 2, "月常还是 11 月")
  assert.equal(monthly(await view(bj(2026, 12, 1, 3, 59))), 2)
  assert.equal(monthly(await view(bj(2026, 12, 1, 4, 0))), 0)
})

await test("事件的地图种类限定：只记对应种类的远征", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  await recordQuestEvent(db, userId, "expedition-clear", { mapKind: "main", now: t })
  assert.equal(await progressOf(userId, "weekly-patrol"), 0, "主线不算周常地图")
  assert.equal(await progressOf(userId, "monthly-expedition-clear"), 1, "没限定种类的任务都算")
  await recordQuestEvent(db, userId, "expedition-clear", { mapKind: "weekly", now: t })
  assert.equal(await progressOf(userId, "weekly-patrol"), 1)
  assert.equal(await progressOf(userId, "monthly-expedition-clear"), 2)
  await recordQuestEvent(db, userId, "expedition-win", { mapKind: "daily", now: t })
  assert.equal(await progressOf(userId, "daily-expedition"), 1)
})

await test("一键全领：只领完成了没领的，合并展示，再点什么都不发", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  await recordQuestEvent(db, userId, "feed", { now: t })
  await recordQuestEvent(db, userId, "expedition-clear", { now: t, mapKind: "daily" })
  await recordQuestEvent(db, userId, "pack-open", { now: t })
  await quests.claimQuest(userId, "daily-open-pack", t)
  const before = await coinsOf(userId)

  const result = await quests.claimAllQuests(userId, t)
  assert.deepEqual([...result.claimed].sort(), ["daily-expedition-clear", "daily-feed"])
  const expected = mergeQuestRewards([defOf("daily-feed").rewards, defOf("daily-expedition-clear").rewards])
  assert.equal(result.rewards.find((line) => line.kind === "coins")?.count, expected.coins)
  assert.equal((await coinsOf(userId)) - before, expected.coins)
  assert.equal((await ledgerOf(userId)).filter((e) => e.source === "quest").length >= 3, true)

  const again = await quests.claimAllQuests(userId, t)
  assert.deepEqual(again.claimed, [])
  assert.equal((await coinsOf(userId)) - before, expected.coins)

  const overview = await quests.getQuests(userId, t)
  assert.equal(overview.claimable, 0)
})

await test("一键全领也扛得住并发", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  await recordQuestEvent(db, userId, "feed", { now: t })
  await Promise.allSettled(Array.from({ length: 5 }, () => quests.claimAllQuests(userId, t)))
  assert.equal(await coinsOf(userId), rewardCoins("daily-feed"))
})

await test("总览：重置时间、活跃点、红点", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  await recordQuestEvent(db, userId, "feed", { now: t })
  let overview = await quests.getQuests(userId, t)
  assert.deepEqual(overview.resets, {
    daily: new Date(bj(2026, 11, 25, 4)).toISOString(),
    weekly: new Date(bj(2026, 11, 30, 4)).toISOString(),
    monthly: new Date(bj(2026, 12, 1, 4)).toISOString(),
  })
  const total = (period: string) =>
    Object.values(QUEST_CONTENT.quests)
      .filter((def) => def.period === period)
      .reduce((sum, def) => sum + def.points, 0)
  assert.equal(overview.points.daily.total, total("daily"))
  assert.equal(overview.points.daily.earned, 0)
  assert.equal(overview.claimable, 1)

  await quests.claimQuest(userId, "daily-feed", t)
  overview = await quests.getQuests(userId, t)
  assert.equal(overview.points.daily.earned, defOf("daily-feed").points, "领了才算活跃点")
  assert.equal(overview.claimable, 0)
  assert.equal(overview.quests.length, Object.keys(QUEST_CONTENT.quests).length)
})

// ---------- 签到 ----------

await test("签到：一天一次，奖励按本月第几天，写流水，并给日常签到任务记一笔", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  const first = await quests.signIn(userId, t)
  assert.equal(first.day, 24)
  const expected = signInRewardFor(QUEST_CONTENT.signIn, 24)
  assert.equal(await coinsOf(userId), expected.coins)

  await rejectsWith(quests.signIn(userId, bj(2026, 11, 24, 23, 59)), "already_signed")
  assert.equal(await coinsOf(userId), expected.coins)
  await quests.signIn(userId, bj(2026, 11, 25, 4, 0))
  await rejectsWith(quests.signIn(userId, bj(2026, 11, 25, 12)), "already_signed")

  const ledger = (await ledgerOf(userId)).filter((e) => e.source === "sign-in")
  assert.deepEqual(ledger.map((e) => e.sourceRef).sort(), ["2026-11-24", "2026-11-25"])
  assert.equal(await progressOf(userId, "daily-sign-in"), 2, "两天各一行，各记 1")
})

await test("签到：特别日期用特别奖励（含卡包），不补签", async () => {
  const userId = await newUser()
  const special = Object.keys(QUEST_CONTENT.signIn.bonus).map(Number)[0]!
  const t = bj(2026, 12, special, 10)
  const reward = signInRewardFor(QUEST_CONTENT.signIn, special)
  await quests.signIn(userId, t)
  assert.equal(await coinsOf(userId), reward.coins ?? 0)
  for (const { pool, count } of reward.packs ?? []) {
    const [row] = await db.select().from(userPacks).where(and(eq(userPacks.userId, userId), eq(userPacks.pool, pool as "normal")))
    assert.equal(row?.count, count)
  }

  const overview = await quests.getQuests(userId, t)
  assert.equal(overview.signIn.today, special)
  assert.equal(overview.signIn.signedToday, true)
  assert.equal(overview.signIn.signedDays, 1, "前面没签的日子不会被补上")
  assert.equal(overview.signIn.days.length, 31)
  assert.equal(overview.signIn.days.filter((d) => d.signed).length, 1)
  assert.equal(overview.signIn.days.find((d) => d.day === special)!.special, true)
})

await test("签到：并发只成功一次；每月 1 日 4:00 才换月", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 30, 10)
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => quests.signIn(userId, t)))
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1)
  assert.equal(await coinsOf(userId), signInRewardFor(QUEST_CONTENT.signIn, 30).coins)

  // 12 月 1 日 3:59 仍是 11 月 30 日，已经签过
  await rejectsWith(quests.signIn(userId, bj(2026, 12, 1, 3, 59)), "already_signed")
  const lastNight = await quests.getQuests(userId, bj(2026, 12, 1, 3, 59))
  assert.equal(lastNight.signIn.monthKey, "2026-11")
  assert.equal(lastNight.signIn.signedToday, true)
  const morning = await quests.getQuests(userId, bj(2026, 12, 1, 4, 0))
  assert.equal(morning.signIn.monthKey, "2026-12")
  assert.equal(morning.signIn.today, 1)
  assert.equal(morning.signIn.signedToday, false)
  assert.equal(morning.signIn.signedDays, 0)
  const day1 = await quests.signIn(userId, bj(2026, 12, 1, 4, 0))
  assert.equal(day1.day, 1)
})

await test("新手四日补给：按账号累计签到发放，跨月不断、老号次月不重领", async () => {
  const starterIds = ["ach-starter-1", "ach-starter-2", "ach-starter-3", "ach-starter-4"]
  const expected = mergeQuestRewards(starterIds.map((id) => defOf(id).rewards))

  const runFourDays = async (dates: [number, number, number][]) => {
    const userId = await newUser()
    for (const [y, m, d] of dates) await quests.signIn(userId, bj(y, m, d, 10))
    const overview = await quests.getQuests(userId, bj(dates[3]![0], dates[3]![1], dates[3]![2], 12))
    assert.equal(
      starterIds.every((id) => overview.quests.find((q) => q.id === id)?.claimable),
      true,
      `建号组 ${dates[0]!.join("-")} 到第 4 次签到应全可领`,
    )
    const claimed = await quests.claimAllQuests(userId, bj(dates[3]![0], dates[3]![1], dates[3]![2], 12))
    for (const id of starterIds) assert.ok(claimed.claimed.includes(id), `应领到 ${id}`)

    const afterStarter = {
      normal: await packsOf(userId, "normal"),
      golden: await packsOf(userId, "golden"),
      radiant: await packsOf(userId, "radiant"),
    }

    // 老号跨到下个月 1-4 日再签 4 天，不会重复拿到新手四档
    const nextMonth = dates[3]![1] === 12 ? [dates[3]![0] + 1, 1] : [dates[3]![0], dates[3]![1] + 1]
    for (let d = 1; d <= 4; d += 1) await quests.signIn(userId, bj(nextMonth[0]!, nextMonth[1]!, d, 10))
    const secondPass = await quests.claimAllQuests(userId, bj(nextMonth[0]!, nextMonth[1]!, 4, 12))
    for (const id of starterIds) assert.equal(secondPass.claimed.includes(id), false, `老号次月不应重领 ${id}`)
    return afterStarter
  }

  const expectedNormal = expected.packs!.find((p) => p.pool === "normal")!.count
  const expectedGolden = expected.packs!.find((p) => p.pool === "golden")!.count
  const expectedRadiant = expected.packs!.find((p) => p.pool === "radiant")!.count

  // 月初、月中、跨月三个建号场景都拿到完全一致的 75 普 + 15 金 + 2 璀璨
  for (const dates of [
    [[2026, 11, 1], [2026, 11, 2], [2026, 11, 3], [2026, 11, 4]],
    [[2026, 11, 24], [2026, 11, 25], [2026, 11, 26], [2026, 11, 27]],
    [[2026, 11, 30], [2026, 12, 1], [2026, 12, 2], [2026, 12, 3]],
  ] as [number, number, number][][]) {
    const got = await runFourDays(dates)
    assert.equal(got.normal, expectedNormal)
    assert.equal(got.golden, expectedGolden)
    assert.equal(got.radiant, expectedRadiant)
  }
})

// ---------- 过期没领 ----------

await test("过期没领的奖励合成一封邮件发到邮箱，只发一次；没完成的作废", async () => {
  const userId = await newUser()
  const before0 = await expOf(userId)
  const t = bj(2026, 11, 24, 10)
  await recordQuestEvent(db, userId, "feed", { now: t })
  await recordQuestEvent(db, userId, "expedition-clear", { now: t, mapKind: "daily" })
  await recordQuestEvent(db, userId, "expedition-win", { now: t }) // daily-expedition 目标 2，只有 1
  await recordQuestEvent(db, userId, "pack-open", { now: t })
  await quests.claimQuest(userId, "daily-open-pack", t) // 已经领过的不会再发

  // 同一个重置日里不转邮件
  await quests.getQuests(userId, bj(2026, 11, 25, 3, 59))
  assert.equal((await mailsOf(userId)).length, 0)
  const coinsBefore = await coinsOf(userId)

  await quests.getQuests(userId, bj(2026, 11, 25, 4, 0))
  const sent = await mailsOf(userId)
  assert.equal(sent.length, 1)
  const { playerExp: expectedExp = 0, ...expected } = mergeQuestRewards([defOf("daily-feed").rewards, defOf("daily-expedition-clear").rewards])
  assert.deepEqual(sent[0]!.attachment, expected, "玩家经验不进邮件附件")
  assert.ok(expectedExp > 0)
  assert.equal((await expOf(userId)) - before0, expectedExp + (defOf("daily-open-pack").rewards.playerExp ?? 0), "经验在转邮件时直接到账")
  assert.equal(sent[0]!.claimedAt, null, "邮件要玩家自己去领")
  assert.equal(await coinsOf(userId), coinsBefore, "邮件本身不直接发金币")

  const left = (await rowsOf(userId)).filter((r) => r.questId.startsWith("daily-") && r.periodKey === "2026-11-24")
  assert.deepEqual(left.map((r) => r.questId).sort(), ["daily-expedition-clear", "daily-feed", "daily-open-pack"], "没完成的那行被清掉")
  assert.equal(left.filter((r) => r.autoClaimed).length, 2)

  await quests.getQuests(userId, bj(2026, 11, 26, 10))
  assert.equal((await mailsOf(userId)).length, 1, "再读不会重复发")

  // 邮件能正常领取
  const mail = await import("../src/mail")
  await mail.claimMail(userId, sent[0]!.id)
  assert.equal((await coinsOf(userId)) - coinsBefore, expected.coins)
})

await test("过期转邮件：并发读取只发一封", async () => {
  const userId = await newUser()
  await recordQuestEvent(db, userId, "feed", { now: bj(2026, 11, 24, 10) })
  await Promise.all(Array.from({ length: 5 }, () => quests.getQuests(userId, bj(2026, 11, 25, 10))))
  assert.equal((await mailsOf(userId)).length, 1)
})

await test("周常、月常各自在自己的重置点才转邮件", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  await recordQuestEvent(db, userId, "pack-open", { amount: 10, now: t })
  // 日常的进度不在这条用例要测的范围内，免得它们先到期转邮件
  for (const row of (await rowsOf(userId)).filter((r) => r.questId.startsWith("daily-"))) {
    await db.delete(questProgress).where(and(eq(questProgress.userId, userId), eq(questProgress.questId, row.questId)))
  }

  await quests.getQuests(userId, bj(2026, 11, 30, 3, 59))
  assert.equal((await mailsOf(userId)).length, 0, "周一 4:00 之前，周常还没到期")
  await quests.getQuests(userId, bj(2026, 11, 30, 4, 0))
  let sent = await mailsOf(userId)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.attachment?.coins, rewardCoins("weekly-open-packs"))

  await quests.getQuests(userId, bj(2026, 12, 1, 3, 59))
  assert.equal((await mailsOf(userId)).length, 1, "11 月还没结束")
  await quests.getQuests(userId, bj(2026, 12, 1, 4, 0))
  sent = await mailsOf(userId)
  assert.equal(sent.length, 1, "月常只做了 10/100，没完成，作废不发")
  assert.equal(
    (await rowsOf(userId)).some((r) => r.questId === "monthly-open-packs"),
    false,
  )
})

await test("内容里已经删掉的任务留下的进度行会被清掉，不发奖", async () => {
  const userId = await newUser()
  await db.insert(questProgress).values({ userId, questId: "removed-quest", periodKey: "2026-11-01", progress: 9 })
  await quests.getQuests(userId, bj(2026, 11, 24, 10))
  assert.equal((await rowsOf(userId)).some((r) => r.questId === "removed-quest"), false)
  assert.equal((await mailsOf(userId)).length, 0)
})

// ---------- 各动作的埋点 ----------

const sessionHeaders = (userId: string) => ({ cookie: `${COOKIE_NAME}=${makeSession(userId)}` })
const call = async (userId: string, method: "GET" | "POST", url: string, payload?: unknown) => {
  const res = await app.inject({ method, url, payload: payload as never, headers: sessionHeaders(userId) })
  return { status: res.statusCode, body: res.json() }
}
const now = () => Date.now()
/** 路由里用的是真实时间，所以这里按现在的周期取进度 */
const progressNow = async (userId: string, questId: string) => {
  const key = questPeriodKey(defOf(questId).period, now())
  return (await rowsOf(userId)).find((r) => r.questId === questId && r.periodKey === key)?.progress ?? 0
}

for (const rarity of ["C", "UC", "R", "E", "L", "Mythic", "Prismatic"]) {
  await db.insert(cards).values({ id: `q-${rarity}`, name: `q-${rarity}`, rarity, job: "warrior", no: 1, total: 1 })
}
const giveCard = async (userId: string, cardId = "q-C") =>
  (await db.insert(userCards).values({ userId, cardId }).returning({ id: userCards.id }))[0]!.id

await test("埋点：开包（失败的不算）", async () => {
  const userId = await newUser()
  // 挂机包不会触发镜像卡，测试里不用准备镜像卡
  await db.insert(userPacks).values({ userId, pool: "idle", count: 1 })
  let res = await call(userId, "POST", "/packs/idle/open", {})
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(await progressNow(userId, "daily-open-pack"), 1)
  assert.equal(await progressNow(userId, "weekly-open-packs"), 1)
  res = await call(userId, "POST", "/packs/idle/open", {})
  assert.equal(res.status, 400, "没包了")
  assert.equal(await progressNow(userId, "weekly-open-packs"), 1)
})

await test("埋点：喂养（被拒的不算）", async () => {
  const userId = await newUser()
  const target = await giveCard(userId)
  const material = await giveCard(userId)
  const stranger = await giveCard(await newUser())
  let res = await call(userId, "POST", `/users/${userId}/cards/${target}/feed`, { cards: [target] })
  assert.equal(res.status, 400)
  res = await call(userId, "POST", `/users/${userId}/cards/${target}/feed`, { cards: [stranger] })
  assert.notEqual(res.status, 200)
  assert.equal(await progressNow(userId, "daily-feed"), 0)
  res = await call(userId, "POST", `/users/${userId}/cards/${target}/feed`, { cards: [material] })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(await progressNow(userId, "daily-feed"), 1)
})

await test("埋点：融合（没有同名卡时不算）", async () => {
  const userId = await newUser()
  const target = await giveCard(userId)
  let res = await call(userId, "POST", `/users/${userId}/cards/${target}/constellation`)
  assert.equal(res.status, 400)
  assert.equal(await progressNow(userId, "monthly-fuse"), 0)
  await giveCard(userId)
  res = await call(userId, "POST", `/users/${userId}/cards/${target}/constellation`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(await progressNow(userId, "monthly-fuse"), 1)
})

await test("埋点：分解", async () => {
  const userId = await newUser()
  const card = await giveCard(userId)
  const res = await call(userId, "POST", `/users/${userId}/cards/${card}/dismantle`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(await progressNow(userId, "weekly-dismantle"), 1)
})

await test("埋点：市场买入和卖出（只挂单不算，成交才算双方各一笔）", async () => {
  const seller = await newUser({ coins: 100, playerLevel: 50 })
  const buyer = await newUser({ coins: 1000, playerLevel: 50 })
  const card = await giveCard(seller)
  const listed = await call(seller, "POST", `/users/${seller}/market/list`, { userCardId: card, price: 100 })
  assert.equal(listed.status, 200, JSON.stringify(listed.body))
  assert.equal(await progressNow(seller, "t-market-sell"), 0)

  const bought = await call(buyer, "POST", `/users/${buyer}/market/buy/${listed.body.data.id}`)
  assert.equal(bought.status, 200, JSON.stringify(bought.body))
  assert.equal(await progressNow(buyer, "t-market-buy"), 1)
  assert.equal(await progressNow(buyer, "t-market-sell"), 0)
  assert.equal(await progressNow(seller, "t-market-sell"), 1)
  assert.equal(await progressNow(seller, "t-market-buy"), 0)

  const again = await call(buyer, "POST", `/users/${buyer}/market/buy/${listed.body.data.id}`)
  assert.equal(again.status, 404, "已经卖掉的不能再买")
  assert.equal(await progressNow(buyer, "t-market-buy"), 1)
})

// ---------- 活跃度宝箱 ----------

const dailyChests = QUEST_CONTENT.activity.daily!
const completeQuest = (userId: string, questId: string, t: number) => {
  const def = defOf(questId)
  return recordQuestEvent(db, userId, def.event, {
    amount: def.target,
    value: def.target,
    mapKind: def.mapKind,
    mapId: def.mapId,
    rarity: def.minRarity,
    now: t,
  })
}

await test("活跃度宝箱：领任务攒活跃点，点数到了才能领宝箱，每个只能领一次", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  for (const id of ["daily-feed", "daily-open-pack", "daily-expedition-clear"]) await completeQuest(userId, id, t)

  let overview = await quests.getQuests(userId, t)
  assert.equal(overview.activity.daily.earned, 0, "完成了没领，不算活跃点")
  assert.equal(overview.activity.daily.cap, 100)
  assert.equal(overview.activity.daily.chests.length, 5)
  assert.equal(overview.claimable, 3)

  for (const id of ["daily-feed", "daily-open-pack", "daily-expedition-clear"]) await quests.claimQuest(userId, id, t)
  overview = await quests.getQuests(userId, t)
  assert.equal(overview.activity.daily.earned, 35)
  assert.deepEqual(
    overview.activity.daily.chests.map((c) => c.claimable),
    [true, false, false, false, false],
  )
  assert.equal(overview.claimable, 1, "只剩 20 点那一档宝箱")

  await rejectsWith(quests.claimChest(userId, "daily", 40, t), "not_done")
  await rejectsWith(quests.claimChest(userId, "daily", 25, t), "not_found")
  const before = await packsOf(userId, "normal")
  await quests.claimChest(userId, "daily", 20, t)
  assert.equal((await packsOf(userId, "normal")) - before, dailyChests[0]!.rewards.packs![0]!.count)
  await rejectsWith(quests.claimChest(userId, "daily", 20, t), "already_claimed")
  assert.equal((await quests.getQuests(userId, t)).claimable, 0)
  assert.equal((await ledgerOf(userId)).filter((e) => e.source === "quest-chest").length > 0, true)
})

await test("活跃度宝箱：并发领同一个宝箱只发一次", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  for (const id of ["daily-feed", "daily-open-pack"]) {
    await completeQuest(userId, id, t)
    await quests.claimQuest(userId, id, t)
  }
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => quests.claimChest(userId, "daily", 20, t)))
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1)
  assert.equal(await packsOf(userId, "normal"), dailyChests[0]!.rewards.packs![0]!.count)
})

await test("一键全领：任务和宝箱一起领，活跃点封顶 100，五档全开", async () => {
  // 从低等级起步：日常经验领完会升级，别让它顺手碰到「达到 Lv10」成就影响 claimable
  const userId = await newUser({ playerLevel: 3 })
  const t = bj(2026, 11, 24, 10)
  for (const [id, def] of Object.entries(QUEST_CONTENT.quests)) if (def.period === "daily") await completeQuest(userId, id, t)

  const result = await quests.claimAllQuests(userId, t)
  assert.deepEqual(result.chests.sort(), ["daily-100", "daily-20", "daily-40", "daily-60", "daily-80"])
  const overview = await quests.getQuests(userId, t)
  assert.equal(overview.activity.daily.earned, 100, "活跃点封顶在最大一档")
  assert.equal(
    overview.activity.daily.chests.every((c) => c.claimed),
    true,
  )
  assert.equal(overview.claimable, 0)
  const again = await quests.claimAllQuests(userId, t)
  assert.deepEqual([again.claimed, again.chests], [[], []])
  // 宝箱奖励按内容算：这里只对一下卡包总数（同时确认所有日常任务都被领了）
  for (const [id, def] of Object.entries(QUEST_CONTENT.quests)) {
    if (def.period === "daily") assert.ok(result.claimed.includes(id), `应领到日常 ${id}`)
  }
  const normalPacks = dailyChests.reduce((sum, c) => sum + (c.rewards.packs?.find((p) => p.pool === "normal")?.count ?? 0), 0)
  const taskPacks = result.claimed
    .map((id) => QUEST_CONTENT.quests[id]!)
    .reduce((sum, def) => sum + (def.rewards.packs?.find((p) => p.pool === "normal")?.count ?? 0), 0)
  assert.equal(await packsOf(userId, "normal"), normalPacks + taskPacks)
})

await test("活跃度宝箱：周常、月常也有自己的一排，互不串", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  await completeQuest(userId, "weekly-patrol", t)
  await quests.claimQuest(userId, "weekly-patrol", t)
  const overview = await quests.getQuests(userId, t)
  assert.equal(overview.activity.weekly.earned, defOf("weekly-patrol").points)
  assert.equal(overview.activity.daily.earned, 0)
  assert.equal(overview.activity.monthly.earned, 0)
})

await test("过期没领的宝箱也会转成邮件，已领的不会重发", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  for (const id of ["daily-feed", "daily-open-pack"]) {
    await completeQuest(userId, id, t)
    await quests.claimQuest(userId, id, t)
  }
  assert.equal((await quests.getQuests(userId, t)).activity.daily.chests[0]!.claimable, true)

  await quests.getQuests(userId, bj(2026, 11, 25, 10))
  const sent = await mailsOf(userId)
  assert.equal(sent.length, 1)
  const { playerExp: chestExp = 0, ...chestAttachment } = mergeQuestRewards([dailyChests[0]!.rewards])
  assert.deepEqual(sent[0]!.attachment, chestAttachment)
  assert.ok(chestExp > 0)
  await quests.getQuests(userId, bj(2026, 11, 26, 10))
  assert.equal((await mailsOf(userId)).length, 1)
  const overview = await quests.getQuests(userId, bj(2026, 11, 26, 10))
  assert.equal(overview.activity.daily.earned, 0, "新一天从 0 开始")
})

await test("接口：领宝箱", async () => {
  const userId = await newUser()
  for (const id of ["daily-feed", "daily-open-pack"]) {
    await completeQuest(userId, id, Date.now())
    await call(userId, "POST", `/users/${userId}/quests/${id}/claim`)
  }
  let res = await call(userId, "POST", `/users/${userId}/quests/chests/daily/40/claim`)
  assert.equal(res.body.error.code, "not_done")
  res = await call(userId, "POST", `/users/${userId}/quests/chests/daily/20/claim`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  res = await call(userId, "POST", `/users/${userId}/quests/chests/daily/20/claim`)
  assert.equal(res.body.error.code, "already_claimed")
  res = await call(userId, "POST", `/users/${userId}/quests/chests/yearly/20/claim`)
  assert.notEqual(res.status, 200)
})

// ---------- 一次性成就与新事件 ----------

await test("一次性成就：不重置、不过期；玩家等级取最高值，到了才能领，没有活跃点", async () => {
  const userId = await newUser({ playerLevel: 25 })
  const t = bj(2026, 11, 24, 10)
  let overview = await quests.getQuests(userId, t)
  const view = (id: string) => overview.quests.find((q) => q.id === id)!
  assert.equal(view("ach-level-10").claimable, true)
  assert.equal(view("ach-level-20").claimable, true)
  assert.equal(view("ach-level-30").claimable, false)
  assert.equal(view("ach-level-30").progress, 25)
  assert.equal(view("ach-level-10").period, "once")

  await quests.claimQuest(userId, "ach-level-10", t)
  assert.equal((await quests.getQuests(userId, t)).activity.daily.earned, 0, "成就不给活跃点")

  // 过了几个月，没领的成就还在，也不会被转成邮件
  const later = bj(2027, 3, 5, 10)
  overview = await quests.getQuests(userId, later)
  assert.equal(view("ach-level-20").claimable, true)
  assert.equal(view("ach-level-10").claimed, true)
  assert.equal((await mailsOf(userId)).length, 0)
  await quests.claimQuest(userId, "ach-level-20", later)
  await rejectsWith(quests.claimQuest(userId, "ach-level-20", later), "already_claimed")

  // 升级后继续记，一键全领能领到新到手的成就
  await db.update(users).set({ playerLevel: 31 }).where(eq(users.id, userId))
  const all = await quests.claimAllQuests(userId, later)
  assert.deepEqual(all.claimed, ["ach-level-30"])
})

await test("取最大值的事件：不会往回降，也不会累加", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  await recordQuestEvent(db, userId, "constellation", { value: 3, now: t })
  await recordQuestEvent(db, userId, "constellation", { value: 2, now: t })
  await recordQuestEvent(db, userId, "constellation", { value: 3, now: t })
  assert.equal(await progressOf(userId, "ach-constellation-3"), 3, "三次记账没有加成 8")
  assert.equal(await progressOf(userId, "ach-constellation-6"), 3)
  await recordQuestEvent(db, userId, "constellation", { value: 9, now: t })
  assert.equal(await progressOf(userId, "ach-constellation-6"), 6, "封顶在目标")
  await recordQuestEvent(db, userId, "expedition-tier", { value: 4, mapKind: "daily", now: t })
  assert.equal(await progressOf(userId, "ach-tier-3"), 3)
  assert.equal(await progressOf(userId, "ach-tier-5"), 4)
  assert.equal(await progressOf(userId, "monthly-tier"), 3)
})

await test("获得卡牌：可限定稀有度，高品质同时算低一档的任务", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  await recordQuestEvent(db, userId, "card-obtain", { rarity: "R", now: t })
  assert.equal(await progressOf(userId, "ach-obtain-100"), 1)
  assert.equal(await progressOf(userId, "ach-legend-1"), 0)
  await recordQuestEvent(db, userId, "card-obtain", { rarity: "L", now: t })
  assert.equal(await progressOf(userId, "ach-legend-1"), 1)
  assert.equal(await progressOf(userId, "ach-mythic-1"), 0)
  await recordQuestEvent(db, userId, "card-obtain", { rarity: "Prismatic", now: t })
  assert.equal(await progressOf(userId, "ach-legend-10"), 2)
  assert.equal(await progressOf(userId, "ach-mythic-1"), 1)
  assert.equal(await progressOf(userId, "ach-prismatic-1"), 1)
  assert.equal(await progressOf(userId, "ach-obtain-100"), 3)
})

await test("埋点：获得卡、融合命座、喂养升级都会记成就", async () => {
  const userId = await newUser()
  const target = await giveCard(userId)
  await giveCard(userId)
  const fused = await call(userId, "POST", `/users/${userId}/cards/${target}/constellation`)
  assert.equal(fused.status, 200, JSON.stringify(fused.body))
  assert.equal(await progressOf(userId, "ach-constellation-3"), 1, "融合后命座 1")

  const food = await giveCard(userId)
  const fed = await call(userId, "POST", `/users/${userId}/cards/${target}/feed`, { cards: [food] })
  assert.equal(fed.status, 200, JSON.stringify(fed.body))
  assert.equal(await progressOf(userId, "ach-card-level-20"), fed.body.data.card.level, "喂养后卡的等级")
})

await test("埋点：开包拿到的卡算获得卡牌", async () => {
  const userId = await newUser()
  await db.insert(userPacks).values({ userId, pool: "idle", count: 1 })
  const res = await call(userId, "POST", "/packs/idle/open", {})
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal((await progressOf(userId, "ach-obtain-100")) >= 1, true)
})

// ---------- 内容校验 ----------

await test("任务内容校验：成就不给活跃点、限定字段只能配在对应事件上、宝箱要拿得到", async () => {
  const { parseQuestContent } = await import("@choke/shared/quest-content")
  const base = () => structuredClone(QUEST_CONTENT)
  const fails = (mutate: (c: ReturnType<typeof base>) => void, message: RegExp) => {
    const content = base()
    mutate(content)
    assert.throws(() => parseQuestContent(content), message)
  }
  assert.doesNotThrow(() => parseQuestContent(base()))

  fails((c) => (c.quests["ach-level-10"]!.points = 5), /一次性成就不给活跃点/)
  fails((c) => (c.quests["daily-feed"]!.minRarity = "L"), /minRarity 只能配在 card-obtain/)
  fails((c) => (c.quests["daily-feed"]!.mapId = "test-daily"), /mapId 只能配在 expedition/)
  fails((c) => (c.quests["ach-tier-5"]!.target = 6), /难度档位最高是 5/)
  fails((c) => (c.activity.daily![1]!.at = 20), /at 必须比前一档大/)
  fails((c) => (c.activity.daily![4]!.at = 999), /永远领不到/)
  fails((c) => (c.activity.daily![0]!.rewards = { packs: [{ pool: "nope", count: 1 }] }), /卡包 nope 不存在/)
  fails((c) => (c.quests["ach-level-10"]!.group = ""), /group/)
})

await test("任务内容校验：mapId 要指向存在的地图，并和 mapKind 一致", async () => {
  const { parseQuestContent } = await import("@choke/shared/quest-content")
  const { WORLD_CONTENT } = await import("../src/content")
  const mapId = Object.keys(WORLD_CONTENT.maps)[0]!
  const kind = WORLD_CONTENT.maps[mapId]!.kind
  const wrongKind = (["main", "season", "weekly", "daily"] as const).find((k) => k !== kind)!
  const make = (extra: Record<string, unknown>) => {
    const content = structuredClone(QUEST_CONTENT)
    content.quests["ach-main-1"] = { ...content.quests["ach-main-1"]!, ...extra } as never
    return content
  }
  assert.doesNotThrow(() => parseQuestContent(make({ mapKind: kind, mapId }), WORLD_CONTENT))
  assert.throws(() => parseQuestContent(make({ mapKind: kind, mapId: "no-such-map" }), WORLD_CONTENT), /地图 no-such-map 不存在/)
  assert.throws(() => parseQuestContent(make({ mapKind: wrongKind, mapId }), WORLD_CONTENT), /不是 .* 地图/)
})

// ---------- 接口 ----------

await test("接口：总览、领取、一键全领、签到；只能操作自己的账号", async () => {
  const userId = await newUser()
  const other = await newUser()
  await recordQuestEvent(db, userId, "feed")

  let res = await call(userId, "GET", `/users/${userId}/quests`)
  assert.equal(res.status, 200)
  assert.equal(res.body.data.claimable, 1)
  assert.equal(res.body.data.quests.length, Object.keys(QUEST_CONTENT.quests).length)

  res = await call(other, "GET", `/users/${userId}/quests`)
  assert.notEqual(res.status, 200, "别人不能看")
  res = await call(other, "POST", `/users/${userId}/quests/daily-feed/claim`)
  assert.notEqual(res.status, 200, "别人不能领")
  res = await call(userId, "POST", `/users/${userId}/quests/daily-expedition-clear/claim`)
  assert.equal(res.status, 400)
  assert.equal(res.body.error.code, "not_done")
  res = await call(userId, "POST", `/users/${userId}/quests/daily-feed/claim`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  res = await call(userId, "POST", `/users/${userId}/quests/daily-feed/claim`)
  assert.equal(res.body.error.code, "already_claimed")

  res = await call(userId, "POST", `/users/${userId}/sign-in`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  res = await call(userId, "POST", `/users/${userId}/sign-in`)
  assert.equal(res.body.error.code, "already_signed")
  res = await call(userId, "POST", `/users/${userId}/quests/claim-all`)
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.data.claimed.sort(), ["ach-starter-1", "daily-sign-in"], "签到顺带完成了日常签到和新手首日补给")
})

console.log(`\n${passed} quest tests passed`)
await cleanup()
process.exit(0)
