import { and, eq, lte } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { TUTORIAL_STEPS } from "../../../../src/tutorial/types"
import { requireSelf } from "../auth/guard"
import { db } from "../db/client"
import { users } from "../db/schema"

const paramsSchema = z.object({ userId: z.string() })

const progressSchema = z.object({
  level: z.number().int().min(1).max(60),
  exp: z.number().int().min(0),
  tutorialStep: z.enum(TUTORIAL_STEPS),
  tutorialDone: z.boolean(),
  updatedAt: z.number().int().min(0),
})

function payload(row: {
  playerLevel: number
  playerExp: number
  tutorialStep: string
  tutorialDone: boolean
  progressUpdatedAt: number
}) {
  return {
    level: row.playerLevel,
    exp: row.playerExp,
    tutorialStep: row.tutorialStep,
    tutorialDone: row.tutorialDone,
    updatedAt: row.progressUpdatedAt,
  }
}

export async function progressRoutes(app: FastifyInstance) {
  app.get("/users/:userId/progress", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return

    const [row] = await db
      .select({
        playerLevel: users.playerLevel,
        playerExp: users.playerExp,
        tutorialStep: users.tutorialStep,
        tutorialDone: users.tutorialDone,
        progressUpdatedAt: users.progressUpdatedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (!row) {
      return reply.code(401).send({
        ok: false,
        error: { code: "unauthorized", message: "用户不存在" },
      })
    }

    return { ok: true, data: payload(row) }
  })

  app.put("/users/:userId/progress", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return

    const body = progressSchema.parse(request.body)

    // 只接受比当前更新的进度，避免旧标签页把新进度写回去
    await db
      .update(users)
      .set({
        playerLevel: body.level,
        playerExp: body.exp,
        tutorialStep: body.tutorialStep,
        tutorialDone: body.tutorialDone,
        progressUpdatedAt: body.updatedAt,
      })
      .where(
        and(
          eq(users.id, userId),
          lte(users.progressUpdatedAt, body.updatedAt),
        ),
      )

    const [row] = await db
      .select({
        playerLevel: users.playerLevel,
        playerExp: users.playerExp,
        tutorialStep: users.tutorialStep,
        tutorialDone: users.tutorialDone,
        progressUpdatedAt: users.progressUpdatedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    return { ok: true, data: row ? payload(row) : null }
  })
}
