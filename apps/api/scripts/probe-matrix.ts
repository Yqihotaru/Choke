// pnpm --filter @choke/api exec tsx scripts/probe-matrix.ts [每队局数=10] [遭遇id,遭遇id…]
//
// 流派探针矩阵（调数值用，不进 pnpm test）：把 lib/archetypes.ts 的积木（前排 × 输出包 × 辅助）全排列，
// 每支队伍打每场遭遇，输出：
//   1. 输出包 × 遭遇 的胜率（对前排和辅助取平均）：写新 BOSS 后一眼看出"是不是只有一种打法能过"
//   2. 哪些遭遇被所有流派打穿（>90%）或没有任何流派打得过（<10%）
//   3. 哪些流派在所有遭遇里都明显偏强或偏弱
// 只看胜负，不做重放校验；结果按遭遇名排序，同参数每次输出相同。
import os from "node:os"
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads"

import { resolveEncounter } from "@choke/shared/battle/content"

import { BATTLE_CONTENT } from "../src/content"
import { DAMAGE, FRONT, PROBE_LABEL, SUPPORT, buildTeam } from "./lib/archetypes"
import { playBot } from "./lib/battle-bot"

const seedsPerTeam = Math.max(1, Number(process.argv[2]) || 10)
const onlyIds = process.argv[3]?.split(",").filter(Boolean)

type Cell = { won: number; total: number }
/** 输出包 → 胜负 */
type EncounterResult = Record<string, Cell>

function runEncounter(encounterId: string, seeds: number): EncounterResult {
  const encounter = resolveEncounter(BATTLE_CONTENT, encounterId)!
  const result: EncounterResult = {}
  let uid = 5000
  for (const damage of Object.keys(DAMAGE)) {
    const cell = (result[damage] = { won: 0, total: 0 })
    for (const front of Object.keys(FRONT)) {
      for (const support of Object.keys(SUPPORT)) {
        const deck = buildTeam({ front, damage, support }, (uid += 10))
        for (let n = 0; n < seeds; n += 1) {
          const { state } = playBot(encounter, deck, `matrix-${encounterId}/${damage}/${front}/${support}/${n}`)
          cell.total += 1
          if (state.phase === "won") cell.won += 1
        }
      }
    }
  }
  return result
}

if (!isMainThread) {
  parentPort!.on("message", (id: string) => parentPort!.postMessage({ id, result: runEncounter(id, workerData.seeds) }))
}

async function runAll(ids: string[], workers: number): Promise<Map<string, EncounterResult>> {
  const outputs = new Map<string, EncounterResult>()
  const queue = [...ids]
  const pool: Worker[] = []
  await new Promise<void>((resolve, reject) => {
    const next = (worker: Worker) => {
      const id = queue.shift()
      if (id !== undefined) worker.postMessage(id)
      else if (outputs.size === ids.length) resolve()
    }
    for (let i = 0; i < workers; i += 1) {
      const worker = new Worker(import.meta.filename, { execArgv: process.execArgv, workerData: { seeds: seedsPerTeam } })
      pool.push(worker)
      worker.on("message", (message: { id: string; result: EncounterResult }) => {
        outputs.set(message.id, message.result)
        next(worker)
      })
      worker.on("error", reject)
      next(worker)
    }
  })
  await Promise.all(pool.map((worker) => worker.terminate()))
  return outputs
}

const pct = (cell: Cell) => Math.round((cell.won / cell.total) * 100)

async function main() {
  const started = Date.now()
  const all = Object.keys(BATTLE_CONTENT.encounters).sort()
  const ids = onlyIds ? all.filter((id) => onlyIds.includes(id)) : all
  if (ids.length === 0) {
    console.error(`没有这些遭遇：${onlyIds?.join("、")}`)
    process.exit(1)
  }
  const workers = Math.max(1, Math.min(os.availableParallelism(), 8, ids.length))
  const outputs = await runAll(ids, workers)

  const damages = Object.keys(DAMAGE)
  const teams = damages.length * Object.keys(FRONT).length * Object.keys(SUPPORT).length
  console.log(`${teams} 支队伍 × ${ids.length} 场遭遇 × ${seedsPerTeam} 局 = ${teams * ids.length * seedsPerTeam} 局\n`)

  const table: Record<string, Record<string, string>> = {}
  for (const id of ids) {
    const row: Record<string, string> = {}
    for (const damage of damages) row[PROBE_LABEL[damage] ?? damage] = `${pct(outputs.get(id)![damage]!)}%`
    const cells = damages.map((d) => outputs.get(id)![d]!)
    row["全体"] = `${pct({ won: cells.reduce((s, c) => s + c.won, 0), total: cells.reduce((s, c) => s + c.total, 0) })}%`
    table[id] = row
  }
  console.log("胜率（输出包 × 遭遇，对前排与辅助取平均）")
  console.table(table)

  const overall = (id: string) => {
    const cells = damages.map((d) => outputs.get(id)![d]!)
    return pct({ won: cells.reduce((s, c) => s + c.won, 0), total: cells.reduce((s, c) => s + c.total, 0) })
  }
  const crushed = ids.filter((id) => damages.every((d) => pct(outputs.get(id)![d]!) > 90))
  const walled = ids.filter((id) => damages.every((d) => pct(outputs.get(id)![d]!) < 10))
  const narrow = ids.filter((id) => {
    const winners = damages.filter((d) => pct(outputs.get(id)![d]!) >= 30)
    return winners.length === 1 && overall(id) < 60
  })
  console.log(`\n被所有流派打穿（每个流派都 >90%）：${crushed.join("、") || "无"}`)
  console.log(`没有任何流派打得过（每个流派都 <10%）：${walled.join("、") || "无"}`)
  console.log(`只有一个流派打得过（该流派 ≥30%，其余都 <30%）：${narrow.map((id) => `${id}（${damages.filter((d) => pct(outputs.get(id)![d]!) >= 30).map((d) => PROBE_LABEL[d] ?? d).join("")}）`).join("、") || "无"}`)

  console.log("\n各流派在全部遭遇上的平均胜率：")
  for (const damage of damages) {
    const cells = ids.map((id) => outputs.get(id)![damage]!)
    const avg = pct({ won: cells.reduce((s, c) => s + c.won, 0), total: cells.reduce((s, c) => s + c.total, 0) })
    console.log(`  ${(PROBE_LABEL[damage] ?? damage).padEnd(6, "　")} ${String(avg).padStart(3)}%`)
  }
  console.log(`\n用时 ${((Date.now() - started) / 1000).toFixed(1)}s（${workers} 线程）`)
}

if (isMainThread) await main()
