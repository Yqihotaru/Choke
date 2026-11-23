import { asc, eq, or, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { mailAudienceSchema } from "@choke/shared/mail"

import { broadcastMail, listBatches, previewAudience } from "../admin-mail"
import { requireAdmin } from "../auth/admin"
import { db } from "../db/client"
import { users } from "../db/schema"
import { guardAbort } from "../tx"

const searchSchema = z.object({ q: z.string().trim().min(1).max(60) })
const previewSchema = z.object({ audience: mailAudienceSchema })

/** LIKE 里的 % _ \ 要转义，否则搜 "_" 会命中所有人 */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`

/**
 * 管理员后台接口：每个接口都先过 requireAdmin（每次查库，撤销管理员立刻生效）。
 * 现在只有发邮件；以后加别的后台功能也挂在 /admin 下面。
 */
export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin/users", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return
    const { q } = searchSchema.parse(request.query)
    const asNumber = /^\d+$/.test(q) ? Number(q) : null
    const rows = await db
      .select({ id: users.id, username: users.username, publicId: users.publicId, level: users.playerLevel })
      .from(users)
      .where(
        or(
          eq(users.id, q),
          sql`${users.username} ILIKE ${likePattern(q)}`,
          asNumber !== null && asNumber < 2_000_000_000 ? eq(users.publicId, asNumber) : undefined,
        ),
      )
      .orderBy(asc(users.username))
      .limit(20)
    return { ok: true, data: { users: rows } }
  })

  app.post("/admin/mails/preview", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return
    const { audience } = previewSchema.parse(request.body)
    const result = await guardAbort(reply, () => previewAudience(audience))
    if (!result) return
    return { ok: true, data: result }
  })

  app.post("/admin/mails", async (request, reply) => {
    const adminId = await requireAdmin(request, reply)
    if (!adminId) return
    const result = await guardAbort(reply, () => broadcastMail(adminId, request.body))
    if (!result) return
    request.log.info({ adminId, ...result }, "admin mail sent")
    return { ok: true, data: result }
  })

  app.get("/admin/mail-batches", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return
    const batches = await listBatches()
    return {
      ok: true,
      data: {
        batches: batches.map((batch) => ({ ...batch, createdAt: batch.createdAt.toISOString() })),
      },
    }
  })
}
