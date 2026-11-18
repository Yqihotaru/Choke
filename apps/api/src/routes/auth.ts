import { randomBytes } from "node:crypto"

import { and, eq, getTableColumns, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"

import {
  COOKIE_NAME,
  authorizeUrl,
  consumeState,
  createState,
  exchangeCode,
  fetchMe,
  makeSession,
  readSession,
} from "../auth/osu"
import { WEB_BASE } from "../auth/env"
import { db } from "../db/client"
import { cards, userCards, userPacks, users } from "../db/schema"
import { invalidatePublicCardCache } from "./cards"
import { heroCardDef } from "../hero"
import { addPacks, getPackCounts, grantStarterPacks } from "../packs/inventory"
import { STARTER_PACKS } from "../gacha/packs"
import { heroIndex, heroPersonalBonus, heroStatsFromOsu } from "../shared/pool"

/** 登录时把 /me/osu 写成 hero-{id} 卡定义，并放进该用户的卡册 */
async function claimHeroCard(
  userId: string,
  me: Awaited<ReturnType<typeof fetchMe>>,
  onboarded: boolean,
  personalBonusBp: number,
  grant: boolean,
) {
  const [pool] = await db
    .select({
      no: cards.no,
      total: cards.total,
      globalRank: cards.globalRank,
      pp: cards.pp,
      rarity: cards.rarity,
    })
    .from(cards)
    .where(eq(cards.id, `pool-${me.id}`))
    .limit(1)

  const def = heroCardDef(me, pool ?? null, onboarded, personalBonusBp)
  const { id, heroIndex: _index, heroPower: _power, ...rest } = def
  void _index
  void _power

  await db
    .insert(cards)
    .values({ id, ...rest })
    .onConflictDoUpdate({ target: cards.id, set: rest })

  invalidatePublicCardCache()
  const [owned] = await db
    .select({ id: userCards.id })
    .from(userCards)
    .where(and(eq(userCards.userId, userId), eq(userCards.cardId, id)))
    .limit(1)

  if (grant && !owned) {
    await db.insert(userCards).values({ userId, cardId: id })
  }

}

export async function authRoutes(app: FastifyInstance) {
  app.get("/auth/osu", async (_request, reply) => {
    const state = createState()
    return reply.redirect(authorizeUrl(state))
  })

  /**
   * 游客账号：跳过 osu! OAuth，直接创建一个 guest-xxxx 用户并进入桌面。
   * 没有 osuId，所以没有本体卡；只发普通卡包，神秘卡包依赖 osu! 数据，不发放。
   */
  app.get("/auth/guest", async (request, reply) => {
    const suffix = randomBytes(6).toString("hex")
    const userId = `guest-${suffix}`

    const [user] = await db
      .insert(users)
      .values({
        id: userId,
        username: `游客 ${suffix.slice(0, 4).toUpperCase()}`,
        onboarded: true,
        heroBonus: 0,
      })
      .returning()

    if (!user) throw new Error("游客账号写入失败")

    await addPacks(userId, { normal: STARTER_PACKS.normal })
    request.log.info({ userId }, "guest account created")

    reply.setCookie(COOKIE_NAME, makeSession(userId), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
    })

    return reply.redirect(`${WEB_BASE}/`)
  })

  app.get("/auth/osu/callback", async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string }
    if (!code || !consumeState(state)) {
      return reply.code(400).send({
        ok: false,
        error: { code: "bad_callback", message: "state 或 code 无效" },
      })
    }

    try {
      const accessToken = await exchangeCode(code)
      const me = await fetchMe(accessToken)
      const userId = `osu-${me.id}`
      const hero = heroIndex(heroStatsFromOsu(me))
      const personalBonusBp = Math.round(heroPersonalBonus(hero.index) * 10000)

      const [user] = await db
        .insert(users)
        .values({
          id: userId,
          username: me.username,
          osuId: me.id,
          onboarded: false,
          heroBonus: personalBonusBp,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: { username: me.username, heroBonus: personalBonusBp },
        })
        .returning()

      if (!user) throw new Error("用户写入失败")

      try {
        await claimHeroCard(userId, me, user.onboarded, user.heroBonus, false)
      } catch (error) {
        // 认领失败不能挡住登录
        request.log.warn({ err: error }, "claim hero card failed")
      }

      reply.setCookie(COOKIE_NAME, makeSession(userId), {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
      })

      return reply.redirect(`${WEB_BASE}/`)
    } catch (error) {
      request.log.error(error)
      return reply.code(500).send({
        ok: false,
        error: {
          code: "oauth_failed",
          message: error instanceof Error ? error.message : "osu 登录失败",
        },
      })
    }
  })

  app.get("/auth/me", async (request, reply) => {
    const userId = readSession(request.cookies[COOKIE_NAME])
    if (!userId) {
      return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "未登录" } })
    }
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!user) {
      return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "用户不存在" } })
    }

    let hero = null
    if (user.osuId != null) {
      const [row] = await db
        .select({
          ...getTableColumns(cards),
          userCardId: userCards.id,
          level: userCards.level,
          constellation: userCards.constellation,
          exp: userCards.exp,
          foil: userCards.foil,
        })
        .from(userCards)
        .innerJoin(cards, eq(cards.id, userCards.cardId))
        .where(and(eq(userCards.userId, user.id), eq(userCards.cardId, `hero-${user.osuId}`)))
        .limit(1)
      hero = row ?? null
    }

    return {
      ok: true,
      data: {
        id: user.id,
        publicId: user.publicId,
        username: user.username,
        osuId: user.osuId,
        avatarUrl: user.osuId == null ? null : `https://a.ppy.sh/${user.osuId}`,
        profileUrl: user.osuId == null ? null : `https://osu.ppy.sh/users/${user.osuId}`,
        onboarded: user.onboarded,
        heroBonus: user.heroBonus,
        essence: user.essence,
        coins: user.coins,
        hero,
      },
    }
  })

  app.post("/auth/onboard", async (request, reply) => {
    const userId = readSession(request.cookies[COOKIE_NAME])
    if (!userId) {
      return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "未登录" } })
    }
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!user) {
      return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "用户不存在" } })
    }

    // 条件更新保证并发点击“领取/跳过”时只有一个请求真正发礼包
    const claimed = await db
      .update(users)
      .set({ onboarded: true })
      .where(and(eq(users.id, userId), eq(users.onboarded, false)))
      .returning({ id: users.id })
    const starterGranted = claimed.length > 0

    if (user.osuId != null) {
      await db
        .update(cards)
        .set({ heroBonus: user.heroBonus })
        .where(eq(cards.id, `hero-${user.osuId}`))
      invalidatePublicCardCache()
    }

    if (starterGranted) {
      await grantStarterPacks(userId)
    }

    return {
      ok: true,
      data: { onboarded: true, heroBonus: user.heroBonus, starterGranted },
    }
  })

  /**
   * 回归玩家补包：已经领过 30 包但已经花完时，教程第一步会卡住。
   * 只在“普通包为 0 且从未补发过”时发 1 包，避免无限刷包。
   */
  app.post("/auth/tutorial-pack", async (request, reply) => {
    const userId = readSession(request.cookies[COOKIE_NAME])
    if (!userId) {
      return reply
        .code(401)
        .send({ ok: false, error: { code: "unauthorized", message: "未登录" } })
    }
    const [user] = await db
      .select({
        onboarded: users.onboarded,
        tutorialPackClaimed: users.tutorialPackClaimed,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!user) {
      return reply
        .code(401)
        .send({ ok: false, error: { code: "unauthorized", message: "用户不存在" } })
    }
    if (!user.onboarded) {
      return reply.code(400).send({
        ok: false,
        error: { code: "onboarding_required", message: "先完成账号引导" },
      })
    }

    const counts = await getPackCounts(userId)
    if (counts.normal > 0 || user.tutorialPackClaimed) {
      return { ok: true, data: { granted: false, packs: counts } }
    }

    let granted = false
    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(users)
        .set({ tutorialPackClaimed: true })
        .where(
          and(
            eq(users.id, userId),
            eq(users.tutorialPackClaimed, false),
          ),
        )
        .returning({ id: users.id })
      if (claimed.length === 0) return

      granted = true
      await tx
        .insert(userPacks)
        .values({ userId, pool: "normal", count: 1 })
        .onConflictDoUpdate({
          target: [userPacks.userId, userPacks.pool],
          set: { count: sql`${userPacks.count} + 1` },
        })
    })

    return {
      ok: true,
      data: { granted, packs: await getPackCounts(userId) },
    }
  })

  app.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" })
    return { ok: true, data: null }
  })
}
