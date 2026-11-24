// 并行跑全部测试：pnpm test（全部）/ pnpm test:fast（不含数据库和战斗基准）/ pnpm test:pg（数据库测试换真 PostgreSQL）
//
// 测试清单是自动发现的，不用手动登记：
//   - scripts/test-*.ts 里含 setupTestDb( 的 → 数据库测试（每个测试自己建临时库，互不相干，可以并行）
//   - test-battle.ts → 战斗基准（最慢，先开跑；它自己还会开多个线程）
//   - 其余 test-*.ts → 纯逻辑测试
//   - 另有 2 项静态检查：内容校验、技能总表是否过期
// 新写一个 scripts/test-xxx.ts 就会自动被跑到，不会再漏。
//
// 参数：
//   --fast          只跑静态检查和纯逻辑测试（几秒，日常改动先用这个）
//   --db            只跑数据库测试
//   --pg            数据库测试改在真 PostgreSQL 上跑（连接串取 .env 的 DATABASE_URL，或 TEST_DATABASE_URL）
//   --only a,b      只跑名字在列表里的（名字见输出，如 skills,mail,battle）
//   --serial        一次只跑一个（排查测试之间互相影响时用）
//   --jobs N        同时跑 N 个（默认 min(核数, 6)）
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const SCRIPTS = import.meta.dirname
const API_DIR = path.resolve(SCRIPTS, "..")
const ROOT = path.resolve(API_DIR, "../..")

type Kind = "check" | "unit" | "db" | "battle"
interface Task {
  name: string
  kind: Kind
  file: string
  args: string[]
}

const NOT_TESTS = new Set(["test-db.ts"])

function discover(): Task[] {
  const tasks: Task[] = [
    { name: "content-check", kind: "check", file: "check-content.ts", args: [] },
    { name: "skill-docs", kind: "check", file: "gen-skill-table.ts", args: ["--check"] },
  ]
  for (const file of fs.readdirSync(SCRIPTS).filter((f) => /^test-.+\.ts$/.test(f) && !NOT_TESTS.has(f) && f !== "test-pg.ts").sort()) {
    const name = file.replace(/^test-/, "").replace(/\.ts$/, "")
    const source = fs.readFileSync(path.join(SCRIPTS, file), "utf8")
    const kind: Kind = name === "battle" ? "battle" : source.includes("setupTestDb(") ? "db" : "unit"
    tasks.push({ name, kind, file, args: [] })
  }
  return tasks
}

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(name)
const valueOf = (name: string) => {
  const at = argv.indexOf(name)
  return at >= 0 ? argv[at + 1] : undefined
}

let tasks = discover()
const env: NodeJS.ProcessEnv = { ...process.env }
if (flag("--pg")) {
  const envFile = path.join(ROOT, ".env")
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
  const adminUrl = process.env.TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim()
  if (!adminUrl) {
    console.error("缺少 DATABASE_URL（.env）或 TEST_DATABASE_URL，没法连真 PostgreSQL。")
    process.exit(1)
  }
  env.TEST_DATABASE_URL = adminUrl
  tasks = tasks.filter((t) => t.kind === "db")
} else if (flag("--db")) tasks = tasks.filter((t) => t.kind === "db")
else if (flag("--fast")) tasks = tasks.filter((t) => t.kind === "check" || t.kind === "unit")

const only = valueOf("--only")
if (only) {
  const wanted = new Set(only.split(",").map((s) => s.trim()))
  const unknown = [...wanted].filter((n) => !tasks.some((t) => t.name === n))
  if (unknown.length > 0) {
    console.error(`没有这些测试：${unknown.join("、")}。可选：${tasks.map((t) => t.name).join("、")}`)
    process.exit(1)
  }
  tasks = tasks.filter((t) => wanted.has(t.name))
}

// 慢的先开跑，整体收尾最快
const ORDER: Kind[] = ["battle", "db", "unit", "check"]
tasks.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.name.localeCompare(b.name))

const jobs = flag("--serial") ? 1 : Math.max(1, Number(valueOf("--jobs")) || Math.min(os.availableParallelism(), 6))

interface Outcome {
  task: Task
  seconds: number
  code: number
  output: string
}

function run(task: Task): Promise<Outcome> {
  const started = Date.now()
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", path.join(SCRIPTS, task.file), ...task.args], { cwd: API_DIR, env })
    let output = ""
    child.stdout.on("data", (chunk) => (output += chunk))
    child.stderr.on("data", (chunk) => (output += chunk))
    child.on("close", (code) => resolve({ task, seconds: (Date.now() - started) / 1000, code: code ?? 1, output }))
  })
}

const begun = Date.now()
const outcomes: Outcome[] = []
const queue = [...tasks]
async function worker() {
  for (let task = queue.shift(); task; task = queue.shift()) {
    const outcome = await run(task)
    outcomes.push(outcome)
    console.log(`${outcome.code === 0 ? "✔" : "✘"} ${task.name.padEnd(16)} ${outcome.seconds.toFixed(1).padStart(5)}s`)
  }
}
console.log(`并行跑 ${tasks.length} 项测试（同时 ${jobs} 项）${flag("--pg") ? "，数据库测试用真 PostgreSQL" : ""}`)
if (!flag("--pg") && tasks.some((t) => t.kind === "db")) {
  // 迁移好的空库模板先建一次（已有就是瞬间），数据库测试各自复制一份
  const { ensureTemplate } = await import("./test-db")
  const warm = Date.now()
  await ensureTemplate()
  const took = (Date.now() - warm) / 1000
  if (took > 0.5) console.log(`  测试库模板已重建（${took.toFixed(1)}s，迁移有变化时才会重建）`)
}
await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, worker))

const failed = outcomes.filter((o) => o.code !== 0)
const wall = (Date.now() - begun) / 1000
const serial = outcomes.reduce((sum, o) => sum + o.seconds, 0)
for (const o of failed) {
  const lines = o.output.trimEnd().split(/\r?\n/)
  console.log(`\n──── ${o.task.name} 失败（退出码 ${o.code}），输出末尾 ${Math.min(60, lines.length)} 行 ────`)
  console.log(lines.slice(-60).join("\n"))
}
console.log(`\n${failed.length === 0 ? "全部通过" : `失败 ${failed.length} 项：${failed.map((o) => o.task.name).join("、")}`}：共 ${outcomes.length} 项，用时 ${wall.toFixed(1)}s（逐项累加 ${serial.toFixed(1)}s）`)
process.exit(failed.length === 0 ? 0 : 1)
