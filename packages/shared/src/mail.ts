import { z } from "zod"

import { isItemId, type ItemId } from "./items"

/** 邮件保留天数；被 Pin 的不删 */
export const MAIL_RETENTION_DAYS = 30
export const MAIL_RETENTION_MS = MAIL_RETENTION_DAYS * 24 * 60 * 60 * 1000
export const MAIL_PIN_LIMIT = 20
export const MAIL_TITLE_MAX = 60
export const MAIL_BODY_MAX = 2000
/** 单封邮件里卡牌附件的张数上限，防止一次事务塞太多 */
export const MAIL_CARDS_MAX = 50

export const MAIL_KINDS = ["system", "expedition", "reward"] as const
export type MailKind = (typeof MAIL_KINDS)[number]

const amount = z.int().min(1).max(1_000_000)

/**
 * 邮件附件：任何系统发奖励走邮箱时都用这个格式。
 * 数量都是正整数；体力会被限制在体力上限内（超出部分作废，流水记实际到账数）。
 */
export const mailAttachmentSchema = z
  .object({
    coins: amount.optional(),
    essence: amount.optional(),
    stamina: amount.optional(),
    items: z
      .array(
        z.object({
          itemId: z.custom<ItemId>((value) => typeof value === "string" && isItemId(value), "未知物品"),
          count: amount,
        }),
      )
      .max(20)
      .optional(),
    packs: z.array(z.object({ pool: z.string().min(1), count: amount })).max(20).optional(),
    cards: z
      .array(
        z.object({
          cardId: z.string().min(1),
          count: z.int().min(1).max(MAIL_CARDS_MAX).default(1),
          foil: z.boolean().optional(),
        }),
      )
      .max(MAIL_CARDS_MAX)
      .optional(),
  })
  .strict()

export type MailAttachment = z.infer<typeof mailAttachmentSchema>

export function isAttachmentEmpty(attachment: MailAttachment | null | undefined): boolean {
  if (!attachment) return true
  return !(
    attachment.coins ||
    attachment.essence ||
    attachment.stamina ||
    attachment.items?.length ||
    attachment.packs?.length ||
    attachment.cards?.length
  )
}

/** 列表里给界面看的附件行：服务端把名字都解析好，前端只管显示 */
export interface MailAttachmentLine {
  kind: "coins" | "essence" | "stamina" | "item" | "pack" | "card"
  label: string
  count: number
  foil?: boolean
}

export interface MailView {
  id: number
  kind: MailKind
  title: string
  body: string
  createdAt: string
  read: boolean
  pinned: boolean
  /** 有附件且还没领 */
  claimable: boolean
  claimed: boolean
  lines: MailAttachmentLine[]
  /** 到期时间；被 Pin 的为 null */
  expiresAt: string | null
}
