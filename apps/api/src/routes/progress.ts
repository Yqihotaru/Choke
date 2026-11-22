import { and, eq, lte } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { MARKET_UNLOCK_LEVEL, TUTORIAL_STEPS } from "../shared/tutorial"
import { requireSelf } from "../auth/guard"
import { db } from "../db/client"
import { users } from "../db/schema"

const paramsSchema = z.object({ userId: z.string() })

const MAX_LEVEL = 60
/** 教程 / 跳过教程能直接给到的等级；超出部分按账号年龄（服务端时间）限速放行。 */
const BASE_LEVEL = MARKET_UNLOCK_LEVEL
const LEVEL_INTERVAL_MS = 5 * 60_000

const progressSchema = z.object({
  level: z.number().int().min(1).max(MAX_LEVEL),
  exp: z.number().int().min(0).max(1_000_000_000),
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

/**
 * 注意：玩家等级 / 教程完成状态目前由客户端上传，服务端只做不依赖客户端的限制：
 * - updatedAt 钳到服务端当前时间，防止未来时间戳把进度永久锁死；
 * - 未完成新手引导（onboarded）的账号不接受升级和教程毕业；
 * - 等级上限 = max(已记录等级, BASE_LEVEL + 账号年龄 / 5 分钟)，一次请求伪造不出高等级。
 * 超出的部分会被静默钳掉（返回的是实际保存的值）。这仍然是 UX 门槛而不是反作弊：
 * 「跳过教程」本身就能直接给到 BASE_LEVEL。真正需要防刷时，应把经验来源改成服务端事件结算。
 */
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

    const [current] = await db
      .select({
        playerLevel: users.playerLevel,
        tutorialStep: users.tutorialStep,
        tutorialDone: users.tutorialDone,
        onboarded: users.onboarded,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!current) {
      return reply.code(401).send({
        ok: false,
        error: { code: "unauthorized", message: "用户不存在" },
      })
    }

    const now = Date.now()
    const ageMs = Math.max(0, now - current.createdAt.getTime())
    const ceiling = current.onboarded
      ? Math.max(
          current.playerLevel,
          Math.min(MAX_LEVEL, BASE_LEVEL + Math.floor(ageMs / LEVEL_INTERVAL_MS)),
        )
      : current.playerLevel
    const levelClamped = body.level > ceiling
    const tutorialDone = body.tutorialDone && (current.onboarded || current.tutorialDone)
    const tutorialStep =
      body.tutorialStep === "done" && !tutorialDone ? current.tutorialStep : body.tutorialStep
    // 客户端时间只用来判断新旧，不能晚于服务端当前时间
    const updatedAt = Math.min(body.updatedAt, now)

    // 只接受比当前更新的进度，避免旧标签页把新进度写回去
    await db
      .update(users)
      .set({
        playerLevel: levelClamped ? ceiling : body.level,
        playerExp: levelClamped ? 0 : body.exp,
        tutorialStep,
        tutorialDone,
        progressUpdatedAt: updatedAt,
      })
      .where(
        and(
          eq(users.id, userId),
          lte(users.progressUpdatedAt, updatedAt),
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
