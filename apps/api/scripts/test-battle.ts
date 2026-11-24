// pnpm test:battle [--update]
//
// 战斗回归测试：content/encounters 里的每场遭遇 × 三套通用卡组（每套 30 个固定种子）
// ＋ 6 支流派队（lib/archetypes.ts，每队 2 个种子，约占总局数 12%），用固定策略的机器人打完，检查
//   1. 确定性：同种子同操作打两遍，状态逐位相同
//   2. 可重放：replayBattle 复算的终局与实打相同（服务端校验靠的就是这个）
//   3. 回归：每局的回合数、步数、终局摘要与 fixtures/battle-golden.json 一致
//
// 有意改动了引擎数值或战斗内容 → 跑 `pnpm test:battle --update` 重录基准，并在提交里说明为什么变了。
// 没打算改却对不上 → 说明改动影响了战斗结果，先查清楚再更新基准。
//
// 每场遭遇互不相干，所以分给多个 worker 线程并行跑（每个遭遇一个任务，空闲的 worker 领下一个）；
// 结果按遭遇名排好序再合并，输出和基准文件的内容与顺序跟单线程时完全一样。
// 用 BATTLE_WORKERS=1 可以退回单线程（排查问题时用）。
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Worker, isMainThread, parentPort } from "node:worker_threads"

import { replayBattle } from "@choke/shared/battle/actions"
import { resolveEncounter } from "@choke/shared/battle/content"
import { evaluateStars } from "@choke/shared/battle/stars"
import type { BattleState } from "@choke/shared/battle/types"

import { BATTLE_CONTENT } from "../src/content"
import { PROBE_DECKS, PROBE_LABEL } from "./lib/archetypes"
import { BENCH, DECKS, MAX_TURNS, playBot, testApMax } from "./lib/battle-bot"

const GOLDEN = path.resolve(import.meta.dirname, "fixtures/battle-golden.json")
const SEEDS_PER_DECK = 30
/** 流派队每队每场遭遇打几局：6 队 × 2 局，约占总局数的 12% */
const SEEDS_PER_PROBE = 2
const update = process.argv.includes("--update")

const digest = (state: BattleState) => createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 16)

interface GoldenEntry {
  phase: string
  turn: number
  actions: number
  stars: number
  digest: string
}
interface TableRow {
  胜: number
  负: number
  平均回合: string
  平均星数: string
}
/** 一场遭遇跑完的全部产出（要能在线程之间传，所以只放纯数据） */
interface EncounterOutput {
  results: Record<string, GoldenEntry>
  problems: string[]
  stalled: string[]
  table: Record<string, TableRow>
  /** 这场遭遇里每支流派队的胜场，如 "1/2" */
  probeRow: Record<string, string>
}

// ---------- 跑一场遭遇 ----------

function runEncounter(encounterId: string): EncounterOutput {
  const out: EncounterOutput = { results: {}, problems: [], stalled: [], table: {}, probeRow: {} }
  const encounter = resolveEncounter(BATTLE_CONTENT, encounterId)!
  const groups = [
    ...Object.entries(DECKS).map(([name, deck]) => ({ deckName: name, deck, seeds: SEEDS_PER_DECK, probe: false })),
    ...Object.entries(PROBE_DECKS).map(([name, deck]) => ({ deckName: `probe-${name}`, deck, seeds: SEEDS_PER_PROBE, probe: true })),
  ]
  for (const { deckName, deck, seeds, probe } of groups) {
    let won = 0
    let turns = 0
    let stars = 0
    for (let n = 0; n < seeds; n += 1) {
      const key = `${encounterId}/${deckName}/${n}`
      const seed = `test-${key}`
      const a = playBot(encounter, deck, seed)
      const b = playBot(encounter, deck, seed)
      const live = JSON.stringify(a.state)
      if (live !== JSON.stringify(b.state)) out.problems.push(`${key}：同种子打两遍结果不同（引擎里有不走种子的随机或依赖外部状态）`)
      const replay = replayBattle({ encounter, cards: deck, bench: BENCH, seed, apMax: testApMax(deck) }, a.actions)
      if (replay.invalidAt !== null) out.problems.push(`${key}：重放第 ${replay.invalidAt} 步不合法：${replay.error}`)
      else if (live !== JSON.stringify(replay.state)) out.problems.push(`${key}：重放结果与实打不同`)
      /** 拖满回合上限仍没分出胜负的局：弱卡组打硬壳 BOSS 可能出现的僵局，是数值现象不是引擎错误，只提示 */
      if (a.state.phase === "player") out.stalled.push(key)

      const rating = evaluateStars(a.state)
      const starCount = a.state.phase === "won" ? rating.count : 0
      out.results[key] = { phase: a.state.phase, turn: a.state.turn, actions: a.actions.length, stars: starCount, digest: digest(a.state) }
      if (a.state.phase === "won") won += 1
      turns += a.state.turn
      stars += starCount
    }
    if (probe) {
      out.probeRow[PROBE_LABEL[deckName.replace(/^probe-/, "")] ?? deckName] = `${won}/${seeds}`
      continue
    }
    out.table[`${encounterId}/${deckName}`] = {
      胜: won,
      负: seeds - won,
      平均回合: (turns / seeds).toFixed(1),
      平均星数: won ? (stars / won).toFixed(2) : "—",
    }
  }
  return out
}

