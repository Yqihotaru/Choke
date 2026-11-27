import type { FastifyInstance } from "fastify"

import { requireSession } from "../auth/guard"
import { recordBeat } from "../presence"

export async function presenceRoutes(app: FastifyInstance) {
  /**
   * 心跳：前端上线时先发一次，之后每 20–40 秒一次。
   * 用登录 cookie 认人，不在路径里带 userId；未登录回 401，前端会放慢重试。
   */
  app.post("/presence/beat", async (request, reply) => {
    const userId = requireSession(request, reply)
    if (!userId) return
    if (!(await recordBeat(userId))) {
      return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "用户不存在" } })
    }
    return { ok: true, data: {} }
  })
}
