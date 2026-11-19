import fs from "node:fs"
import path from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"
import { drizzle } from "drizzle-orm/pglite"

import { runMigrations } from "./migrate"
import * as schema from "./schema"

const dataDir = path.resolve(process.env.PG_DATA_DIR ?? "./.data/pg")
fs.mkdirSync(dataDir, { recursive: true })

export const client = await PGlite.create(dataDir, { extensions: { pg_trgm } })
export const db = drizzle(client, { schema })

// 结构变更一律走 migrations/：这里只负责把还没跑过的迁移按顺序执行一遍。
await runMigrations(client)
