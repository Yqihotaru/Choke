import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { requireSelf } from "../auth/guard"
import { checkOsuDaily, getOsuDaily } from "../osu-daily"
import { claimAllQuests, claimQuest, getQuests, signIn } from "../quests"
import { guardAbort } from "../tx"
import { requireFeature } from "../unlocks"

const paramsSchema = z.object({ userId: z.string() })
const questParamsSchema = z.object({ userId: z.string(), questId: z.string().min(1).max(64) })

export async function questRoutes(app: FastifyInstance) {
  app.get("/users/:userId/quests", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    if (!(await requireFeature(reply, userId, "quests"))) return
    return { ok: true, data: await getQuests(userId) }
  })

  app.post("/users/:userId/quests/claim-all", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    if (!(await requireFeature(reply, userId, "quests"))) return
    const result = await guardAbort(reply, () => claimAllQuests(userId))
    if (!result) return
    return { ok: true, data: result }
  })

  app.post("/users/:userId/quests/:questId/claim", async (request, reply) => {
    const params = questParamsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    if (!(await requireFeature(reply, userId, "quests"))) return
    const result = await guardAbort(reply, () => claimQuest(userId, params.questId))
    if (!result) return
    return { ok: true, data: result }
  })

  app.get("/users/:userId/osu-daily", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    if (!(await requireFeature(reply, userId, "quests"))) return
    return { ok: true, data: await getOsuDaily(userId) }
  })

  app.post("/users/:userId/osu-daily/check", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    if (!(await requireFeature(reply, userId, "quests"))) return
    const result = await guardAbort(reply, () => checkOsuDaily(userId))
    if (!result) return
    return { ok: true, data: result }
  })

  app.post("/users/:userId/sign-in", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    if (!(await requireFeature(reply, userId, "quests"))) return
    const result = await guardAbort(reply, () => signIn(userId))
    if (!result) return
    return { ok: true, data: result }
  })
}
