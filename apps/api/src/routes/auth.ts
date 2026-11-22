import { randomBytes } from "node:crypto"

import { and, eq, getTableColumns, sql } from "drizzle-orm"
import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"

import {
  hashPassword,
  isEmail,
  newEmailUserId,
  normalizeEmail,
  verifyPassword,
} from "../auth/email"
import {
  COOKIE_NAME,
  authorizeUrl,
  consumeState,
  createState,
  exchangeCode,
  fetchMe,
  isLegacySession,
  makeSession,
  readSession,
} from "../auth/osu"
import { IS_PRODUCTION, SESSION_TTL_SECONDS, WEB_BASE } from "../auth/env"
import { rateLimit } from "../auth/rate-limit"
import { CARD_TYPES } from "../card-types"
import { db } from "../db/client"
import { cards, userCards, userPacks, users } from "../db/schema"
import { grantCard } from "../gacha/open"
import { invalidatePublicCardCache } from "./cards"
import { heroCardDef } from "../hero"
import { upsertMirrorCard } from "../mirror"
import { addPacks, getPackCounts, grantStarterPacks } from "../packs/inventory"
import { STARTER_PACKS } from "../gacha/packs"

/** 登录时把 /me/osu 写成 hero-{id} 卡定义，并放进该用户的卡册 */
async function claimHeroCard(
  userId: string,
  me: Awaited<ReturnType<typeof fetchMe>>,
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

  const def = heroCardDef(me, pool ?? null)
  const { id, ...rest } = def

  await db
    .insert(cards)
    .values({
      id,
      ...rest,
      cardType: CARD_TYPES.hero,
      // import --replace 会删掉本体定义；登录重建时补回仍存实例的最大号。
      pulled: sql<number>`coalesce((
        select max(${userCards.serial}) from ${userCards}
        where ${userCards.cardId} = ${id}
      ), 0)`,
    })
    .onConflictDoUpdate({
      target: cards.id,
      set: {
        ...rest,
        cardType: CARD_TYPES.hero,
        pulled: sql`greatest(${cards.pulled}, excluded.pulled)`,
      },
    })

  // 镜像卡定义跟着本体卡走：资料刷新时一起更新，但不发进卡册。
  await upsertMirrorCard(me.id, def)

  invalidatePublicCardCache()
  const [owned] = await db
    .select({ id: userCards.id })
    .from(userCards)
    .where(and(eq(userCards.userId, userId), eq(userCards.cardId, id)))
    .limit(1)

  if (grant && !owned) {
    await db.transaction((tx) => grantCard(tx, { userId, cardId: id }))
  }

}

