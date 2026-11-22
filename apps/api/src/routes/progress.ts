import { and, eq, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import {
  TUTORIAL_GRADUATE_LEVEL,
  TUTORIAL_STEP_EXP,
  addPlayerExp,
  nextTutorialStep,
} from "@choke/shared/player"
import { TUTORIAL_STEPS, type TutorialStep } from "@choke/shared/tutorial"

import { requireSelf } from "../auth/guard"
import { db } from "../db/client"
import { users } from "../db/schema"

const paramsSchema = z.object({ userId: z.string() })
const advanceSchema = z.object({ from: z.enum(TUTORIAL_STEPS) })

const progressColumns = {
  playerLevel: users.playerLevel,
  playerExp: users.playerExp,
  tutorialStep: users.tutorialStep,
  tutorialDone: users.tutorialDone,
  progressUpdatedAt: users.progressUpdatedAt,
}

type ProgressRow = {
  playerLevel: number
  playerExp: number
  tutorialStep: string
  tutorialDone: boolean
  progressUpdatedAt: number
}

function payload(row: ProgressRow) {
  return {
    level: row.playerLevel,
    exp: row.playerExp,
    tutorialStep: row.tutorialStep,
    tutorialDone: row.tutorialDone,
    updatedAt: row.progressUpdatedAt,
  }
}

async function loadProgress(userId: string) {
  const [row] = await db
    .select(progressColumns)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return row ?? null
}

/**
 * 玩家等级 / 经验 / 教程进度只由服务端结算，客户端只能请求「推进一步」或「跳过」：
 * - 推进：当前步骤必须等于 from，下一步由服务端决定，离开该步的经验由服务端发；
 *   教程只能往前走，所以每一步的经验只能领一次。
 * - 跳过 / 毕业最多补到 Lv.3，和走完教程一样，所以不需要额外前置条件。
 * 其他经验来源（副本体力等）在各自的路由里结算。
 */
export async function progressRoutes(app: FastifyInstance) {
  app.get("/users/:userId/progress", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return

    const row = await loadProgress(userId)
    if (!row) {
      return reply.code(401).send({
        ok: false,
        error: { code: "unauthorized", message: "用户不存在" },
      })
    }
    return { ok: true, data: payload(row) }
  })

  app.post("/users/:userId/tutorial/advance", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const { from } = advanceSchema.parse(request.body)

    const row = await loadProgress(userId)
    if (!row) {
      return reply.code(401).send({
        ok: false,
        error: { code: "unauthorized", message: "用户不存在" },
      })
    }

    const to = nextTutorialStep(from)
    if (row.tutorialStep !== from || !to) {
      return reply.code(409).send({
        ok: false,
        error: { code: "step_mismatch", message: "教程进度已经变化", progress: payload(row) },
      })
    }
    const gained = row.tutorialDone ? 0 : (TUTORIAL_STEP_EXP[from] ?? 0)
    let next = addPlayerExp({ level: row.playerLevel, exp: row.playerExp }, gained)
    if (to === "done" && next.level < TUTORIAL_GRADUATE_LEVEL) {
      next = { level: TUTORIAL_GRADUATE_LEVEL, exp: 0 }
    }

    // 以 from + 读到的等级经验为条件写入：并发的两次「推进同一步」只有一次生效，
    // 也不会覆盖同时到账的副本经验（冲突时返回 409，客户端按最新进度重试）
    const [updated] = await db
      .update(users)
      .set({
        playerLevel: next.level,
        playerExp: next.exp,
        tutorialStep: to,
        tutorialDone: row.tutorialDone || to === "done",
        progressUpdatedAt: Date.now(),
      })
      .where(
        and(
          eq(users.id, userId),
          eq(users.tutorialStep, from),
          eq(users.playerLevel, row.playerLevel),
          eq(users.playerExp, row.playerExp),
        ),
      )
      .returning(progressColumns)
    if (!updated) {
      const fresh = await loadProgress(userId)
      return reply.code(409).send({
        ok: false,
        error: {
          code: "step_mismatch",
          message: "教程进度已经变化",
          progress: fresh ? payload(fresh) : null,
        },
      })
    }

    return { ok: true, data: { ...payload(updated), gained } }
  })

  app.post("/users/:userId/tutorial/skip", async (request, reply) => {
    const params = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return

    const row = await loadProgress(userId)
    if (!row) {
      return reply.code(401).send({
        ok: false,
        error: { code: "unauthorized", message: "用户不存在" },
      })
    }
    if (row.tutorialDone) return { ok: true, data: payload(row) }

    // 在 SQL 里比较：不覆盖同时到账的副本经验
    const [updated] = await db
      .update(users)
      .set({
        playerLevel: sql`GREATEST(${users.playerLevel}, ${TUTORIAL_GRADUATE_LEVEL})`,
        playerExp: sql`CASE WHEN ${users.playerLevel} >= ${TUTORIAL_GRADUATE_LEVEL} THEN ${users.playerExp} ELSE 0 END`,
        tutorialStep: "done" satisfies TutorialStep,
        tutorialDone: true,
        progressUpdatedAt: Date.now(),
      })
      .where(eq(users.id, userId))
      .returning(progressColumns)

    return { ok: true, data: payload(updated ?? row) }
  })
}
