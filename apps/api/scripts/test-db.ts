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
import path from "node:path"

import postgres from "postgres"

export const usingRealPostgres = Boolean(process.env.TEST_DATABASE_URL?.trim())

export async function setupTestDb(name: string): Promise<() => Promise<void>> {
  const adminUrl = process.env.TEST_DATABASE_URL?.trim()

  if (!adminUrl) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `choke-${name}-test-`))
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
