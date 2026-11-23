import type { FastifyReply, FastifyRequest } from "fastify"

import { isAdmin } from "../admin-mail"
import { requireSession } from "./guard"

/** 要求已登录且是管理员：未登录 401，不是管理员 403；失败时返回 null。每次请求都查库，撤销管理员立刻生效 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const userId = requireSession(request, reply)
  if (!userId) return null
  if (!(await isAdmin(userId))) {
    reply.code(403).send({ ok: false, error: { code: "forbidden", message: "需要管理员权限" } })
    return null
  }
  return userId
}
