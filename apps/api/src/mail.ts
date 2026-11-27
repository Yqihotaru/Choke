import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm"

import { ITEMS } from "@choke/shared/items"
import {
  MAIL_BODY_MAX,
  MAIL_PIN_LIMIT,
  MAIL_RETENTION_MS,
  MAIL_TITLE_MAX,
  isAttachmentEmpty,
  mailAttachmentSchema,
  type MailAttachment,
  type MailAttachmentLine,
  type MailKind,
  type MailView,
} from "@choke/shared/mail"

import { db } from "./db/client"
import { cards, mails } from "./db/schema"
import { PACKS, MYSTERY_PACK } from "./gacha/packs"
import { grantAttachment } from "./rewards"
import { TxAbort, lockUser, type Tx } from "./tx"

type MailRow = typeof mails.$inferSelect

const LIST_LIMIT = 200
const CLAIM_ALL_LIMIT = 20
const CLEANUP_LIMIT = 100

export interface NewMail {
  kind?: MailKind
  title: string
  body?: string
  attachment?: MailAttachment | null
}

/** 发邮件。其他系统（出征到期、任务）都调这个；传入 tx 就和调用方的事务一起提交 */
export async function sendMail(userId: string, mail: NewMail, executor: Tx | typeof db = db) {
  const attachment = mail.attachment ? mailAttachmentSchema.parse(mail.attachment) : null
  const [row] = await executor
    .insert(mails)
    .values({
      userId,
      kind: mail.kind ?? "system",
      title: mail.title.slice(0, MAIL_TITLE_MAX),
      body: (mail.body ?? "").slice(0, MAIL_BODY_MAX),
      attachment: isAttachmentEmpty(attachment) ? null : attachment,
    })
    .returning({ id: mails.id })
  return row!.id
}

const cutoff = (now: number) => new Date(now - MAIL_RETENTION_MS)

const BULK_CHUNK = 500

/** 同一封邮件发给很多人：每人一封独立邮件，各自领取、各自置顶；必须在事务里调用 */
export async function sendMailBulk(tx: Tx, userIds: readonly string[], mail: NewMail, batchId: number) {
  const attachment = mail.attachment ? mailAttachmentSchema.parse(mail.attachment) : null
  const base = {
    kind: mail.kind ?? "system",
    title: mail.title.slice(0, MAIL_TITLE_MAX),
    body: (mail.body ?? "").slice(0, MAIL_BODY_MAX),
    attachment: isAttachmentEmpty(attachment) ? null : attachment,
    batchId,
  }
  for (let i = 0; i < userIds.length; i += BULK_CHUNK) {
    await tx.insert(mails).values(userIds.slice(i, i + BULK_CHUNK).map((userId) => ({ userId, ...base })))
  }
}

/** 数据库里存的附件按 schema 再过一遍；坏数据当作没有附件，不让一封坏信毁掉整个列表 */
function readAttachment(row: MailRow): MailAttachment | null {
  if (!row.attachment) return null
  const parsed = mailAttachmentSchema.safeParse(row.attachment)
  return parsed.success && !isAttachmentEmpty(parsed.data) ? parsed.data : null
}

/**
 * 清理过期邮件（读列表时顺便做，不用定时任务）：超过 30 天、没被 Pin 的邮件，
 * 附件没领的先自动领取（写流水），再删除。每封单独一个事务；发放失败的保留，下次再试。
 */
export async function cleanupMails(userId: string, now = Date.now()): Promise<number> {
  const expired = await db
    .select({ id: mails.id })
    .from(mails)
    .where(and(eq(mails.userId, userId), eq(mails.pinned, false), lt(mails.createdAt, cutoff(now))))
    .orderBy(asc(mails.id))
    .limit(CLEANUP_LIMIT)

  let removed = 0
  for (const { id } of expired) {
    try {
      await db.transaction(async (tx) => {
        await lockUser(tx, userId)
        const [row] = await tx.select().from(mails).where(and(eq(mails.id, id), eq(mails.userId, userId))).for("update")
        if (!row || row.pinned) return
        const attachment = readAttachment(row)
        if (attachment && !row.claimedAt) {
          await grantAttachment(tx, userId, attachment, { source: "mail-auto", sourceRef: String(id) })
        }
        await tx.delete(mails).where(eq(mails.id, id))
        removed += 1
      })
    } catch (error) {
      console.warn(`[mail] 自动领取 / 清理邮件 ${id} 失败，保留：`, error)
    }
  }
  return removed
}

