/**
 * 邮箱与流水的服务端测试：领取只能一次、并发领取、附件整体回滚、Pin 上限、
 * 30 天自动领取并写流水、被 Pin 的不删、删除限制。
 * 用临时 PGlite 数据库，不碰开发库。
 *
 *   pnpm test:mail
 */
import assert from "node:assert/strict"

import { setupTestDb } from "./test-db"

const dropTestDb = await setupTestDb("mail")

const { and, eq } = await import("drizzle-orm")
const { db } = await import("../src/db/client")
const schema = await import("../src/db/schema")
const { ITEMS } = await import("@choke/shared/items")
const { MAIL_PIN_LIMIT, MAIL_RETENTION_MS } = await import("@choke/shared/mail")
const mail = await import("../src/mail")
const { TxAbort } = await import("../src/tx")

const { users, cards, mails, ledgerEntries, userItems, userPacks, userCards } = schema

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
  await dropTestDb()
}

let seq = 0
async function newUser(patch: Partial<typeof users.$inferInsert> = {}) {
  seq += 1
  const id = `mail-test-${seq}`
  await db.insert(users).values({ id, username: id, staminaUpdatedAt: Date.now(), ...patch })
  return id
}

const coinsOf = async (userId: string) =>
  (await db.select({ v: users.coins }).from(users).where(eq(users.id, userId)))[0]!.v
const ledgerOf = (userId: string) => db.select().from(ledgerEntries).where(eq(ledgerEntries.userId, userId))
const rejectsWith = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error) => error instanceof TxAbort && error.code === code)

const itemId = Object.keys(ITEMS)[0] as keyof typeof ITEMS
await db.insert(cards).values({ id: "mail-test-card", name: "测试卡", rarity: "C", job: "warrior", no: 1, total: 1 })

console.log("mail tests")

await test("领取附件只能一次，并写一条流水", async () => {
  const userId = await newUser({ coins: 0 })
  const id = await mail.sendMail(userId, { title: "金币", attachment: { coins: 500 } })
  await mail.claimMail(userId, id)
  assert.equal(await coinsOf(userId), 500)
  await rejectsWith(mail.claimMail(userId, id), "already_claimed")
  assert.equal(await coinsOf(userId), 500)
  const ledger = await ledgerOf(userId)
  assert.equal(ledger.length, 1)
  assert.deepEqual(
    [ledger[0]!.kind, ledger[0]!.delta, ledger[0]!.source, ledger[0]!.sourceRef],
    ["coins", 500, "mail-claim", String(id)],
  )
})

await test("并发领取同一封邮件只成功一次", async () => {
  const userId = await newUser({ coins: 0 })
  const id = await mail.sendMail(userId, { title: "金币", attachment: { coins: 100 } })
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => mail.claimMail(userId, id)))
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1)
  assert.equal(await coinsOf(userId), 100)
  assert.equal((await ledgerOf(userId)).length, 1)
})

await test("没有附件的邮件不能领取；不能领别人的邮件", async () => {
  const userId = await newUser()
  const other = await newUser()
  const plain = await mail.sendMail(userId, { title: "通知", body: "纯文本" })
  await rejectsWith(mail.claimMail(userId, plain), "no_attachment")
  const withCoins = await mail.sendMail(userId, { title: "金币", attachment: { coins: 1 } })
  await rejectsWith(mail.claimMail(other, withCoins), "not_found")
})

