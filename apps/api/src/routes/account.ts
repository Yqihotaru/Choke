import { z } from "zod"
import type { FastifyInstance } from "fastify"

import {
  bindEmail,
  cancelPendingBind,
  describePendingBind,
  resolveBind,
} from "../account-binding"
import { hashPassword, isEmail, normalizeEmail } from "../auth/email"
import { WEB_BASE } from "../auth/env"
import { readSessionUser, requireSession, setSessionCookie } from "../auth/guard"
import { authorizeUrl, createState } from "../auth/osu"
import { rateLimit } from "../auth/rate-limit"
import { guardAbort } from "../tx"

/**
 * 账号绑定：游客号 / 邮箱号绑定 osu!，osu! 号反向补绑邮箱。
 * 绑定 osu! 是 OAuth 往返：这里发起，回调在 auth.ts（回调地址只有一个）。
 */
export async function accountRoutes(app: FastifyInstance) {
  const resolveLimit = rateLimit({ max: 20, windowMs: 60_000 })
  const emailBindLimit = rateLimit({ max: 10, windowMs: 10 * 60_000 })

  /** 已登录账号发起绑定 osu!；和登录不同，回调会把这个账号记在 state 里 */
  app.get("/auth/osu/bind", async (request, reply) => {
    const userId = readSessionUser(request)
    if (!userId) return reply.redirect(`${WEB_BASE}/?bind=error&reason=unauthorized`)
    return reply.redirect(authorizeUrl(createState({ bindUserId: userId })))
  })

  /** 有没有待确认的绑定；有就带上两边账号的对比，给玩家二选一 */
  app.get("/auth/bind/pending", async (request, reply) => {
    const userId = requireSession(request, reply)
    if (!userId) return
    return { ok: true, data: { pending: await describePendingBind(userId) } }
  })

  const resolveSchema = z.object({
    choice: z.enum(["keep-current", "keep-osu"]),
    /** 二次确认：界面必须弹确认框，点了才带 true */
    confirm: z.literal(true),
  })

  app.post("/auth/bind/resolve", { preHandler: resolveLimit }, async (request, reply) => {
    const userId = requireSession(request, reply)
    if (!userId) return
    const body = resolveSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "invalid_input", message: "请选择保留哪个账号，并确认" },
      })
    }
    const result = await guardAbort(reply, () => resolveBind(userId, body.data.choice))
    if (!result) return
    // 登录态换成留下来的那个账号
    setSessionCookie(reply, result.userId)
    return { ok: true, data: result }
  })

  app.post("/auth/bind/cancel", async (request, reply) => {
    const userId = requireSession(request, reply)
    if (!userId) return
    cancelPendingBind(userId)
    return { ok: true, data: null }
  })

  const emailBindSchema = z.object({
    email: z.string(),
    password: z.string().min(8).max(200),
  })

  /** 反向绑定：没有邮箱的账号（游客或 osu! 号）补邮箱和密码，之后可以用邮箱登录同一个账号 */
  app.post("/auth/email/bind", { preHandler: emailBindLimit }, async (request, reply) => {
    const userId = requireSession(request, reply)
    if (!userId) return
    const body = emailBindSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "invalid_input", message: "邮箱或密码格式不正确（密码至少 8 位）" },
      })
    }
    const email = normalizeEmail(body.data.email)
    if (!isEmail(email)) {
      return reply.code(400).send({
        ok: false,
        error: { code: "invalid_email", message: "邮箱格式不正确" },
      })
    }
    const done = await guardAbort(reply, async () => {
      await bindEmail(userId, email, hashPassword(body.data.password))
      return true
    })
    if (!done) return
    return { ok: true, data: { email } }
  })
}