export async function authRoutes(app: FastifyInstance) {
  function setSessionCookie(reply: FastifyReply, userId: string) {
    reply.setCookie(COOKIE_NAME, makeSession(userId), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: IS_PRODUCTION,
      maxAge: SESSION_TTL_SECONDS,
    })
  }

  const loginLimit = rateLimit({ max: 10, windowMs: 60_000 })
  const registerLimit = rateLimit({ max: 5, windowMs: 10 * 60_000 })
  const guestLimit = rateLimit({ max: 10, windowMs: 60_000 })

  app.get("/auth/osu", async (_request, reply) => {
    const state = createState()
    return reply.redirect(authorizeUrl(state))
  })

  const emailAuthSchema = z.object({
    email: z.string(),
    password: z.string().min(8).max(200),
    username: z.string().trim().min(1).max(24).optional(),
  })

  /** 邮箱注册：建号后与 osu 用户一样走 onboard（领新手包）。 */
  app.post("/auth/email/register", { preHandler: registerLimit }, async (request, reply) => {
    const body = emailAuthSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "invalid_input", message: "邮箱或密码格式不正确（密码至少 8 位）" },
      })
    }
    const email = normalizeEmail(body.data.email)
    if (!isEmail(email)) {
      return reply.code(400).send({
        ok: false,
        error: { code: "invalid_email", message: "邮箱格式不正确" },
      })
    }

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1)
    if (existing) {
      return reply.code(409).send({
        ok: false,
        error: { code: "email_taken", message: "这个邮箱已经注册过了" },
      })
    }

    const userId = newEmailUserId()
    const username = body.data.username || email.split("@")[0]!.slice(0, 24)
    const [user] = await db
      .insert(users)
      .values({
        id: userId,
        username,
        email,
        passwordHash: hashPassword(body.data.password),
        onboarded: false,
        staminaUpdatedAt: Date.now(),
      })
      .returning()

    if (!user) throw new Error("邮箱账号写入失败")
    request.log.info({ userId }, "email account created")
    setSessionCookie(reply, userId)

    return {
      ok: true,
      data: { id: user.id, username: user.username, email: user.email, onboarded: user.onboarded },
    }
  })

  app.post("/auth/email/login", { preHandler: loginLimit }, async (request, reply) => {
    const body = emailAuthSchema.pick({ email: true, password: true }).safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "invalid_input", message: "请输入邮箱和密码" },
      })
    }
    const email = normalizeEmail(body.data.email)
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        passwordHash: users.passwordHash,
        onboarded: users.onboarded,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1)

    if (!user || !verifyPassword(body.data.password, user.passwordHash)) {
      return reply.code(401).send({
        ok: false,
        error: { code: "bad_credentials", message: "邮箱或密码不正确" },
      })
    }

    setSessionCookie(reply, user.id)
    return {
      ok: true,
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        onboarded: user.onboarded,
      },
    }
  })

  /**
   * 游客账号：跳过 osu! OAuth，直接创建一个 guest-xxxx 用户并进入桌面。
   * 没有 osuId，所以没有本体卡；只发普通卡包，神秘卡包依赖 osu! 数据，不发放。
   */
  app.get("/auth/guest", { preHandler: guestLimit }, async (request, reply) => {
    const suffix = randomBytes(6).toString("hex")
    const userId = `guest-${suffix}`

    const [user] = await db
      .insert(users)
      .values({
        id: userId,
        username: `游客 ${suffix.slice(0, 4).toUpperCase()}`,
        onboarded: true,
        staminaUpdatedAt: Date.now(),
      })
      .returning()

    if (!user) throw new Error("游客账号写入失败")

    await addPacks(userId, { normal: STARTER_PACKS.normal })
    request.log.info({ userId }, "guest account created")

    setSessionCookie(reply, userId)

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

      const [user] = await db
        .insert(users)
        .values({
          id: userId,
          username: me.username,
          osuId: me.id,
          onboarded: false,
          staminaUpdatedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: users.id,
          set: { username: me.username },
        })
        .returning()

      if (!user) throw new Error("用户写入失败")

      try {
        await claimHeroCard(userId, me, false)
      } catch (error) {
        // 认领失败不能挡住登录
        request.log.warn({ err: error }, "claim hero card failed")
      }

      setSessionCookie(reply, userId)

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
    const rawSession = request.cookies[COOKIE_NAME]
    const userId = readSession(rawSession)
    if (!userId) {
      return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "未登录" } })
    }
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!user) {
      return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "用户不存在" } })
    }
    if (isLegacySession(rawSession)) setSessionCookie(reply, userId)

    // 镜像池按最近活跃筛选；/auth/me 是每次进桌面的必经请求。
    await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId))

    let hero = null
    if (user.osuId != null) {
      const [row] = await db
        .select({
          ...getTableColumns(cards),
          userCardId: userCards.id,
          level: userCards.level,
          constellation: userCards.constellation,
          exp: userCards.exp,
          serial: userCards.serial,
          rollBp: userCards.rollBp,
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
        email: user.email ?? null,
        /** 游客：既没有 osu! 也没有邮箱 */
        isGuest: user.osuId == null && !user.email,
        avatarUrl: user.osuId == null ? null : `https://a.ppy.sh/${user.osuId}`,
        profileUrl: user.osuId == null ? null : `https://osu.ppy.sh/users/${user.osuId}`,
        onboarded: user.onboarded,
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

    if (starterGranted) {
      await grantStarterPacks(userId)
    }

    return {
      ok: true,
      data: { onboarded: true, starterGranted },
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
