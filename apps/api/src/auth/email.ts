import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

const KEY_LEN = 64

/** scrypt 哈希：`salt:hex`，不引入额外依赖。 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, KEY_LEN).toString("hex")
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false
  const [salt, hash] = stored.split(":")
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, "hex")
  const actual = scryptSync(password, salt, KEY_LEN)
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

/** 邮箱 → 稳定的内部 userId，避免把邮箱暴露在 URL / 事件里。 */
export function emailUserId(email: string): string {
  const digest = randomBytes(8).toString("hex")
  return `email-${digest}`
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
