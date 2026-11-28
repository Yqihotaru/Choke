import type { FastifyReply, FastifyRequest } from "fastify"

interface RateLimitOptions {
  max: number
  windowMs: number
  /**
   * 额外的账号维度（例如登录 / 注册的邮箱）。
   * 返回空值时只按 IP 计数；返回非空时同时限制「IP + 路由」和「账号 + 路由」两个桶。
   */
  accountOf?: (request: FastifyRequest) => string | null | undefined
}

interface Bucket {
  count: number
  resetAt: number
}

/**
 * 进程内固定窗口限流：按 IP（以及可选的账号）计数，用作路由的 preHandler。
 * 多实例部署各自计数；放在反向代理后面时给 Fastify 配 trustProxy（见 index.ts 的 TRUST_PROXY），
 * 否则 IP 都是代理地址，所有人会共享同一个桶。
 */
export function rateLimit({ max, windowMs, accountOf }: RateLimitOptions) {
  const hits = new Map<string, Bucket>()

  /** 记一次；超限时返回还要等多少秒 */
  function hit(key: string, now: number): number | null {
    let entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
      hits.set(key, entry)
    }
    entry.count += 1
    if (entry.count <= max) return null
    return Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
  }

  return async function limit(request: FastifyRequest, reply: FastifyReply) {
    const now = Date.now()
    if (hits.size > 5000) {
      for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key)
    }

    const route = request.routeOptions.url ?? request.url
    const keys = [`ip:${request.ip}|${route}`]
    const account = accountOf?.(request)
    if (account) keys.push(`account:${account}|${route}`)

    let retryAfter = 0
    for (const key of keys) {
      const wait = hit(key, now)
      if (wait !== null) retryAfter = Math.max(retryAfter, wait)
    }
    if (retryAfter === 0) return

    return reply
      .code(429)
      .header("Retry-After", String(retryAfter))
      .send({
        ok: false,
        error: { code: "rate_limited", message: `请求太频繁，请 ${retryAfter} 秒后再试` },
      })
  }
}
