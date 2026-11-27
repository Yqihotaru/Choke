// 必须最先加载：内容校验失败时在连数据库之前就退出
import { CONTENT_VERSION } from "./content"

import cors from "@fastify/cors"
import cookie from "@fastify/cookie"
import Fastify from "fastify"

import { authRoutes } from "./routes/auth"
import { accountRoutes } from "./routes/account"
import { rejectSealedSession } from "./account-binding"
import { CORS_ORIGINS } from "./auth/env"
import { handleError } from "./error-handler"
import { battleRoutes } from "./routes/battle"
import { cardRoutes } from "./routes/cards"
import { deckRoutes } from "./routes/decks"
import { dungeonRoutes } from "./routes/dungeons"
import { expeditionRoutes } from "./routes/expeditions"
import { adminRoutes } from "./routes/admin"
import { mailRoutes } from "./routes/mails"
import { ledgerRoutes } from "./routes/ledger"
import { marketRoutes } from "./routes/market"
import { packRoutes } from "./routes/packs"
import { presenceRoutes } from "./routes/presence"
import { progressionRoutes } from "./routes/progression"
import { progressRoutes } from "./routes/progress"
import { questRoutes } from "./routes/quests"
import { shopRoutes } from "./routes/shop"
import { client, sql } from "./db/client"

const app = Fastify({ logger: true })
app.log.info({ contentVersion: CONTENT_VERSION }, "content loaded")

app.setErrorHandler(handleError)

// 白名单见 auth/env.ts：CORS_ORIGINS > 开发环境本地端口 > 生产默认同源（不发 CORS 头）
await app.register(cors, { origin: CORS_ORIGINS, credentials: true })
await app.register(cookie)
// 封存账号的登录态当作未登录处理（要在所有路由之前）
app.addHook("onRequest", rejectSealedSession)
await app.register(authRoutes)
await app.register(accountRoutes)
await app.register(packRoutes)
await app.register(presenceRoutes)
await app.register(battleRoutes)
await app.register(cardRoutes)
await app.register(deckRoutes)
await app.register(marketRoutes)
await app.register(mailRoutes)
await app.register(ledgerRoutes)
await app.register(adminRoutes)
await app.register(progressionRoutes)
await app.register(dungeonRoutes)
await app.register(expeditionRoutes)
await app.register(questRoutes)
await app.register(progressRoutes)
await app.register(shopRoutes)

app.get("/health", async () => ({ ok: true, data: { status: "up", contentVersion: CONTENT_VERSION } }))

const port = Number(process.env.PORT ?? 3100)
await app.listen({ port, host: "0.0.0.0" })

// 正常关闭连接池，避免重启时留下半开连接（测试用的临时 PGlite 也要关）。
let closing = false
async function shutdown(signal: string) {
  if (closing) return
  closing = true
  app.log.info({ signal }, "shutting down")
  try {
    await app.close()
  } finally {
    if (client) {
      await client.close().catch((error) => app.log.warn({ err: error }, "close database failed"))
    }
    if (sql) {
      await sql.end({ timeout: 5 }).catch((error) => app.log.warn({ err: error }, "close database failed"))
    }
  }
  process.exit(0)
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
  process.once(signal, () => void shutdown(signal))
}
