import crypto from "node:crypto"

import {
  ACCEPT_LEGACY_SESSION,
  CLIENT_ID,
  CLIENT_SECRET,
  COOKIE_NAME,
  REDIRECT_URI,
  SESSION_SECRET,
  SESSION_TTL_MS,
} from "./env"

const AUTHORIZE = "https://osu.ppy.sh/oauth/authorize"
const TOKEN = "https://osu.ppy.sh/oauth/token"
const ME = "https://osu.ppy.sh/api/v2/me/osu"

/** 一次 OAuth 往返的备注：bindUserId 有值说明这是「已登录账号绑定 osu!」，不是登录 */
export interface OAuthState {
  bindUserId?: string
}

const states = new Map<string, OAuthState>()

export function createState(entry: OAuthState = {}): string {
  const state = crypto.randomBytes(16).toString("hex")
  states.set(state, entry)
  if (states.size > 500) {
    const first = states.keys().next().value
    if (first) states.delete(first)
  }
  return state
}

/** 取出并作废；state 不存在返回 null */
export function takeState(state: string | undefined): OAuthState | null {
  if (!state) return null
  const entry = states.get(state)
  if (!entry) return null
  states.delete(state)
  return entry
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "identify",
    state,
  })
  return `${AUTHORIZE}?${params.toString()}`
}

export interface OsuMe {
  id: number
  username: string
  avatar_url: string
  country_code: string
  follower_count?: number
  cover?: { url?: string | null } | null
  ranked_beatmapset_count?: number
  user_achievements?: readonly unknown[]
  statistics?: {
    play_count?: number
    total_hits?: number
    pp?: number
    level?: { current?: number }
    grade_counts?: {
      ssh?: number
      ss?: number
      sh?: number
      s?: number
      a?: number
    }
  }
}

export async function exchangeCode(code: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
  })
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  if (!res.ok) {
    throw new Error(`换 token 失败 ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

export async function fetchMe(accessToken: string): Promise<OsuMe> {
  const res = await fetch(ME, {
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`读 /me 失败 ${res.status}`)
  return (await res.json()) as OsuMe
}

export function sign(value: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex").slice(0, 32)
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

/** token 形如 `v1.{userId}.{过期毫秒时间戳}.{签名}`；旧版 `{userId}.{签名}` 没有过期时间。 */
export function makeSession(userId: string, now = Date.now()): string {
  const body = `v1.${userId}.${now + SESSION_TTL_MS}`
  return `${body}.${sign(body)}`
}

export function readSession(raw: string | undefined, now = Date.now()): string | null {
  if (!raw) return null
  const dot = raw.lastIndexOf(".")
  if (dot <= 0) return null
  const body = raw.slice(0, dot)
  if (!safeEqual(sign(body), raw.slice(dot + 1))) return null

  if (!body.startsWith("v1.")) return ACCEPT_LEGACY_SESSION ? body : null
  const sep = body.lastIndexOf(".")
  const userId = body.slice(3, sep)
  const expiresAt = Number(body.slice(sep + 1))
  if (!userId || !Number.isFinite(expiresAt) || expiresAt <= now) return null
  return userId
}

/** 旧格式 token（无过期时间）：登录态仍有效，但会在 /auth/me 被换成新格式。 */
export function isLegacySession(raw: string | undefined): boolean {
  return !!raw && !raw.startsWith("v1.")
}

export { COOKIE_NAME }
