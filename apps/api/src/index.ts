import cors from "@fastify/cors"
import cookie from "@fastify/cookie"
import Fastify from "fastify"

import { authRoutes } from "./routes/auth"
import { cardRoutes } from "./routes/cards"
import { deckRoutes } from "./routes/decks"
import { dungeonRoutes } from "./routes/dungeons"
import { marketRoutes } from "./routes/market"
import { packRoutes } from "./routes/packs"
import { progressionRoutes } from "./routes/progression"
import { progressRoutes } from "./routes/progress"
import { client, sql } from "./db/client"

const app = Fastify({ logger: true })

await app.register(cors, { origin: true, credentials: true })
await app.register(cookie)
await app.register(authRoutes)
await app.register(packRoutes)
await app.register(cardRoutes)
await app.register(deckRoutes)
await app.register(marketRoutes)
await app.register(progressionRoutes)
await app.register(dungeonRoutes)
await app.register(progressRoutes)

app.get("/health", async () => ({ ok: true, data: { status: "up" } }))

const port = Number(process.env.PORT ?? 3100)
await app.listen({ port, host: "0.0.0.0" })

// PGlite keeps its WAL in the data directory. Closing it on Ctrl+C / a normal
// process signal keeps the next startup from finding an invalid checkpoint.
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
    } else if (sql) {
      await sql.end({ timeout: 5 }).catch((error) => app.log.warn({ err: error }, "close database failed"))
    }
  }
  process.exit(0)
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
  process.once(signal, () => void shutdown(signal))
}