// ---------- worker 一侧：收到遭遇名就跑，跑完回传 ----------

if (!isMainThread) {
  parentPort!.on("message", (encounterId: string) => {
    parentPort!.postMessage({ encounterId, out: runEncounter(encounterId) })
  })
}

// ---------- 主线程：分发任务、合并、对基准 ----------

/** 把所有遭遇分给 workers 个线程跑；workers ≤ 1 就在本线程里顺序跑 */
async function runAll(ids: string[], workers: number): Promise<Map<string, EncounterOutput>> {
  const outputs = new Map<string, EncounterOutput>()
  if (workers <= 1) {
    for (const id of ids) outputs.set(id, runEncounter(id))
    return outputs
  }
  const queue = [...ids]
  const pool: Worker[] = []
  await new Promise<void>((resolve, reject) => {
    const next = (worker: Worker) => {
      const id = queue.shift()
      if (id !== undefined) worker.postMessage(id)
      else if (outputs.size === ids.length) resolve()
    }
    for (let i = 0; i < workers; i += 1) {
      const worker = new Worker(import.meta.filename, { execArgv: process.execArgv })
      pool.push(worker)
      worker.on("message", (message: { encounterId: string; out: EncounterOutput }) => {
        outputs.set(message.encounterId, message.out)
        next(worker)
      })
      worker.on("error", reject)
      next(worker)
    }
  })
  await Promise.all(pool.map((worker) => worker.terminate()))
  return outputs
}

async function main() {
  const started = Date.now()
  const ids = Object.keys(BATTLE_CONTENT.encounters).sort()
  const workers = Math.max(1, Math.min(Number(process.env.BATTLE_WORKERS) || os.availableParallelism(), 8, ids.length))
  const outputs = await runAll(ids, workers)

  const results: Record<string, GoldenEntry> = {}
  const problems: string[] = []
  const stalled: string[] = []
  const table: Record<string, TableRow> = {}
  const probeTable: Record<string, Record<string, string>> = {}
  for (const id of ids) {
    const out = outputs.get(id)!
    Object.assign(results, out.results)
    Object.assign(table, out.table)
    probeTable[id] = out.probeRow
    problems.push(...out.problems)
    stalled.push(...out.stalled)
  }

  console.table(table)
  console.log("\n流派队（每格 = 胜场/局数，样本小只做粗看；要细看跑 probe-matrix.ts）")
  console.table(probeTable)
  const probeRuns = Object.keys(results).filter((key) => key.includes("/probe-")).length
  console.log(`流派队 ${probeRuns} 局，占总 ${Object.keys(results).length} 局的 ${((probeRuns / Object.keys(results).length) * 100).toFixed(1)}%`)
  if (stalled.length > 0) console.log(`提示：${stalled.length} 局拖满 ${MAX_TURNS} 回合仍无胜负（僵局，不算失败）：${stalled.slice(0, 5).join("、")}${stalled.length > 5 ? "…" : ""}`)
  const total = Object.keys(results).length

  if (update) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true })
    fs.writeFileSync(GOLDEN, JSON.stringify(results, null, 1) + "\n")
    console.log(`已重录基准：${total} 局 → ${path.relative(process.cwd(), GOLDEN)}`)
  } else if (!fs.existsSync(GOLDEN)) {
    problems.push("没有基准文件，先跑 pnpm test:battle --update")
  } else {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, "utf8")) as Record<string, GoldenEntry>
    const changed: string[] = []
    for (const [key, entry] of Object.entries(results)) {
      const old = golden[key]
      if (!old) {
        changed.push(`${key}：基准里没有（新增的遭遇？）`)
        continue
      }
      if (old.digest !== entry.digest) {
        const what = [
          old.phase !== entry.phase && `${old.phase} → ${entry.phase}`,
          old.turn !== entry.turn && `回合 ${old.turn} → ${entry.turn}`,
          old.actions !== entry.actions && `步数 ${old.actions} → ${entry.actions}`,
          old.stars !== entry.stars && `星数 ${old.stars} → ${entry.stars}`,
        ].filter(Boolean)
        changed.push(`${key}：${what.length ? what.join("，") : "胜负/回合/步数都一样，但战斗过程有差别"}`)
      }
    }
    for (const key of Object.keys(golden)) if (!results[key]) changed.push(`${key}：基准里有，这次没跑（遭遇被删或改名？）`)
    if (changed.length > 0) {
      problems.push(
        `与基准不一致 ${changed.length} 局：\n    ${changed.slice(0, 15).join("\n    ")}${changed.length > 15 ? `\n    …另有 ${changed.length - 15} 局` : ""}\n` +
          "  有意改了数值或内容就跑 pnpm test:battle --update 重录；否则先查清楚哪里改动了战斗结果。",
      )
    }
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  if (problems.length > 0) {
    console.log(`\n✘ ${problems.length} 个问题（${total} 局，${seconds}s，${workers} 线程）：`)
    for (const p of problems.slice(0, 30)) console.log(`  ${p}`)
    process.exitCode = 1
  } else {
    console.log(`\n✔ ${total} 局：确定性、重放${update ? "" : "、基准"}全部通过（${seconds}s，${workers} 线程）`)
  }
}

if (isMainThread) await main()
