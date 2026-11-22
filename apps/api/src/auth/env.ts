import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

function findEnv(start: string): string | null {
  let dir = start
  for (let i = 0; i < 4; i += 1) {
    const file = path.join(dir, ".env")
    if (fs.existsSync(file)) return file
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

const file = findEnv(process.cwd())
if (file) {
  for (const line of fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!match) continue
    const value = match[2].replace(/^["']|["']$/g, "")
    if (!(match[1] in process.env)) process.env[match[1]] = value
  }
}

export const CLIENT_ID = process.env.OSU_CLIENT_ID ?? ""
export const CLIENT_SECRET = process.env.OSU_CLIENT_SECRET ?? ""
export const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3100"
export const WEB_BASE = process.env.WEB_BASE_URL ?? "http://localhost:5207"
export const REDIRECT_URI = `${API_BASE}/auth/osu/callback`

/**
 * session 签名密钥：显式配置 > osu! client secret > 本次进程的随机值。
 * 不能落到空串或写死的常量上，否则任何人都能自己签出别人的 cookie。
 */
function sessionSecret(): string {
  const explicit = process.env.SESSION_SECRET?.trim()
  if (explicit) return explicit
  if (CLIENT_SECRET) return CLIENT_SECRET
  console.warn(
    "[auth] SESSION_SECRET 和 OSU_CLIENT_SECRET 都没有配置：本次进程使用随机签名密钥，重启后登录态全部失效。",
  )
  return crypto.randomBytes(32).toString("hex")
}

export const SESSION_SECRET = sessionSecret()
export const COOKIE_NAME = "choke_session"
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000
export const IS_PRODUCTION = process.env.NODE_ENV === "production"

/** 旧版 token 没有过期时间；设 SESSION_ACCEPT_LEGACY=0 可立即拒绝它们（用户需重新登录，游客账号会丢失）。 */
export const ACCEPT_LEGACY_SESSION = process.env.SESSION_ACCEPT_LEGACY !== "0"

const DEV_WEB_PORTS = [5207, 5173, 5174, 5175, 4173]

/**
 * CORS 白名单：CORS_ORIGINS（逗号分隔）> 开发环境的本地前端端口 > 生产环境默认只同源（返回 false）。
 */
function corsOrigins(): string[] | false {
  const normalize = (value: string) => value.trim().replace(/\/+$/, "")
  const configured = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map(normalize)
    .filter(Boolean)
  if (configured.length > 0) return configured
  if (IS_PRODUCTION) return false
  return [
    ...new Set([
      normalize(WEB_BASE),
      ...DEV_WEB_PORTS.flatMap((port) => [`http://localhost:${port}`, `http://127.0.0.1:${port}`]),
    ]),
  ]
}

export const CORS_ORIGINS = corsOrigins()
