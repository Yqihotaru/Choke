import { and, count, eq, isNull, like, sql } from "drizzle-orm"
import type { FastifyReply, FastifyRequest } from "fastify"

import { COOKIE_NAME, readSession } from "./auth/osu"
import { db } from "./db/client"
import { cards, marketListings, userCards, userPacks, users } from "./db/schema"
import { abandonExpedition } from "./expedition/service"
import { RARITY_ORDER } from "./gacha/pools"
import { recordLedger } from "./ledger"
import { addPacks } from "./packs/inventory"
import { TxAbort, lockUser, type Tx } from "./tx"

/**
 * 账号绑定与进度继承（设计见 Design/备忘录.md「账号绑定与进度继承」）：
 * - 游客号 / 邮箱号绑定的 osu! 号没人用过：直接挂上去；
 * - 那个 osu! 号已经有进度：让玩家二选一，**不合并**，落选的一边封存（释放邮箱和 osu! id，不能登录）。
 */

export type AccountKind = "guest" | "email" | "osu"

export function accountKind(user: { osuId: number | null; email: string | null }): AccountKind {
  if (user.osuId != null) return "osu"
  return user.email ? "email" : "guest"
}

export type BindChoice = "keep-current" | "keep-osu"

/* ============================ 待确认 ============================ */

/** 待确认的绑定：只在内存里放 10 分钟，重启了让玩家重新点一次绑定就行；真正的选择在事务里完成 */
const PENDING_TTL_MS = 10 * 60_000

interface PendingBind {
  osuId: number
  osuUsername: string
  /** 已经占着这个 osu! id 的账号 */
  targetUserId: string
  expiresAt: number
}

const pending = new Map<string, PendingBind>()

function pendingOf(userId: string, now: number): PendingBind | null {
  const found = pending.get(userId)
  if (!found) return null
  if (found.expiresAt <= now) {
    pending.delete(userId)
    return null
  }
  return found
}

function setPending(userId: string, value: Omit<PendingBind, "expiresAt">, now: number) {
  for (const [key, entry] of pending) if (entry.expiresAt <= now) pending.delete(key)
  pending.set(userId, { ...value, expiresAt: now + PENDING_TTL_MS })
}

export function cancelPendingBind(userId: string) {
  pending.delete(userId)
}

/* ============================ 开始绑定 ============================ */

export type BeginBindResult =
  | { kind: "linked" }
  | { kind: "choose" }
  | { kind: "rejected"; reason: "already_linked" | "unknown_user" }

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null
  return e?.code === "23505" || e?.cause?.code === "23505"
}

/**
 * 补发一个神秘卡包让这个号去领本体卡。
 * 已经有本体卡、或者手上还有没开的神秘卡包（邮箱号新手包里就有）就不再发，防止重复。
 */
async function grantBindMystery(tx: Tx, userId: string) {
  const [hero] = await tx
    .select({ id: userCards.id })
    .from(userCards)
    .where(and(eq(userCards.userId, userId), like(userCards.cardId, "hero-%")))
    .limit(1)
  if (hero) return
  const [held] = await tx
    .select({ count: userPacks.count })
    .from(userPacks)
    .where(and(eq(userPacks.userId, userId), eq(userPacks.pool, "mystery")))
    .limit(1)
  if ((held?.count ?? 0) > 0) return
  await addPacks(userId, { mystery: 1 }, tx)
  await recordLedger(tx, userId, [{ kind: "pack", ref: "mystery", delta: 1 }], { source: "bind-osu" })
}

/**
 * OAuth 回来之后调用：这个 osu! 号没人用就直接挂到 userId 上，
 * 已经有主人就记成「待确认」，等玩家在界面里二选一。
 */
