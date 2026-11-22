import type { FastifyReply, FastifyRequest } from "fastify"

interface RateLimitOptions {
  max: number
  windowMs: number
}

/**
 * 进程内固定窗口限流：按 IP + 路由计数，用作路由的 preHandler。
 * 多实例部署各自计数；放在反向代理后面时需要给 Fastify 配 trustProxy，否则 IP 都是代理地址。
 */
export function rateLimit({ max, windowMs }: RateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>()

  return async function limit(request: FastifyRequest, reply: FastifyReply) {
    const now = Date.now()
    if (hits.size > 5000) {
      for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key)
    }

    const key = `${request.ip}|${request.routeOptions.url ?? request.url}`
    let entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
      hits.set(key, entry)
    }
    entry.count += 1
    if (entry.count <= max) return

    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    return reply
      .code(429)
      .header("Retry-After", String(retryAfter))
      .send({
        ok: false,
        error: { code: "rate_limited", message: `请求太频繁，请 ${retryAfter} 秒后再试` },
      })
  }
}
