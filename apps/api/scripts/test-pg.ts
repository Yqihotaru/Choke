/**
 * 把需要数据库的测试在真 PostgreSQL 上再跑一遍（PGlite 和真库有细微差别，
 * 例如 Date 参数在 postgres-js 上会报错，PGlite 不会）。
 *
 * 服务器地址取 .env 里的 DATABASE_URL；每个测试各自现建、跑完删掉一个 choke_test_* 临时库，
 * 不会改动开发库里的数据。也可以自己设 TEST_DATABASE_URL 指向别的服务器。
 *
 *   pnpm test:pg
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "../../..")
const envFile = path.join(root, ".env")
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)

const adminUrl = process.env.TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim()
if (!adminUrl) {
  console.error("缺少 DATABASE_URL（.env）或 TEST_DATABASE_URL，没法连真 PostgreSQL。")
  process.exit(1)
}

const tests = ["mail", "quests", "ledger", "expedition-run", "admin"]
for (const name of tests) {
  console.log(`\n=== ${name}（真 PostgreSQL）===`)
  const result = spawnSync(process.execPath, ["--import", "tsx", path.join(import.meta.dirname, `test-${name}.ts`)], {
    stdio: "inherit",
    cwd: path.join(root, "apps/api"),
    env: { ...process.env, TEST_DATABASE_URL: adminUrl },
  })
  if (result.status !== 0) {
    console.error(`\ntest-${name} 在真 PostgreSQL 上失败`)
    process.exit(result.status ?? 1)
  }
}
console.log("\n真 PostgreSQL 上全部通过")