export async function beginBind(
  userId: string,
  me: { id: number; username: string },
  now = Date.now(),
): Promise<BeginBindResult> {
  const [self] = await db
    .select({ osuId: users.osuId, sealedAt: users.sealedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!self || self.sealedAt) return { kind: "rejected", reason: "unknown_user" }
  if (self.osuId != null) return { kind: "rejected", reason: "already_linked" }

  const holderOf = async () => {
    const [holder] = await db.select({ id: users.id }).from(users).where(eq(users.osuId, me.id)).limit(1)
    return holder ?? null
  }
  const choose = (targetUserId: string): BeginBindResult => {
    setPending(userId, { osuId: me.id, osuUsername: me.username, targetUserId }, now)
    return { kind: "choose" }
  }

  const holder = await holderOf()
  if (holder) return choose(holder.id)

  try {
    const attached = await db.transaction(async (tx) => {
      const rows = await tx
        .update(users)
        .set({ osuId: me.id })
        .where(and(eq(users.id, userId), isNull(users.osuId), isNull(users.sealedAt)))
        .returning({ id: users.id })
      if (rows.length === 0) return false
      await grantBindMystery(tx, userId)
      return true
    })
    return attached ? { kind: "linked" } : { kind: "rejected", reason: "already_linked" }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    // 同一瞬间被别人抢先绑了，按「已有主人」处理
    const raced = await holderOf()
    if (raced) return choose(raced.id)
    throw error
  }
}

/* ============================ 对比两个账号 ============================ */

export interface AccountSummary {
  id: string
  username: string
  kind: AccountKind
  level: number
  tutorialDone: boolean
  coins: number
  cardCount: number
  /** 手上最高的卡品质，没有卡是 null */
  bestRarity: string | null
  lastSeenAt: string
  createdAt: string
}

async function summarize(userId: string): Promise<AccountSummary | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return null
  const [owned] = await db.select({ n: count() }).from(userCards).where(eq(userCards.userId, userId))
  const rarities = await db
    .select({ rarity: cards.rarity })
    .from(userCards)
    .innerJoin(cards, eq(cards.id, userCards.cardId))
    .where(eq(userCards.userId, userId))
    .groupBy(cards.rarity)
  let best: string | null = null
  for (const { rarity } of rarities) {
    if (best === null || RARITY_ORDER.indexOf(rarity as never) > RARITY_ORDER.indexOf(best as never)) best = rarity
  }
  return {
    id: user.id,
    username: user.username,
    kind: accountKind(user),
    level: user.playerLevel,
    tutorialDone: user.tutorialDone,
    coins: user.coins,
    cardCount: owned?.n ?? 0,
    bestRarity: best,
    lastSeenAt: user.lastSeenAt.toISOString(),
    createdAt: user.createdAt.toISOString(),
  }
}

export interface PendingBindView {
  osuId: number
  osuUsername: string
  expiresAt: number
  /** 现在登录的这个账号 */
  current: AccountSummary
  /** 已经占着这个 osu! 号的账号 */
  osu: AccountSummary
}

export async function describePendingBind(userId: string, now = Date.now()): Promise<PendingBindView | null> {
  const found = pendingOf(userId, now)
  if (!found) return null
  const [current, osu] = await Promise.all([summarize(userId), summarize(found.targetUserId)])
  if (!current || !osu) {
    pending.delete(userId)
    return null
  }
  return { osuId: found.osuId, osuUsername: found.osuUsername, expiresAt: found.expiresAt, current, osu }
}

/* ============================ 二选一 ============================ */

type UserRow = typeof users.$inferSelect

/** 封存落选的账号：挂单下架退押金，释放邮箱和 osu! id（原值另存），之后不能登录 */
async function sealUser(tx: Tx, loser: UserRow, intoUserId: string, now: number) {
  const cancelled = await tx
    .update(marketListings)
    .set({ status: "cancelled" })
    .where(and(eq(marketListings.sellerId, loser.id), eq(marketListings.status, "active")))
    .returning({ id: marketListings.id, deposit: marketListings.deposit })
  const refund = cancelled.reduce((sum, row) => sum + row.deposit, 0)
  if (refund > 0) {
    await tx
      .update(users)
      .set({ coins: sql`${users.coins} + ${refund}` })
      .where(eq(users.id, loser.id))
    await recordLedger(tx, loser.id, [{ kind: "coins", delta: refund }], {
      source: "market-deposit-refund",
      sourceRef: "account-seal",
    })
  }
  await tx
    .update(users)
    .set({
      sealedAt: new Date(now),
      sealedInto: intoUserId,
      sealedOsuId: loser.osuId,
      sealedEmail: loser.email,
      osuId: null,
      email: null,
      passwordHash: null,
    })
    .where(eq(users.id, loser.id))
}

async function abandonIfOpen(userId: string, now: number) {
  try {
    await abandonExpedition(userId, now)
  } catch (error) {
    if (!(error instanceof TxAbort)) throw error
  }
}