async function describeAttachments(rows: MailRow[]): Promise<Map<number, MailAttachmentLine[]>> {
  const attachments = new Map<number, MailAttachment>()
  const cardIds = new Set<string>()
  for (const row of rows) {
    const attachment = readAttachment(row)
    if (!attachment) continue
    attachments.set(row.id, attachment)
    for (const card of attachment.cards ?? []) cardIds.add(card.cardId)
  }
  const names = new Map<string, string>()
  if (cardIds.size > 0) {
    const found = await db.select({ id: cards.id, name: cards.name }).from(cards).where(inArray(cards.id, [...cardIds]))
    for (const row of found) names.set(row.id, row.name)
  }

  const packName = (pool: string) =>
    pool === MYSTERY_PACK.id ? MYSTERY_PACK.name : ((PACKS as Record<string, { name: string }>)[pool]?.name ?? pool)

  const result = new Map<number, MailAttachmentLine[]>()
  for (const [id, attachment] of attachments) {
    const lines: MailAttachmentLine[] = []
    if (attachment.coins) lines.push({ kind: "coins", label: "金币", count: attachment.coins })
    if (attachment.essence) lines.push({ kind: "essence", label: "闪卡精华", count: attachment.essence })
    for (const { itemId, count: n } of attachment.items ?? []) {
      lines.push({ kind: "item", label: ITEMS[itemId].name, count: n })
    }
    for (const { pool, count: n } of attachment.packs ?? []) {
      lines.push({ kind: "pack", label: packName(pool), count: n })
    }
    for (const { cardId, count: n, foil } of attachment.cards ?? []) {
      lines.push({ kind: "card", label: names.get(cardId) ?? cardId, count: n, foil })
    }
    result.set(id, lines)
  }
  return result
}

function toView(row: MailRow, lines: MailAttachmentLine[]): MailView {
  const hasAttachment = lines.length > 0
  const claimed = hasAttachment && row.claimedAt !== null
  return {
    id: row.id,
    kind: row.kind as MailKind,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    read: row.readAt !== null,
    pinned: row.pinned,
    claimable: hasAttachment && !claimed,
    claimed,
    lines,
    expiresAt: row.pinned ? null : new Date(row.createdAt.getTime() + MAIL_RETENTION_MS).toISOString(),
  }
}

/** 邮件列表：Pin 的置顶，其余按时间倒序；读之前先清理过期邮件 */
export async function listMails(userId: string, now = Date.now()) {
  await cleanupMails(userId, now)
  const rows = await db
    .select()
    .from(mails)
    .where(eq(mails.userId, userId))
    .orderBy(desc(mails.pinned), desc(mails.createdAt), desc(mails.id))
    .limit(LIST_LIMIT)
  const lines = await describeAttachments(rows)
  const views = rows.map((row) => toView(row, lines.get(row.id) ?? []))
  return { mails: views, summary: summarize(views), pinLimit: MAIL_PIN_LIMIT }
}

function summarize(views: MailView[]) {
  return {
    unread: views.filter((mail) => !mail.read).length,
    claimable: views.filter((mail) => mail.claimable).length,
    pinned: views.filter((mail) => mail.pinned).length,
  }
}

/** 红点用的数字，不做清理也不查附件名；已过期但还没被清理的邮件不算 */
export async function mailSummary(userId: string, now = Date.now()) {
  const alive = and(
    eq(mails.userId, userId),
    or(eq(mails.pinned, true), gte(mails.createdAt, cutoff(now))),
  )
  const [row] = await db
    .select({
      unread: count(sql`CASE WHEN ${mails.readAt} IS NULL THEN 1 END`),
      claimable: count(sql`CASE WHEN ${mails.attachment} IS NOT NULL AND ${mails.claimedAt} IS NULL THEN 1 END`),
      pinned: count(sql`CASE WHEN ${mails.pinned} THEN 1 END`),
    })
    .from(mails)
    .where(alive)
  return {
    unread: Number(row?.unread ?? 0),
    claimable: Number(row?.claimable ?? 0),
    pinned: Number(row?.pinned ?? 0),
  }
}

