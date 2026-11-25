import type { FastifyReply, FastifyRequest } from "fastify"

import { IS_PRODUCTION, SESSION_TTL_SECONDS } from "./env"
import { COOKIE_NAME, makeSession, readSession } from "./osu"

/** 写登录态 cookie：登录、注册、绑定换号都走这里 */
export function setSessionCookie(reply: FastifyReply, userId: string) {
  reply.setCookie(COOKIE_NAME, makeSession(userId), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
    maxAge: SESSION_TTL_SECONDS,
  })
}

/** 从签名 cookie 读出当前登录用户 id，未登录返回 null */
export function readSessionUser(request: FastifyRequest): string | null {
  return readSession(request.cookies[COOKIE_NAME])
}

/** 要求已登录；失败时回 401 并返回 null */
export function requireSession(request: FastifyRequest, reply: FastifyReply): string | null {
  const userId = readSessionUser(request)
  if (!userId) {
    reply.code(401).send({
      ok: false,
      error: { code: "unauthorized", message: "未登录" },
    })
    return null
  }
  return userId
}

/**
 * 要求已登录且只能操作自己：path 里的 userId 必须与 session 一致。
 * 未登录 401，越权 403，失败时返回 null。
 */
export function requireSelf(
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): string | null {
  const sessionUserId = requireSession(request, reply)
  if (!sessionUserId) return null

  if (sessionUserId !== userId) {
    reply.code(403).send({
      ok: false,
      error: { code: "forbidden", message: "只能操作当前登录用户的数据" },
    })
    return null
  }
  return sessionUserId
}
