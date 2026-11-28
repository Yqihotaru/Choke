import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { requireSelf } from "../auth/guard"
import { claimSupply, getSupply, setSupplyFocus } from "../supply"
import { guardAbort } from "../tx"

const paramsSchema = z.object({ userId: z.string() })
const focusBodySchema = z.object({ focus: z.string().min(1).max(64).nullable() })

export async function supplyRoutes(app: FastifyInstance) {
  /** 补给箱现状：每个箱子已攒多少、速率、倾向；没解锁的箱子带 lockedReason */
  app.get("/users/:userId/supply", async (request, reply) => {
    const userId = requireSelf(request, reply, paramsSchema.parse(request.params).userId)
    if (!userId) return
    const data = await guardAbort(reply, () => getSupply(userId, Date.now()))
    if (!data) return
    return { ok: true, data }
  })

  /** 一键领取所有已解锁的箱子 */
  app.post("/users/:userId/supply/claim", async (request, reply) => {
    const userId = requireSelf(request, reply, paramsSchema.parse(request.params).userId)
    if (!userId) return
    const data = await guardAbort(reply, () => claimSupply(userId, Date.now()))
    if (!data) return
    return { ok: true, data }
  })

  /** 选倾向；focus 传 null 是取消倾向 */
  app.post("/users/:userId/supply/focus", async (request, reply) => {
    const userId = requireSelf(request, reply, paramsSchema.parse(request.params).userId)
    if (!userId) return
    const body = focusBodySchema.parse(request.body)
    const data = await guardAbort(reply, () => setSupplyFocus(userId, body.focus, Date.now()))
    if (!data) return
    return { ok: true, data }
  })
}
