import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { MAX_ACTIONS_PER_UPLOAD, battleActionSchema } from "@choke/shared/battle/actions"

import { requireSelf } from "../auth/guard"
import {
  abandonExpedition,
  appendActions,
  chooseLineup,
  getCurrentExpedition,
  listMaps,
  moveTo,
  playStory,
  resumeExpedition,
  retryBattle,
  settleExpedition,
  startExpedition,
  suspendExpedition,
} from "../expedition/service"
import { guardAbort } from "../tx"

const paramsSchema = z.object({ userId: z.string() })

const startSchema = z.object({
  mapId: z.string().min(1).max(80),
  cardIds: z.array(z.int().positive()).min(1).max(60),
  allocation: z.object({
    slots: z.int(),
    apUpgrade: z.boolean(),
    maxRarity: z.string(),
  }),
})
const moveSchema = z.object({ to: z.string().min(1).max(80) })
const storySchema = z.object({ choices: z.array(z.int().min(0).max(10)).max(20) })
const lineupSchema = z.object({ lineup: z.array(z.int().positive()).min(1).max(20) })
const actionsSchema = z.object({
  /** 客户端以为服务器已经有几条操作；对不上就拒绝，防止重复提交 */
  base: z.int().min(0),
  actions: z.array(battleActionSchema).min(1).max(MAX_ACTIONS_PER_UPLOAD),
})

/**
 * 出征接口：所有规则都在服务端判定，前端只提交「我想做什么」。
 * 一个玩家同一时间只有一个未结束的出征，所以大部分路径都是 /expeditions/current/…
 */
export async function expeditionRoutes(app: FastifyInstance) {
  const base = "/users/:userId/expeditions"

  /** 取出登录用户；不是本人返回 null（已经回复了错误） */
  const self = (request: Parameters<typeof requireSelf>[0], reply: Parameters<typeof requireSelf>[1]) =>
    requireSelf(request, reply, paramsSchema.parse(request.params).userId)

  app.get(`${base}/maps`, async (request, reply) => {
    const userId = self(request, reply)
    if (!userId) return
    return { ok: true, data: await listMaps(userId) }
  })

  app.get(`${base}/current`, async (request, reply) => {
    const userId = self(request, reply)
    if (!userId) return
    return { ok: true, data: await getCurrentExpedition(userId) }
  })

  app.post(base, async (request, reply) => {
    const userId = self(request, reply)
    if (!userId) return
    const body = startSchema.parse(request.body)
    const view = await guardAbort(reply, () =>
      startExpedition(userId, {
        mapId: body.mapId,
        cardIds: body.cardIds,
        allocation: body.allocation as Parameters<typeof startExpedition>[1]["allocation"],
      }),
    )
    if (!view) return
    return { ok: true, data: view }
  })

  app.post(`${base}/current/node`, async (request, reply) => {
    const userId = self(request, reply)
    if (!userId) return
    const body = moveSchema.parse(request.body)
    const view = await guardAbort(reply, () => moveTo(userId, body.to))
    if (!view) return
    return { ok: true, data: view }
  })

  app.post(`${base}/current/story`, async (request, reply) => {
    const userId = self(request, reply)
    if (!userId) return
    const body = storySchema.parse(request.body)
    const view = await guardAbort(reply, () => playStory(userId, body.choices))
    if (!view) return
    return { ok: true, data: view }
  })

  app.post(`${base}/current/battle/lineup`, async (request, reply) => {
    const userId = self(request, reply)
    if (!userId) return
    const body = lineupSchema.parse(request.body)
    const view = await guardAbort(reply, () => chooseLineup(userId, body.lineup))
    if (!view) return
    return { ok: true, data: view }
  })

  app.post(`${base}/current/battle/actions`, async (request, reply) => {
    const userId = self(request, reply)
    if (!userId) return
    const body = actionsSchema.parse(request.body)
    const view = await guardAbort(reply, () => appendActions(userId, body.base, body.actions))
    if (!view) return
    return { ok: true, data: view }
  })

  app.post(`${base}/current/battle/retry`, async (request, reply) => {
    const userId = self(request, reply)
    if (!userId) return
    const view = await guardAbort(reply, () => retryBattle(userId))
    if (!view) return
    return { ok: true, data: view }
  })

  app.post(`${base}/current/settle`, async (request, reply) => {
    const userId = self(request, reply)
    if (!userId) return
    const settlement = await guardAbort(reply, () => settleExpedition(userId))
    if (!settlement) return
    return { ok: true, data: settlement }
  })

  app.post(`${base}/current/abandon`, async (request, reply) => {
    const userId = self(request, reply)
    if (!userId) return
    const settlement = await guardAbort(reply, () => abandonExpedition(userId))
    if (!settlement) return
    return { ok: true, data: settlement }
  })

  app.post(`${base}/current/suspend`, async (request, reply) => {
    const userId = self(request, reply)
    if (!userId) return
    const view = await guardAbort(reply, () => suspendExpedition(userId))
    if (!view) return
    return { ok: true, data: view }
  })

  app.post(`${base}/current/resume`, async (request, reply) => {
    const userId = self(request, reply)
    if (!userId) return
    const view = await guardAbort(reply, () => resumeExpedition(userId))
    if (!view) return
    return { ok: true, data: view }
  })
}
