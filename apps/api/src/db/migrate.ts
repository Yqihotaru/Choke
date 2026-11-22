import fs from "node:fs"
import path from "node:path"

/**
 * 极简迁移器：migrations/*.sql 按文件名顺序执行，已执行过的记录在 schema_migrations。
 *
 * 规则（唯一真相来源）：
 * - 表结构的**运行时真相**是 migrations/*.sql；
 * - 表结构的**类型真相**是 db/schema.ts；
 * - 改结构 = 改 schema.ts + 新增一个 migration 文件，不再往 client.ts 里堆 ALTER。
 */
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../migrations")

export interface MigrationTarget {
  exec(sql: string): Promise<void>
  query<T = unknown>(text: string, params?: unknown[]): Promise<T[]>
}

export async function runMigrations(target: MigrationTarget): Promise<void> {
  await target.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `)

  if (!fs.existsSync(MIGRATIONS_DIR)) return

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()

  const appliedRows = await target.query<{ version: string }>(
    "SELECT version FROM schema_migrations",
  )
  const applied = new Set(appliedRows.map((row) => row.version))

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8")
    await target.exec("BEGIN")
    try {
      await target.exec(sql)
      await target.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file])
      await target.exec("COMMIT")
      console.log(`[migrate] applied ${file}`)
    } catch (error) {
      await target.exec("ROLLBACK")
      throw error
    }
  }
}
