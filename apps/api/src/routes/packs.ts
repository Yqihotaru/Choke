import { and, eq, getTableColumns } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { requireSelf, requireSession } from "../auth/guard"
import { DECK_SIZE } from "../config"
import { db } from "../db/client"
import { cards, userCards, users } from "../db/schema"
import { TxAbort, guardAbort, lockUser, runTx } from "../tx"
import { invalidatePublicCardRows } from "./cards"
import { grantHeroCard, openPack } from "../gacha/open"
import {
  EVENT_PACKS,
  MYSTERY_PACK,
  PACKS,
  PACK_SIZE,
  STARTER_PACKS,
  type PackId,
} from "../gacha/packs"
import { MIRROR_RATE } from "../mirror"
import {
  consumePack,
  createPackToken,
  getPackCounts,
  returnPackToken,
  type PackPoolId,
} from "../packs/inventory"

const poolIds = Object.keys(PACKS) as [PackId, ...PackId[]]

async function loadHero(userId: string, heroId: string) {
  const [row] = await db
    .select({
      ...getTableColumns(cards),
      userCardId: userCards.id,
      level: userCards.level,
      constellation: userCards.constellation,
      exp: userCards.exp,
      serial: userCards.serial,
      rollBp: userCards.rollBp,
      skillRefs: userCards.skillRefs,
      foil: userCards.foil,
    })
    .from(userCards)
    .innerJoin(cards, eq(cards.id, userCards.cardId))
    .where(and(eq(userCards.userId, userId), eq(userCards.cardId, heroId)))
    .limit(1)
  return row ?? null
}

export async function packRoutes(app: FastifyInstance) {
  app.get("/config", async () => {
    return {
      ok: true,
      data: {
        packs: Object.entries(PACKS).map(([id, pack]) => ({
          id,
          name: pack.name,
          short: pack.short,
          color: pack.color,
          weights: pack.weights,
          foilRate: pack.foilRate,
          event: EVENT_PACKS.includes(id as PackId),
        })),
        packSize: PACK_SIZE,
        deckSize: DECK_SIZE,
        starterPacks: Object.entries(STARTER_PACKS).map(([id, count]) => ({
          id,
          count,
          name: id === MYSTERY_PACK.id ? MYSTERY_PACK.name : PACKS[id as PackId].name,
        })),
        mirrorRate: MIRROR_RATE,
      },
    }
  })

  app.get("/users/:userId/packs", async (request, reply) => {
    const params = z.object({ userId: z.string() }).parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return

    const packs = await getPackCounts(userId)
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    let heroClaimed = false
    if (user?.osuId != null) {
      const [hero] = await db
        .select({ id: userCards.id })
        .from(userCards)
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, `hero-${user.osuId}`)))
        .limit(1)
      heroClaimed = !!hero
    }

    return { ok: true, data: { packs, heroClaimed } }
  })

  app.post("/users/:userId/packs/:pool/take", async (request, reply) => {
    const params = z
      .object({
        userId: z.string(),
        pool: z.enum(poolIds),
      })
      .safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "bad_request", message: "卡包类型不合法" },
      })
    }
    const userId = requireSelf(request, reply, params.data.userId)
    if (!userId) return

    const token = await createPackToken(userId, params.data.pool as PackPoolId)
    if (!token) {
      return reply.code(400).send({
        ok: false,
        error: { code: "no_packs", message: "背包里没有这个卡包" },
      })
    }
    return {
      ok: true,
      data: { token, packs: await getPackCounts(userId) },
    }
  })

  app.post("/users/:userId/packs/return", async (request, reply) => {
    const params = z.object({ userId: z.string() }).safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "bad_request", message: "用户 id 不合法" },
      })
    }
    const userId = requireSelf(request, reply, params.data.userId)
    if (!userId) return
    const body = z.object({ token: z.string().min(1) }).safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "bad_request", message: "缺少卡包 token" },
      })
    }

    const pool = await returnPackToken(userId, body.data.token)
    if (!pool) {
      return reply.code(400).send({
        ok: false,
        error: { code: "invalid_token", message: "这个卡包已经失效" },
      })
    }
    return { ok: true, data: { pool, packs: await getPackCounts(userId) } }
  })

  app.post("/users/:userId/packs/mystery/open", async (request, reply) => {
    const params = z.object({ userId: z.string() }).parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return

    const body = z
      .object({ answers: z.array(z.string()).max(10).optional() })
      .safeParse(request.body ?? {})
    if (!body.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "bad_request", message: "问卷答案格式不合法" },
      })
    }

    const hero = await runTx(reply, async (tx) => {
      // 锁住玩家：两个领取请求同时来，第二个要等第一个提交后重新判断
      await lockUser(tx, userId)
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1)
      if (!user) throw new TxAbort(401, "unauthorized", "用户不存在")
      if (!user.onboarded) throw new TxAbort(400, "onboarding_required", "先完成新手引导")
      if (user.osuId == null) throw new TxAbort(400, "no_osu", "这个账号没有绑定 osu!")

      const heroId = `hero-${user.osuId}`
      const [existing] = await tx
        .select({ id: userCards.id })
        .from(userCards)
        .where(and(eq(userCards.userId, userId), eq(userCards.cardId, heroId)))
        .limit(1)
      if (existing) throw new TxAbort(400, "hero_claimed", "本体卡已经领取过了")

      const [definition] = await tx.select({ id: cards.id }).from(cards).where(eq(cards.id, heroId)).limit(1)
      if (!definition) {
        throw new TxAbort(400, "hero_not_ready", "本体卡还没生成，请重新登录一次 osu!")
      }

      // 扣神秘包和发本体卡在同一个事务里：发卡失败，包会原样回来
      if (!(await consumePack(userId, "mystery", tx))) {
        throw new TxAbort(400, "no_packs", "背包里没有神秘卡包")
      }
      await grantHeroCard(userId, heroId, "mystery", tx)
      return heroId
    })
    if (!hero) return

    return {
      ok: true,
      data: {
        hero: await loadHero(userId, hero),
        answers: body.data.answers ?? [],
        packs: await getPackCounts(userId),
      },
    }
  })

  app.post("/packs/:pool/open", async (request, reply) => {
    // 只认 session，body.userId / body.count 仅为兼容旧前端而保留：
    // 一次扣一包，张数固定为 PACK_SIZE，不接受客户端指定。
    const userId = requireSession(request, reply)
    if (!userId) return

    const params = z.object({ pool: z.enum(poolIds) }).safeParse(request.params)
    const body = z
      .object({
        userId: z.string().min(1).max(64).optional(),
        count: z.number().int().min(1).max(10).optional(),
        token: z.string().min(1).optional(),
      })
      .safeParse(request.body ?? {})

    if (!params.success || !body.success) {
      return reply.code(400).send({
        ok: false,
        error: {
          code: "bad_request",
          message: params.success ? "body 不合法" : "pool 不合法",
          details: params.success
            ? body.success
              ? null
              : body.error.flatten()
            : params.error.flatten(),
        },
      })
    }

    // 扣包、判断保底、发卡、记流水都在 openPack 的同一个事务里；失败整体回滚，不会丢包
    const result = await guardAbort(reply, () =>
      openPack(
        userId,
        params.data.pool,
        PACK_SIZE,
        body.data.token ? { kind: "token", token: body.data.token } : { kind: "inventory" },
      ),
    )
    if (!result) return
    invalidatePublicCardRows()
    return {
      ok: true,
      data: { ...result, packs: await getPackCounts(userId) },
    }  })
}
