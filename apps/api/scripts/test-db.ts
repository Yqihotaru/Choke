/**
 * 数据库测试的建库 / 清理。
 *
 * 默认：临时 PGlite 数据目录，跑完删掉。
 * 设了 TEST_DATABASE_URL（一个能建库的 PostgreSQL 连接串）：在那台服务器上现建一个
 * choke_test_* 临时库来跑，跑完整库删掉；不会碰开发库里的数据。
 *
 * 必须在 import ../src/db/client 之前调用。
 */
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import { createRequire } from "node:module"
import path from "node:path"

import postgres from "postgres"

export const usingRealPostgres = Boolean(process.env.TEST_DATABASE_URL?.trim())

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../migrations")
const TEMPLATE_PREFIX = "choke-pglite-template-"

/** 模板的名字：迁移文件内容 + PGlite 版本一变，名字就变，旧模板自动作废 */
function templateKey(): string {
  const hash = crypto.createHash("sha1")
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql")).sort()) {
    hash.update(file)
    hash.update(fs.readFileSync(path.join(MIGRATIONS_DIR, file)))
  }
  let dir = path.dirname(createRequire(import.meta.url).resolve("@electric-sql/pglite"))
  while (dir !== path.dirname(dir) && !fs.existsSync(path.join(dir, "package.json"))) dir = path.dirname(dir)
  hash.update(String(JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version))
  return hash.digest("hex").slice(0, 12)
}

/**
 * 迁移只跑一次：建一个已经迁移好的 PGlite 数据目录当模板（放在系统临时目录里，跨次复用），
 * 每个测试直接复制一份，省掉每个测试各自启动加跑迁移的几秒。
 * 多个进程同时来建也没事：各建各的，最后用目录重命名抢位置（原子的），输的那份删掉。
 */
export async function ensureTemplate(): Promise<string> {
  const final = path.join(os.tmpdir(), `${TEMPLATE_PREFIX}${templateKey()}`)
  if (fs.existsSync(final)) return final

  const building = `${final}.building-${process.pid}-${crypto.randomBytes(3).toString("hex")}`
  const { PGlite } = await import("@electric-sql/pglite")
  const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm")
  const { runMigrations } = await import("../src/db/migrate")
  const client = await PGlite.create(building, { extensions: { pg_trgm } })
  const log = console.log
  console.log = () => {}
  try {
    await runMigrations({
      exec: (statement) => client.exec(statement).then(() => undefined),
      query: async <T = unknown>(text: string, params?: unknown[]) => (await client.query<T>(text, params)).rows,
    })
  } finally {
    console.log = log
  }
  await client.close()

  try {
    fs.renameSync(building, final)
  } catch {
    fs.rmSync(building, { recursive: true, force: true })
    if (!fs.existsSync(final)) throw new Error("建测试库模板失败")
  }
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (entry.startsWith(TEMPLATE_PREFIX) && !entry.startsWith(`${TEMPLATE_PREFIX}${templateKey()}`)) {
      fs.rmSync(path.join(os.tmpdir(), entry), { recursive: true, force: true })
    }
  }
  return final
}

export async function setupTestDb(name: string): Promise<() => Promise<void>> {
  const adminUrl = process.env.TEST_DATABASE_URL?.trim()

  if (!adminUrl) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `choke-${name}-test-`))
    fs.cpSync(await ensureTemplate(), dataDir, { recursive: true })
    process.env.DATABASE_URL = ""
    process.env.PG_DATA_DIR = dataDir
    return async () => {
      const { client } = await import("../src/db/client")
      await client?.close().catch(() => {})
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  }

  const dbName = `choke_test_${name.replace(/[^a-z0-9]/gi, "_")}_${crypto.randomBytes(4).toString("hex")}`
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} })
  await admin.unsafe(`CREATE DATABASE "${dbName}"`)
  const url = new URL(adminUrl)
  url.pathname = `/${dbName}`
  process.env.DATABASE_URL = url.toString()
  process.env.PG_DATA_DIR = ""
  return async () => {
    const { sql } = await import("../src/db/client")
    await sql?.end({ timeout: 5 }).catch(() => {})
    await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch((error) => {
      console.warn(`临时库 ${dbName} 没删掉，请手动删除：`, error)
    })
    await admin.end({ timeout: 5 }).catch(() => {})
  }
}
