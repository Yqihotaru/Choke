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

/** 后台发信时的单封附件上限：防止多打一个 0 */
export const ADMIN_ATTACHMENT_LIMITS = {
  coins: 100_000,
  essence: 10_000,
  stamina: 360,
  itemCount: 1_000,
  packCount: 50,
  cards: 20,
} as const

/** 超限返回提示文字，没问题返回 null */
export function adminAttachmentProblem(attachment: MailAttachment | null | undefined): string | null {
  if (!attachment) return null
  const limits = ADMIN_ATTACHMENT_LIMITS
  if ((attachment.coins ?? 0) > limits.coins) return `金币最多 ${limits.coins}`
  if ((attachment.essence ?? 0) > limits.essence) return `闪卡精华最多 ${limits.essence}`
  if ((attachment.stamina ?? 0) > limits.stamina) return `体力最多 ${limits.stamina}`
  if (attachment.items?.some((item) => item.count > limits.itemCount)) return `单种道具最多 ${limits.itemCount}`
  if (attachment.packs?.some((pack) => pack.count > limits.packCount)) return `单种卡包最多 ${limits.packCount}`
  const cardTotal = attachment.cards?.reduce((sum, card) => sum + card.count, 0) ?? 0
  if (cardTotal > limits.cards) return `卡牌最多 ${limits.cards} 张`
  return null
}

/** 收件人：指定玩家 / 全体 / 等级不低于某值 */
export const mailAudienceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("users"), userIds: z.array(z.string().min(1)).min(1).max(200) }),
  z.object({ type: z.literal("all") }),
  z.object({ type: z.literal("level"), minLevel: z.int().min(1).max(1000) }),
])

export type MailAudience = z.infer<typeof mailAudienceSchema>

export const adminMailSchema = z.object({
  audience: mailAudienceSchema,
  kind: z.enum(MAIL_KINDS).default("system"),
  title: z.string().trim().min(1).max(MAIL_TITLE_MAX),
  body: z.string().max(MAIL_BODY_MAX).default(""),
  attachment: mailAttachmentSchema.nullish(),
  /** 全体 / 按等级发送必须带上预览时看到的人数，对不上就拒绝（防止确认之后人数变了） */
  confirmCount: z.int().min(0).optional(),
})

export type AdminMailInput = z.infer<typeof adminMailSchema>