async function loadOwned(tx: Tx, userId: string, mailId: number): Promise<MailRow> {
  const [row] = await tx
    .select()
    .from(mails)
    .where(and(eq(mails.id, mailId), eq(mails.userId, userId)))
    .for("update")
  if (!row) throw new TxAbort(404, "not_found", "没有这封邮件")
  return row
}

export async function markRead(userId: string, mailId: number) {
  await db.transaction(async (tx) => {
    await loadOwned(tx, userId, mailId)
    await tx
      .update(mails)
      .set({ readAt: sql`coalesce(${mails.readAt}, now())` })
      .where(eq(mails.id, mailId))
  })
}

/** 领取一封邮件的附件；事务里先加锁，同一封邮件不会被领两次 */
export async function claimMail(userId: string, mailId: number): Promise<MailAttachment> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId)
    const row = await loadOwned(tx, userId, mailId)
    const attachment = readAttachment(row)
    if (!attachment) throw new TxAbort(400, "no_attachment", "这封邮件没有附件")
    if (row.claimedAt) throw new TxAbort(400, "already_claimed", "附件已经领取过了")
    await grantAttachment(tx, userId, attachment, { source: "mail-claim", sourceRef: String(mailId) })
    await tx
      .update(mails)
      .set({ claimedAt: sql`now()`, readAt: sql`coalesce(${mails.readAt}, now())` })
      .where(eq(mails.id, mailId))
    return attachment
  })
}

/** 一键领取：单次最多 20 封，每封独立事务领取，坏邮件跳过不阻塞其余邮件 */
export async function claimAllMails(
  userId: string,
): Promise<{ claimed: number; failed: { id: number; reason: string }[] }> {
  const rows = await db
    .select({ id: mails.id })
    .from(mails)
    .where(and(eq(mails.userId, userId), isNull(mails.claimedAt), sql`${mails.attachment} IS NOT NULL`))
    .orderBy(asc(mails.id))
    .limit(CLAIM_ALL_LIMIT)

  let claimed = 0
  const failed: { id: number; reason: string }[] = []
  for (const { id } of rows) {
    try {
      await claimMail(userId, id)
      claimed += 1
    } catch (error) {
      failed.push({
        id,
        reason: error instanceof Error ? error.message : "领取失败",
      })
    }
  }
  return { claimed, failed }
}

export async function setPinned(userId: string, mailId: number, pinned: boolean) {
  await db.transaction(async (tx) => {
    await lockUser(tx, userId)
    const row = await loadOwned(tx, userId, mailId)
    if (row.pinned === pinned) return
    if (pinned) {
      const [{ value }] = await tx
        .select({ value: count() })
        .from(mails)
        .where(and(eq(mails.userId, userId), eq(mails.pinned, true)))
      if (Number(value) >= MAIL_PIN_LIMIT) {
        throw new TxAbort(400, "pin_limit", `最多只能置顶 ${MAIL_PIN_LIMIT} 封邮件`)
      }
    }
    await tx.update(mails).set({ pinned }).where(eq(mails.id, mailId))
  })
}

/** 删除：有未领附件的不能删，被置顶的要先取消置顶 */
export async function deleteMail(userId: string, mailId: number) {
  await db.transaction(async (tx) => {
    await lockUser(tx, userId)
    const row = await loadOwned(tx, userId, mailId)
    if (row.pinned) throw new TxAbort(400, "pinned", "请先取消置顶再删除")
    if (readAttachment(row) && !row.claimedAt) {
      throw new TxAbort(400, "unclaimed", "附件还没领取，领取后才能删除")
    }
    await tx.delete(mails).where(eq(mails.id, mailId))
  })
}

export { MAIL_BODY_MAX, MAIL_TITLE_MAX }
