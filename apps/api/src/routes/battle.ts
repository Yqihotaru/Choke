import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { listEncounters, resolveEncounter } from "@choke/shared/battle/content"

import { BATTLE_CONTENT } from "../content"

/** 遭遇数据是静态内容，不需要登录；前端据此开战，服务端复算时用同一份 */
export async function battleRoutes(app: FastifyInstance) {
  const list = listEncounters(BATTLE_CONTENT)

  app.get("/battle/encounters", async () => ({ ok: true, data: list }))

  app.get("/battle/encounters/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const encounter = resolveEncounter(BATTLE_CONTENT, id)
    if (!encounter) {
      return reply.code(404).send({ ok: false, error: { code: "not_found", message: "没有这场战斗" } })
    }
    return { ok: true, data: encounter }
  })
}
