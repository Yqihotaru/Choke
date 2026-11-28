import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

const KEY_LEN = 64

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>

/**
 * 同时最多跑几个 scrypt：异步版走 libuv 线程池，不会卡住事件循环，
 * 但一次登录风暴仍会占满 CPU / 内存，这里做个进程级闸门。
 */
const MAX_SCRYPT = 2
let activeScrypt = 0
const scryptWaiters: Array<() => void> = []

async function acquireScrypt(): Promise<void> {
  if (activeScrypt < MAX_SCRYPT) {
    activeScrypt += 1
    return
  }
  await new Promise<void>((resolve) => scryptWaiters.push(resolve))
}

function releaseScrypt(): void {
  const next = scryptWaiters.shift()
  if (next) {
    // 直接把名额交给下一个等待者，不先减再加，避免并发抢占
    next()
    return
  }
  activeScrypt -= 1
}

async function withScryptSlot<T>(run: () => Promise<T>): Promise<T> {
  await acquireScrypt()
  try {
    return await run()
  } finally {
    releaseScrypt()
  }
}

/** scrypt 哈希：`salt:hex`，不引入额外依赖。 */
export function hashPassword(password: string): Promise<string> {
  return withScryptSlot(async () => {
    const salt = randomBytes(16).toString("hex")
    const hash = (await scryptAsync(password, salt, KEY_LEN)).toString("hex")
    return `${salt}:${hash}`
  })
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const [salt, hash] = stored.split(":")
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, "hex")
  return withScryptSlot(async () => {
    const actual = await scryptAsync(password, salt, KEY_LEN)
    if (expected.length !== actual.length) return false
    return timingSafeEqual(expected, actual)
  })
}

/** 新邮箱账号的内部 userId：随机值，与邮箱无关，避免把邮箱暴露在 URL / 事件里。 */
export function newEmailUserId(): string {
  const digest = randomBytes(8).toString("hex")
  return `email-${digest}`
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