export interface ResolveBindResult {
  /** 留下来的账号，要把登录态换成它 */
  userId: string
  sealedUserId: string
  kept: "current" | "osu"
}

export async function resolveBind(userId: string, choice: BindChoice, now = Date.now()): Promise<ResolveBindResult> {
  const found = pendingOf(userId, now)
  if (!found) throw new TxAbort(404, "no_pending_bind", "没有待确认的绑定，请重新点一次绑定 osu!")

  const loserId = choice === "keep-current" ? found.targetUserId : userId
  // 出征没法跟着封存，先放弃（不给奖励、体力退回）；放在事务外，失败也不影响账号本身
  await abandonIfOpen(loserId, now)

  const result = await db.transaction(async (tx) => {
    for (const id of [userId, found.targetUserId].sort()) await lockUser(tx, id)
    const [self] = await tx.select().from(users).where(eq(users.id, userId)).limit(1)
    const [target] = await tx.select().from(users).where(eq(users.id, found.targetUserId)).limit(1)
    if (!self || self.sealedAt || self.osuId != null) {
      throw new TxAbort(409, "bind_stale", "当前账号的状态变了，请重新绑定")
    }
    if (!target || target.sealedAt || target.osuId !== found.osuId) {
      throw new TxAbort(409, "bind_stale", "那个 osu! 账号的状态变了，请重新绑定")
    }

    if (choice === "keep-current") {
      await sealUser(tx, target, self.id, now)
      await tx.update(users).set({ osuId: found.osuId }).where(eq(users.id, self.id))
      await grantBindMystery(tx, self.id)
      return { userId: self.id, sealedUserId: target.id, kept: "current" as const }
    }

    await sealUser(tx, self, target.id, now)
    // 邮箱和密码跟着走，之后仍可以用邮箱登录这个 osu! 号；对方已有邮箱就只释放
    if (self.email && !target.email) {
      await tx
        .update(users)
        .set({ email: self.email, passwordHash: self.passwordHash })
        .where(eq(users.id, target.id))
    }
    return { userId: target.id, sealedUserId: self.id, kept: "osu" as const }
  })

  pending.delete(userId)
  markSealed(result.sealedUserId)
  return result
}

/* ============================ 邮箱补绑 ============================ */

/** 反向绑定：没有邮箱的账号（游客或 osu! 号）补一个邮箱和密码 */
export async function bindEmail(userId: string, email: string, passwordHash: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockUser(tx, userId)
    const [user] = await tx
      .select({ email: users.email, sealedAt: users.sealedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!user || user.sealedAt) throw new TxAbort(401, "unauthorized", "用户不存在")
    if (user.email) throw new TxAbort(409, "email_already_bound", "这个账号已经绑定过邮箱了")
    const [taken] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1)
    if (taken) throw new TxAbort(409, "email_taken", "这个邮箱已经注册过了")
    await tx.update(users).set({ email, passwordHash }).where(eq(users.id, userId))
  })
}

/* ============================ 封存的账号不能用 ============================ */

const SEALED_CACHE_MS = 30_000
const sealedCache = new Map<string, { sealed: boolean; at: number }>()

function markSealed(userId: string) {
  sealedCache.set(userId, { sealed: true, at: Date.now() })
}

async function isSealed(userId: string, now = Date.now()): Promise<boolean> {
  const hit = sealedCache.get(userId)
  if (hit && now - hit.at < SEALED_CACHE_MS) return hit.sealed
  const [row] = await db.select({ sealedAt: users.sealedAt }).from(users).where(eq(users.id, userId)).limit(1)
  if (sealedCache.size > 5000) sealedCache.clear()
  const sealed = !!row?.sealedAt
  sealedCache.set(userId, { sealed, at: now })
  return sealed
}

/**
 * 全局 onRequest 钩子：带着封存账号登录态的请求，当作没登录处理并清掉 cookie。
 * 登录态是签名 cookie，本身没法作废，所以每个请求在这里看一眼（带 30 秒缓存）。
 */
export async function rejectSealedSession(request: FastifyRequest, reply: FastifyReply) {
  const raw = request.cookies?.[COOKIE_NAME]
  if (!raw) return
  const userId = readSession(raw)
  if (!userId || !(await isSealed(userId))) return
  request.cookies[COOKIE_NAME] = undefined
  reply.clearCookie(COOKIE_NAME, { path: "/" })
}
