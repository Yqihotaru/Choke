import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { LEDGER_KINDS, LEDGER_PAGE_SIZE } from "@choke/shared/ledger"

import { requireSelf } from "../auth/guard"
import { listLedger } from "../ledger"

const paramsSchema = z.object({ userId: z.string() })
const querySchema = z.object({
  kind: z.enum(LEDGER_KINDS).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(LEDGER_PAGE_SIZE),
})

export async function ledgerRoutes(app: FastifyInstance) {
  app.get("/users/:userId/ledger", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const query = querySchema.parse(request.query)
    return { ok: true, data: await listLedger(userId, query) }
  })
}