await test("多种附件一起发：道具、卡包、卡牌、体力，流水逐项记录", async () => {
  const userId = await newUser({ stamina: 100 })
  const id = await mail.sendMail(userId, {
    title: "大礼包",
    attachment: {
      coins: 10,
      essence: 5,
      stamina: 50,
      items: [{ itemId, count: 3 }],
      packs: [{ pool: "normal", count: 2 }],
      cards: [{ cardId: "mail-test-card", count: 2 }],
    },
  })
  await mail.claimMail(userId, id)

  const [user] = await db.select().from(users).where(eq(users.id, userId))
  assert.equal(user!.coins, 110)
  assert.equal(user!.essence, 5)
  assert.ok(user!.stamina >= 150)
  const [item] = await db.select().from(userItems).where(and(eq(userItems.userId, userId), eq(userItems.itemId, itemId)))
  assert.equal(item!.count, 3)
  const [pack] = await db.select().from(userPacks).where(and(eq(userPacks.userId, userId), eq(userPacks.pool, "normal")))
  assert.equal(pack!.count, 2)
  const owned = await db.select().from(userCards).where(eq(userCards.userId, userId))
  assert.equal(owned.length, 2)

  const ledger = await ledgerOf(userId)
  const sum = (kind: string) => ledger.filter((e) => e.kind === kind).reduce((n, e) => n + e.delta, 0)
  assert.equal(sum("coins"), 10)
  assert.equal(sum("essence"), 5)
  assert.equal(sum("stamina"), 50)
  assert.equal(sum("item"), 3)
  assert.equal(sum("pack"), 2)
  assert.equal(sum("card"), 2)
  const cardEntries = ledger.filter((e) => e.kind === "card")
  assert.deepEqual(new Set(cardEntries.map((e) => e.userCardId)), new Set(owned.map((c) => c.id)))
})

await test("体力超过上限的部分作废，流水只记实际到账", async () => {
  const userId = await newUser({ stamina: 715 })
  const id = await mail.sendMail(userId, { title: "体力", attachment: { stamina: 50 } })
  await mail.claimMail(userId, id)
  const stamina = (await ledgerOf(userId)).filter((e) => e.kind === "stamina")
  assert.equal(stamina.length, 1)
  assert.ok(stamina[0]!.delta >= 5 && stamina[0]!.delta <= 5 + 1)
})

await test("附件里有不存在的卡包时整笔回滚，邮件仍可领取状态", async () => {
  const userId = await newUser({ coins: 0 })
  const id = await mail.sendMail(userId, { title: "坏包", attachment: { coins: 100, packs: [{ pool: "no-such-pack", count: 1 }] } })
  await rejectsWith(mail.claimMail(userId, id), "unknown_pack")
  assert.equal(await coinsOf(userId), 0)
  assert.equal((await ledgerOf(userId)).length, 0)
  const [row] = await db.select().from(mails).where(eq(mails.id, id))
  assert.equal(row!.claimedAt, null)
})

await test("一键领取", async () => {
  const userId = await newUser({ coins: 0 })
  await mail.sendMail(userId, { title: "a", attachment: { coins: 10 } })
  await mail.sendMail(userId, { title: "b", attachment: { coins: 20 } })
  await mail.sendMail(userId, { title: "c" })
  const { claimed } = await mail.claimAllMails(userId)
  assert.equal(claimed, 2)
  assert.equal(await coinsOf(userId), 30)
  assert.equal((await mail.claimAllMails(userId)).claimed, 0)
  const summary = await mail.mailSummary(userId)
  assert.equal(summary.claimable, 0)
  assert.equal(summary.unread, 1)
})

await test("Pin 上限 20，取消后可再 Pin", async () => {
  const userId = await newUser()
  const ids: number[] = []
  for (let i = 0; i < MAIL_PIN_LIMIT + 1; i += 1) ids.push(await mail.sendMail(userId, { title: `m${i}` }))
  for (const id of ids.slice(0, MAIL_PIN_LIMIT)) await mail.setPinned(userId, id, true)
  await rejectsWith(mail.setPinned(userId, ids[MAIL_PIN_LIMIT]!, true), "pin_limit")
  await mail.setPinned(userId, ids[0]!, false)
  await mail.setPinned(userId, ids[MAIL_PIN_LIMIT]!, true)
  const list = await mail.listMails(userId)
  assert.equal(list.summary.pinned, MAIL_PIN_LIMIT)
  assert.ok(list.mails.slice(0, MAIL_PIN_LIMIT).every((m) => m.pinned), "被 Pin 的排在最前")
})

