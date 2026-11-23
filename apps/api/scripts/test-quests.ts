/**
 * 任务与签到的服务端测试：重置时间边界（4:00 / 周一 / 每月 1 日）、进度累加封顶、
 * 重复和并发领取只发一次、流水对得上、一键全领、签到、过期未领奖励转邮件、各动作的埋点。
 * 用临时 PGlite 数据库，不碰开发库。
 *
 *   pnpm test:quests
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "choke-quests-test-"))
process.env.DATABASE_URL = ""
process.env.PG_DATA_DIR = dataDir

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

const { db, client } = await import("../src/db/client")
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
const { dungeonRoutes } = await import("../src/routes/dungeons")
const { packRoutes } = await import("../src/routes/packs")
const { nextReset, periodKey, resetDayKey, resetMonthDay, resetMonthKey, resetWeekKey } = await import(
  "@choke/shared/reset"
)
const { daysInMonthKey, mergeQuestRewards, signInRewardFor } = await import("@choke/shared/quests")

const app = Fastify()
app.setErrorHandler(handleError)
await app.register(cookie)
for (const routes of [questRoutes, progressionRoutes, marketRoutes, dungeonRoutes, packRoutes]) await app.register(routes)
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
  await client?.close().catch(() => {})
  fs.rmSync(dataDir, { recursive: true, force: true })
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
    tutorialDone: true,
    playerLevel: 50,
    stamina: 200,
    staminaUpdatedAt: Date.now(),
    coins: 0,
    ...patch,
  })
  return id
}

const coinsOf = async (userId: string) => (await db.select({ v: users.coins }).from(users).where(eq(users.id, userId)))[0]!.v
const ledgerOf = (userId: string) => db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, userId))
const mailsOf = (userId: string) => db.select().from(mails).where(eq(mails.userId, userId))
const rowsOf = (userId: string) => db.select().from(questProgress).where(eq(questProgress.userId, userId))
/** 这个任务现在所有周期的进度之和（测试里每个任务只会有一行时就是那一行） */
const progressOf = async (userId: string, questId: string) =>
  (await rowsOf(userId)).filter((row) => row.questId === questId).reduce((sum, row) => sum + row.progress, 0)
const defOf = (questId: string) => QUEST_CONTENT.quests[questId]!
const rewardCoins = (questId: string) => defOf(questId).rewards.coins ?? 0

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
  await recordQuestEvent(db, userId, "dungeon-run", { now: t })
  await quests.claimQuest(userId, "daily-dungeon", t)
  const def = defOf("daily-dungeon")
  assert.equal(await coinsOf(userId), def.rewards.coins ?? 0)
  for (const { itemId, count } of def.rewards.items ?? []) {
    const [row] = await db.select().from(userItems).where(and(eq(userItems.userId, userId), eq(userItems.itemId, itemId)))
    assert.equal(row?.count, count)
    const logged = (await ledgerOf(userId)).filter((e) => e.kind === "item" && e.ref === itemId)
    assert.equal(logged.reduce((sum, e) => sum + e.delta, 0), count)
  }
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
  await recordQuestEvent(db, userId, "dungeon-run", { now: t })
  await recordQuestEvent(db, userId, "pack-open", { now: t })
  await quests.claimQuest(userId, "daily-open-pack", t)
  const before = await coinsOf(userId)

  const result = await quests.claimAllQuests(userId, t)
  assert.deepEqual([...result.claimed].sort(), ["daily-dungeon", "daily-feed"])
  const expected = mergeQuestRewards([defOf("daily-feed").rewards, defOf("daily-dungeon").rewards])
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

// ---------- 过期没领 ----------

await test("过期没领的奖励合成一封邮件发到邮箱，只发一次；没完成的作废", async () => {
  const userId = await newUser()
  const t = bj(2026, 11, 24, 10)
  await recordQuestEvent(db, userId, "feed", { now: t })
  await recordQuestEvent(db, userId, "dungeon-run", { now: t })
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
  const expected = mergeQuestRewards([defOf("daily-feed").rewards, defOf("daily-dungeon").rewards])
  assert.deepEqual(sent[0]!.attachment, expected)
  assert.equal(sent[0]!.claimedAt, null, "邮件要玩家自己去领")
  assert.equal(await coinsOf(userId), coinsBefore, "邮件本身不直接发金币")

  const left = (await rowsOf(userId)).filter((r) => r.questId.startsWith("daily-") && r.periodKey === "2026-11-24")
  assert.deepEqual(left.map((r) => r.questId).sort(), ["daily-dungeon", "daily-feed", "daily-open-pack"], "没完成的那行被清掉")
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
  await quests.claimQuest(userId, "daily-open-pack", t)

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
  assert.equal((await rowsOf(userId)).length, 0)
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
  const key = periodKey(defOf(questId).period, now())
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

await test("埋点：副本通关（体力不够不算）", async () => {
  const poor = await newUser({ stamina: 0 })
  const rich = await newUser()
  let res = await call(poor, "POST", `/users/${poor}/dungeons/coins/run`)
  assert.equal(res.status, 400)
  assert.equal(await progressNow(poor, "daily-dungeon"), 0)
  res = await call(rich, "POST", `/users/${rich}/dungeons/coins/run`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(await progressNow(rich, "daily-dungeon"), 1)
})

await test("埋点：市场买入和卖出（只挂单不算，成交才算双方各一笔）", async () => {
  const seller = await newUser()
  const buyer = await newUser({ coins: 1000 })
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
  res = await call(userId, "POST", `/users/${userId}/quests/daily-dungeon/claim`)
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
  assert.deepEqual(res.body.data.claimed, ["daily-sign-in"], "签到顺带完成了日常签到")
})

console.log(`\n${passed} quest tests passed`)
await cleanup()
process.exit(0)
