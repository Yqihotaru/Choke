import { desc, eq, gte, inArray } from "drizzle-orm"

import {
  adminAttachmentProblem,
  adminMailSchema,
  isAttachmentEmpty,
  mailAttachmentSchema,
  type AdminMailInput,
  type MailAudience,
} from "@choke/shared/mail"

import { db } from "./db/client"
import { adminMailBatches, users } from "./db/schema"
import { sendMailBulk } from "./mail"
import { TxAbort, type Tx } from "./tx"

export async function isAdmin(userId: string): Promise<boolean> {
  const [row] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId)).limit(1)
  return row?.isAdmin === true
}

/** 收件人名单。指定玩家里有不存在的 id 时整笔拒绝，不会只发一部分 */
export async function resolveAudience(audience: MailAudience, executor: Tx | typeof db = db): Promise<string[]> {
  if (audience.type === "users") {
    const wanted = [...new Set(audience.userIds)]
    const found = await executor.select({ id: users.id }).from(users).where(inArray(users.id, wanted))
    const foundIds = new Set(found.map((row) => row.id))
    const missing = wanted.filter((id) => !foundIds.has(id))
    if (missing.length > 0) {
      throw new TxAbort(400, "unknown_users", `找不到这些玩家：${missing.slice(0, 5).join("、")}`, { missing })
    }
    return wanted
  }
  const rows =
    audience.type === "all"
      ? await executor.select({ id: users.id }).from(users)
      : await executor.select({ id: users.id }).from(users).where(gte(users.playerLevel, audience.minLevel))
  return rows.map((row) => row.id)
}

/** 预览：只告诉管理员会发给多少人、前几个是谁，不写任何东西 */
export async function previewAudience(audience: MailAudience) {
  const ids = await resolveAudience(audience)
  const sample =
    ids.length === 0
      ? []
      : await db
          .select({ id: users.id, username: users.username })
          .from(users)
          .where(inArray(users.id, ids.slice(0, 5)))
  return { recipients: ids.length, sample }
}

/**
 * 群发邮件：校验附件上限 → 在一个事务里确定名单、写批次记录、给每人发一封。
 * 全体 / 按等级发送必须带上预览时的人数（confirmCount），对不上就拒绝。
 */
export async function broadcastMail(adminId: string, rawInput: unknown) {
  const input: AdminMailInput = adminMailSchema.parse(rawInput)
  const attachment = input.attachment ? mailAttachmentSchema.parse(input.attachment) : null
  const problem = adminAttachmentProblem(attachment)
  if (problem) throw new TxAbort(400, "attachment_too_big", `附件超过单封上限：${problem}`)

  return db.transaction(async (tx) => {
    const recipients = await resolveAudience(input.audience, tx)
    if (recipients.length === 0) throw new TxAbort(400, "no_recipients", "没有符合条件的收件人")
    if (input.audience.type !== "users" && input.confirmCount !== recipients.length) {
      throw new TxAbort(409, "confirm_mismatch", `收件人数已变化：现在是 ${recipients.length} 人，请重新预览确认`, {
        recipients: recipients.length,
      })
    }
    const [batch] = await tx
      .insert(adminMailBatches)
      .values({
        adminId,
        audience: input.audience,
        recipientCount: recipients.length,
        kind: input.kind,
        title: input.title,
        body: input.body,
        attachment: isAttachmentEmpty(attachment) ? null : attachment,
      })
      .returning({ id: adminMailBatches.id })
    await sendMailBulk(
      tx,
      recipients,
      { kind: input.kind, title: input.title, body: input.body, attachment },
      batch!.id,
    )
    return { batchId: batch!.id, recipients: recipients.length }
  })
}

export async function listBatches(limit = 50) {
  return db.select().from(adminMailBatches).orderBy(desc(adminMailBatches.id)).limit(limit)
}