await test("超过 30 天：未领附件自动领取并写流水，被 Pin 的不删", async () => {
  const userId = await newUser({ coins: 0 })
  const old = new Date(Date.now() - MAIL_RETENTION_MS - 60_000)
  const insert = async (title: string, extra: Partial<typeof mails.$inferInsert>) =>
    (await db.insert(mails).values({ userId, title, createdAt: old, ...extra }).returning({ id: mails.id }))[0]!.id
  const unclaimed = await insert("未领", { attachment: { coins: 300 } })
  const claimed = await insert("已领", { attachment: { coins: 999 }, claimedAt: new Date() })
  const plain = await insert("纯文本", {})
  const pinned = await insert("置顶", { attachment: { coins: 7 }, pinned: true })
  const fresh = await mail.sendMail(userId, { title: "新邮件", attachment: { coins: 1 } })

  const list = await mail.listMails(userId)
  const remaining = list.mails.map((m) => m.id).sort((a, b) => a - b)
  assert.deepEqual(remaining, [pinned, fresh].sort((a, b) => a - b))
  assert.equal(await coinsOf(userId), 300, "只自动领了未领的那封")
  const ledger = await ledgerOf(userId)
  assert.equal(ledger.length, 1)
  assert.deepEqual([ledger[0]!.source, ledger[0]!.sourceRef], ["mail-auto", String(unclaimed)])
  assert.ok(![claimed, plain].some((id) => remaining.includes(id)))
  assert.equal(list.mails.find((m) => m.id === pinned)!.expiresAt, null)
})

await test("删除限制：未领附件、被 Pin 的不能删", async () => {
  const userId = await newUser()
  const withAttachment = await mail.sendMail(userId, { title: "附件", attachment: { coins: 5 } })
  await rejectsWith(mail.deleteMail(userId, withAttachment), "unclaimed")
  await mail.claimMail(userId, withAttachment)

  await mail.setPinned(userId, withAttachment, true)
  await rejectsWith(mail.deleteMail(userId, withAttachment), "pinned")
  await mail.setPinned(userId, withAttachment, false)
  await mail.deleteMail(userId, withAttachment)

  const plain = await mail.sendMail(userId, { title: "通知" })
  await mail.deleteMail(userId, plain)
  assert.equal((await mail.listMails(userId)).mails.length, 0)
})

await test("已读标记和红点统计", async () => {
  const userId = await newUser()
  const id = await mail.sendMail(userId, { title: "x", attachment: { coins: 1 } })
  assert.deepEqual(await mail.mailSummary(userId), { unread: 1, claimable: 1, pinned: 0 })
  await mail.markRead(userId, id)
  assert.deepEqual(await mail.mailSummary(userId), { unread: 0, claimable: 1, pinned: 0 })
})

await test("附件格式校验：负数、未知物品、多余字段都被拒绝", async () => {
  const userId = await newUser()
  await assert.rejects(mail.sendMail(userId, { title: "x", attachment: { coins: -5 } }))
  await assert.rejects(mail.sendMail(userId, { title: "x", attachment: { items: [{ itemId: "nope" as never, count: 1 }] } }))
  await assert.rejects(mail.sendMail(userId, { title: "x", attachment: { gold: 1 } as never }))
})

await test("一键领取：坏邮件跳过并返回 failed，不阻塞其余好邮件", async () => {
  const userId = await newUser({ coins: 0 })
  await db.insert(mails).values({
    userId,
    title: "坏邮件",
    attachment: { cards: [{ cardId: "non-existent-card", count: 1 }] },
  })
  await mail.sendMail(userId, { title: "好邮件", attachment: { coins: 250 } })
  const res = await mail.claimAllMails(userId)
  assert.equal(res.claimed, 1)
  assert.equal(res.failed.length, 1)
  assert.equal(await coinsOf(userId), 250)
})

console.log(`\n${passed} mail tests passed`)
await cleanup()
process.exit(0)
