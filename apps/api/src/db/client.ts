import fs from "node:fs"
import path from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"
import { drizzle as drizzlePglite } from "drizzle-orm/pglite"
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { runMigrations, type MigrationTarget } from "./migrate"
import * as schema from "./schema"

/**
 * 数据库连接。
 *
 * - 设置了 `DATABASE_URL`（如 postgres://user:pass@localhost:5432/choke）→ 真 PostgreSQL。
 *   多连接、WAL、崩溃恢复，推荐日常开发与线上。
 * - 没设置 → 回落到 PGlite（单进程嵌入式），仅用于临时跑一下。
 *
 * PGlite 是单进程写库，进程被强杀可能写坏；需要稳定就配 DATABASE_URL。
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

function pgliteTarget(client: PGlite): MigrationTarget {
  return {
    exec: (sql) => client.exec(sql).then(() => undefined),
    query: async <T = unknown>(text: string, params?: unknown[]) => {
      const result = await client.query<T>(text, params)
      return result.rows
    },
  }
}

function postgresTarget(sql: postgres.Sql): MigrationTarget {
  return {
    exec: async (statement) => {
      await sql.unsafe(statement)
    },
    query: async <T = unknown>(text: string, params?: unknown[]) =>
      (await sql.unsafe(text, (params ?? []) as never[])) as unknown as T[],
  }
}

async function createDb() {
  if (databaseUrl) {
    const sql = postgres(databaseUrl, { max: 10, onnotice: () => {} })
    await runMigrations(postgresTarget(sql))
    return { db: drizzlePostgres(sql, { schema }), sql, kind: "postgres" as const }
  }

  const dataDir = path.resolve(process.env.PG_DATA_DIR ?? "./.data/pg")
  fs.mkdirSync(dataDir, { recursive: true })
  const client = await PGlite.create(dataDir, { extensions: { pg_trgm } })
  await runMigrations(pgliteTarget(client))
  return { db: drizzlePglite(client, { schema }), client, kind: "pglite" as const }
}

const created = await createDb()

// 两种后端的方法签名一致，统一成 Postgres 的类型，避免联合类型破坏 db.transaction 的重载。
export const db = created.db as PostgresJsDatabase<typeof schema>
export const dbKind = created.kind
/** 仅 PGlite 模式存在；Postgres 模式为 undefined。 */
export const client = created.kind === "pglite" ? created.client : undefined
export const sql = created.kind === "postgres" ? created.sql : undefined
