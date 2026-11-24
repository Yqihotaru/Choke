import fs from "node:fs"
import path from "node:path"

import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { runMigrations, type MigrationTarget } from "./migrate"
import * as schema from "./schema"

/**
 * 数据库连接。
 *
 * 只用真 PostgreSQL：必须设置 `DATABASE_URL`
 * （如 postgres://user:pass@localhost:5432/choke）。
 *
 * 例外：服务端测试脚本会设置 `PG_DATA_DIR`，用一个临时 PGlite 数据目录跑，
 * 避免碰开发库。PGlite 是 devDependency，生产安装不会带上。
 */
function loadDotEnv() {
  const file = path.resolve(import.meta.dirname, "../../../../.env")
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue
    const key = match[1]!
    if (key in process.env) continue
    process.env[key] = match[2]!.replace(/^["']|["']$/g, "")
  }
}

loadDotEnv()

const databaseUrl = process.env.DATABASE_URL?.trim()
const testDataDir = process.env.PG_DATA_DIR?.trim()

function postgresTarget(sql: postgres.Sql): MigrationTarget {
  return {
    exec: async (statement) => {
      await sql.unsafe(statement)
    },
    query: async <T = unknown>(text: string, params?: unknown[]) =>
      (await sql.unsafe(text, (params ?? []) as never[])) as unknown as T[],
  }
}

interface Created {
  db: PostgresJsDatabase<typeof schema>
  sql?: postgres.Sql
  client?: { close(): Promise<void> }
}

async function createPostgres(): Promise<Created> {
  const sql = postgres(databaseUrl!, { max: 10, onnotice: () => {} })
  await runMigrations(postgresTarget(sql))
  return { db: drizzlePostgres(sql, { schema }) as PostgresJsDatabase<typeof schema>, sql }
}

/** 仅测试脚本：一次性 PGlite，进程结束就丢掉。 */
async function createTestPglite(dir: string): Promise<Created> {
  const { PGlite } = await import("@electric-sql/pglite")
  const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm")
  const { drizzle } = await import("drizzle-orm/pglite")

  fs.mkdirSync(dir, { recursive: true })
  const client = await PGlite.create(dir, { extensions: { pg_trgm } })
  await runMigrations({
    exec: (statement) => client.exec(statement).then(() => undefined),
    query: async <T = unknown>(text: string, params?: unknown[]) => {
      const result = await client.query<T>(text, params)
      return result.rows
    },
  })
  return {
    db: drizzle(client, { schema }) as unknown as PostgresJsDatabase<typeof schema>,
    client,
  }
}

async function createDb(): Promise<Created> {
  if (databaseUrl) return createPostgres()
  if (testDataDir) return createTestPglite(testDataDir)
  throw new Error(
    "缺少 DATABASE_URL。API 只支持 PostgreSQL，请在 .env 里配置，例如 postgres://postgres@127.0.0.1:55432/choke",
  )
}

const created = await createDb()

export const db = created.db
/** 仅 PostgreSQL 模式存在。 */
export const sql = created.sql
/** 仅测试脚本的临时 PGlite 存在。 */
export const client = created.client
