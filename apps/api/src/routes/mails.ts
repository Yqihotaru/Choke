import type { FastifyInstance } from "fastify"
import { z } from "zod"

import {
  MAIL_BODY_MAX,
  MAIL_KINDS,
  MAIL_TITLE_MAX,
  mailAttachmentSchema,
} from "@choke/shared/mail"

import { requireSelf, requireSession } from "../auth/guard"
import { claimAllMails, claimMail, deleteMail, listMails, mailSummary, markRead, sendMail, setPinned } from "../mail"
import { guardAbort } from "../tx"

const paramsSchema = z.object({ userId: z.string() })
const mailParamsSchema = z.object({ userId: z.string(), mailId: z.coerce.number().int().positive() })
const pinBodySchema = z.object({ pinned: z.boolean() })
const devMailSchema = z.object({
  kind: z.enum(MAIL_KINDS).optional(),
  title: z.string().min(1).max(MAIL_TITLE_MAX),
  body: z.string().max(MAIL_BODY_MAX).optional(),
  attachment: mailAttachmentSchema.nullish(),
})

export async function mailRoutes(app: FastifyInstance) {
  app.get("/users/:userId/mails", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    return { ok: true, data: await listMails(userId) }
  })

  app.get("/users/:userId/mails/summary", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    return { ok: true, data: await mailSummary(userId) }
  })

  app.post("/users/:userId/mails/claim-all", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const result = await guardAbort(reply, () => claimAllMails(userId))
    if (!result) return
    return { ok: true, data: result }
  })

  app.post("/users/:userId/mails/:mailId/read", async (request, reply) => {
    const params = mailParamsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const done = await guardAbort(reply, async () => {
      await markRead(userId, params.mailId)
      return true
    })
    if (!done) return
    return { ok: true, data: {} }
  })

  app.post("/users/:userId/mails/:mailId/claim", async (request, reply) => {
    const params = mailParamsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const attachment = await guardAbort(reply, () => claimMail(userId, params.mailId))
    if (!attachment) return
    return { ok: true, data: { attachment } }
  })

  app.post("/users/:userId/mails/:mailId/pin", async (request, reply) => {
    const params = mailParamsSchema.parse(request.params)
    const body = pinBodySchema.parse(request.body)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const done = await guardAbort(reply, async () => {
      await setPinned(userId, params.mailId, body.pinned)
      return true
    })
    if (!done) return
    return { ok: true, data: { pinned: body.pinned } }
  })

  app.delete("/users/:userId/mails/:mailId", async (request, reply) => {
    const params = mailParamsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const done = await guardAbort(reply, async () => {
      await deleteMail(userId, params.mailId)
      return true
    })
    if (!done) return
    return { ok: true, data: {} }
  })

  // 开发用：给自己发一封邮件，方便调界面；需显式开启 ENABLE_DEV_ROUTES=1，默认关闭
  if (process.env.ENABLE_DEV_ROUTES === "1") {
    app.post("/dev/mails", async (request, reply) => {
      const userId = requireSession(request, reply)
      if (!userId) return
      const body = devMailSchema.parse(request.body)
      const id = await sendMail(userId, body)
      return { ok: true, data: { id } }
    })
  }
}
