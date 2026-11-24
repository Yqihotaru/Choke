// pnpm --filter @choke/api exec tsx scripts/analyze-archetypes.ts [每队局数=10] [--write <markdown 路径>]
//
// 流派数据报告（调数值用，不进 pnpm test）：和 probe-matrix.ts 同一批队伍与遭遇，每个队伍用两种机器人策略各打一遍：
//   firstFit：每张卡放第一个能放的主动技能（所有基准用的策略，大招容易被小技能饿死）
//   burst：按 AP 从高到低放，队里有 3 AP 以上大招而 AP 不够时本回合只放 0 AP 技能，把 AP 攒下来
// 统计：输出包的胜率 / 胜局回合 / 每回合伤害 / 每 AP 伤害 / 回合结算占比，每个技能的使用与伤害，
// 前排与辅助积木胜率，敌人面板与各包胜率。
// 伤害按战斗事件里打在敌人身上的 damage 累计；主动技能的伤害记到该技能，回合结束时发生的记到"回合结算"。
// 同参数输出逐字节相同，所以可以放心提交到 Design/ 里做对比。
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads"

import { resolveEncounter } from "@choke/shared/battle/content"
import { SKILLS } from "@choke/shared/skills"

import { BATTLE_CONTENT } from "../src/content"
import { DAMAGE, FRONT, PROBE_LABEL, SUPPORT, buildTeam } from "./lib/archetypes"
import { playBot } from "./lib/battle-bot"

const args = process.argv.slice(2)
const writeAt = args.indexOf("--write")
const outFile = writeAt >= 0 ? args[writeAt + 1] : undefined
const seedsPerTeam = Math.max(1, Number(args.find((a, i) => !a.startsWith("--") && i !== writeAt + 1)) || 10)

const SETTLE = "(回合结算)"
type Policy = "firstFit" | "burst"
const POLICIES: Policy[] = ["firstFit", "burst"]

interface SkillAgg {
  uses: number
  damage: number
}
interface Agg {
  runs: number
  wins: number
  turnsWon: number
  turnsAll: number
  damage: number
  apSpent: number
  maxCombo: number
  downs: number
  skills: Record<string, SkillAgg>
}
interface EnemyInfo {
  name: string
  tier: string
  element: string
  weaknesses: string[]
  hpMax: number
  atk: number
  def: number
}
interface EncounterResult {
  info: EnemyInfo
  byDamage: Record<string, Agg>
  byFront: Record<string, { runs: number; wins: number }>
  bySupport: Record<string, { runs: number; wins: number }>
}

const emptyAgg = (): Agg => ({ runs: 0, wins: 0, turnsWon: 0, turnsAll: 0, damage: 0, apSpent: 0, maxCombo: 0, downs: 0, skills: {} })

function runEncounter(encounterId: string, seeds: number, policy: Policy): EncounterResult {
  const encounter = resolveEncounter(BATTLE_CONTENT, encounterId)!
  const result: EncounterResult = {
    info: { name: "", tier: "", element: "", weaknesses: [], hpMax: 0, atk: 0, def: 0 },
    byDamage: {},
    byFront: {},
    bySupport: {},
  }
  let uid = 5000
  for (const damage of Object.keys(DAMAGE)) {
    const agg = (result.byDamage[damage] = emptyAgg())
    for (const front of Object.keys(FRONT)) {
      for (const support of Object.keys(SUPPORT)) {
        const deck = buildTeam({ front, damage, support }, (uid += 10))
        const f = (result.byFront[front] ??= { runs: 0, wins: 0 })
        const s = (result.bySupport[support] ??= { runs: 0, wins: 0 })
        for (let n = 0; n < seeds; n += 1) {
          const { state } = playBot(encounter, deck, `matrix-${encounterId}/${damage}/${front}/${support}/${n}`, undefined, {
            policy,
            onAction: (after, action) => {
              const bucket = action.type === "skill" ? action.skill : SETTLE
              let dealt = 0
              for (const event of after.events) if (event.type === "damage" && event.target === "enemy") dealt += event.amount
              const entry = (agg.skills[bucket] ??= { uses: 0, damage: 0 })
              if (action.type === "skill") entry.uses += 1
              entry.damage += dealt
              agg.damage += dealt
            },
          })
          const won = state.phase === "won"
          agg.runs += 1
          f.runs += 1
          s.runs += 1
          if (won) {
            agg.wins += 1
            f.wins += 1
            s.wins += 1
            agg.turnsWon += state.turn
          }
          agg.turnsAll += state.turn
          agg.apSpent += state.apSpentTotal
          agg.maxCombo += state.maxCombo
          agg.downs += state.downCount
          const e = state.enemy
          result.info = { name: e.name, tier: e.tier, element: e.element, weaknesses: [...e.weaknesses], hpMax: e.hpMax, atk: e.atk, def: e.def }
        }
      }
    }
  }
  return result
}

if (!isMainThread) {
  parentPort!.on("message", (m: { id: string; policy: Policy }) =>
    parentPort!.postMessage({ ...m, result: runEncounter(m.id, workerData.seeds, m.policy) }),
  )
}

async function runAll(ids: string[], workers: number): Promise<Record<Policy, Map<string, EncounterResult>>> {
  const outputs: Record<Policy, Map<string, EncounterResult>> = { firstFit: new Map(), burst: new Map() }
  const queue = POLICIES.flatMap((policy) => ids.map((id) => ({ id, policy })))
  const total = queue.length
  let done = 0
  const pool: Worker[] = []
  await new Promise<void>((resolve, reject) => {
    const next = (worker: Worker) => {
      const task = queue.shift()
      if (task) worker.postMessage(task)
      else if (done === total) resolve()
    }
    for (let i = 0; i < workers; i += 1) {
      const worker = new Worker(import.meta.filename, { execArgv: process.execArgv, workerData: { seeds: seedsPerTeam } })
      pool.push(worker)
      worker.on("message", (message: { id: string; policy: Policy; result: EncounterResult }) => {
        outputs[message.policy].set(message.id, message.result)
        done += 1
        next(worker)
      })
      worker.on("error", reject)
      next(worker)
    }
  })
  await Promise.all(pool.map((worker) => worker.terminate()))
  return outputs
}

const pct = (a: number, b: number) => (b === 0 ? "—" : `${Math.round((a / b) * 100)}%`)
const int = (n: number) => Math.round(n).toLocaleString("en-US")
const label = (key: string) => PROBE_LABEL[key] ?? key
type SkillInfo = { name: string; job?: string; ap?: number; passive?: boolean }
const SK = SKILLS as Record<string, SkillInfo>
const skillName = (id: string) => (id === SETTLE ? SETTLE : (SK[id]?.name ?? id))
const POLICY_NAME: Record<Policy, string> = { firstFit: "常规", burst: "攒大招" }

function sumAgg(parts: Agg[]): Agg {
  const t = emptyAgg()
  for (const a of parts) {
    t.runs += a.runs
    t.wins += a.wins
    t.turnsWon += a.turnsWon
    t.turnsAll += a.turnsAll
    t.damage += a.damage
    t.apSpent += a.apSpent
    t.maxCombo += a.maxCombo
    t.downs += a.downs
    for (const [skill, s] of Object.entries(a.skills)) {
      const e = (t.skills[skill] ??= { uses: 0, damage: 0 })
      e.uses += s.uses
      e.damage += s.damage
    }
  }
  return t
}

async function main() {
  const started = Date.now()
  const ids = Object.keys(BATTLE_CONTENT.encounters).sort()
  const workers = Math.max(1, Math.min(os.availableParallelism(), 8, ids.length * 2))
  const outputs = await runAll(ids, workers)
  const damages = Object.keys(DAMAGE)
  const lines: string[] = []
  const out = (text = "") => lines.push(text)

  const runsPerPackagePerEncounter = Object.keys(FRONT).length * Object.keys(SUPPORT).length * seedsPerTeam
  const total: Record<Policy, Record<string, Agg>> = { firstFit: {}, burst: {} }
  for (const policy of POLICIES) {
    for (const d of damages) total[policy][d] = sumAgg(ids.map((id) => outputs[policy].get(id)!.byDamage[d]!))
  }

  out("# 流派数据报告 v0.1（自动生成）")
  out()
  out("> 由 `apps/api/scripts/analyze-archetypes.ts` 生成，重跑命令见文末。改了技能、引擎数值或战斗内容后重跑，对比两版即可看出影响。")
  out()
  out("## 0. 这份数据是什么")
  out()
  out("- **队伍**：前排 3 种 × 输出包 7 种 × 辅助 3 种 = 63 支，每队 4 张卡，统一 **L 品质、60 级、3 命座**，每张卡 2 个技能（构成见 `scripts/lib/archetypes.ts`）。")
  out(`- **对手**：\`content/encounters\` 里全部 ${ids.length} 场遭遇。每支队每场遭遇每种策略打 ${seedsPerTeam} 个固定种子，共 ${63 * ids.length * seedsPerTeam * 2} 局。`)
  out("- **两种机器人策略**（都不会选目标、不看敌人意图、不会打断、不会换位，所以反映的是技能的稳定输出，不是高手玩法）：")
  out("  - **常规**（firstFit）：倒下的换替补；每 3 回合升 1 档防御；每张卡从左到右放第一个能放的主动技能。所有战斗基准都用它。**缺点**：AP 每回合只 +2，前排和辅助的 1 AP 技能先把 AP 花掉，3 AP 以上的大招几乎放不出来。")
  out("  - **攒大招**（burst）：同上，但按 AP 从高到低放；队里有 3 AP 以上的大招而当前 AP 不够时，本回合只放 0 AP 技能，把 AP 攒下来。它更接近会管理 AP 的玩家，但会放弃 1 AP 的增益和治疗。")
  out("- **注意**：队伍是 L 品质 60 级，**不代表新手一周内的真实卡组**（一周内很难集齐满技能 L 卡）。用途是同一强度下横向比较流派，不是评估新手期难度。")
  out("- 表里每个包的成员里还带着替补（战斗基准固定的 2 张替补：乱砍初阶/次阶、薄霜），所以「快砍」「薄霜」出现在所有包里，是倒下换人造成的。")
  out("- 伤害 = 战斗事件里打在敌人身上的 damage 总和；回合结束时发生的（抢攻、持续伤害、支援连击）记到「回合结算」。")
  out()

  out("## 1. 输出包总览（63 队 × 全部遭遇，对前排和辅助取平均）")
  out()
  out("| 输出包 | 策略 | 胜率 | 胜局平均回合 | 每回合伤害 | 每 AP 伤害 | 回合结算占比 | 平均最大 Combo | 平均倒下次数 |")
  out("|---|---|---:|---:|---:|---:|---:|---:|---:|")
  for (const d of damages) {
    for (const policy of POLICIES) {
      const t = total[policy][d]!
      const settle = t.skills[SETTLE]?.damage ?? 0
      out(
        `| ${label(d)} | ${POLICY_NAME[policy]} | ${pct(t.wins, t.runs)} | ${t.wins ? (t.turnsWon / t.wins).toFixed(1) : "—"} | ${int(t.damage / t.turnsAll)} | ${int(t.damage / Math.max(1, t.apSpent))} | ${pct(settle, t.damage)} | ${(t.maxCombo / t.runs).toFixed(1)} | ${(t.downs / t.runs).toFixed(2)} |`,
      )
    }
  }
  out()
  out("读法：「每回合伤害」= 整局总伤害 ÷ 回合数（含输掉的局）。「每 AP 伤害」= 总伤害 ÷ 花掉的 AP，0 AP 技能会把它抬高。")
  out()

  out("## 2. 每个包里技能的产出（跨全部遭遇与前排、辅助）")
  out()
  for (const d of damages) {
    const [a, b] = DAMAGE[d]!
    out(`### ${label(d)}`)
    out()
    out(`卡：${a.skills.map((s) => skillName(s.id)).join("+")}｜${b.skills.map((s) => skillName(s.id)).join("+")}`)
    out()
    out("| 技能 | 职业 | AP | 每局使用（常规/攒） | 每局伤害（常规/攒） | 占队伍伤害（常规/攒） | 每次平均伤害（常规） | 每 AP 伤害（常规） |")
    out("|---|---|---:|---:|---:|---:|---:|---:|")
    const ff = total.firstFit[d]!
    const bu = total.burst[d]!
    const keys = [...new Set([...Object.keys(ff.skills), ...Object.keys(bu.skills)])]
    const score = (k: string) => (ff.skills[k]?.damage ?? 0) / ff.runs + (bu.skills[k]?.damage ?? 0) / bu.runs
    keys.sort((x, y) => score(y) - score(x))
    for (const id of keys) {
      const sf = ff.skills[id] ?? { uses: 0, damage: 0 }
      const sb = bu.skills[id] ?? { uses: 0, damage: 0 }
      const def = SK[id]
      const settle = id === SETTLE
      const ap = settle ? "—" : def?.passive ? "被动" : String(def?.ap ?? "?")
      const perUse = sf.uses > 0 ? sf.damage / sf.uses : sb.uses > 0 ? sb.damage / sb.uses : 0
      const perAp = settle || !def?.ap || perUse === 0 ? "—" : int(perUse / def.ap)
      out(
        `| ${skillName(id)} | ${settle ? "—" : (def?.job ?? "?")} | ${ap} | ${settle ? "—" : `${(sf.uses / ff.runs).toFixed(2)} / ${(sb.uses / bu.runs).toFixed(2)}`} | ${int(sf.damage / ff.runs)} / ${int(sb.damage / bu.runs)} | ${pct(sf.damage, ff.damage)} / ${pct(sb.damage, bu.damage)} | ${settle ? "—" : int(perUse)} | ${perAp} |`,
      )
    }
    out()
  }
  out("读法：被动技能不出现在表里（不直接打伤害）；前排和辅助的主动伤害技能也会出现，因为每个包要配前排与辅助一起算。「每次平均伤害」是该技能单次施放打在敌人身上的平均伤害（含暴击、Combo、克制、状态加成）。")
  out()

  out("## 3. 前排与辅助积木的胜率（对全部输出包取平均，常规 / 攒大招）")
  out()
  out("| 积木 | 胜率 |")
  out("|---|---:|")
  const sumRate = (policy: Policy, pick: (r: EncounterResult) => Record<string, { runs: number; wins: number }>, key: string) => {
    let runs = 0
    let wins = 0
    for (const id of ids) {
      const x = pick(outputs[policy].get(id)!)[key]!
      runs += x.runs
      wins += x.wins
    }
    return pct(wins, runs)
  }
  for (const f of Object.keys(FRONT))
    out(`| 前排·${f}（${FRONT[f]!.skills.map((s) => skillName(s.id)).join("+")}） | ${sumRate("firstFit", (r) => r.byFront, f)} / ${sumRate("burst", (r) => r.byFront, f)} |`)
  for (const s of Object.keys(SUPPORT))
    out(`| 辅助·${s}（${SUPPORT[s]!.skills.map((x) => skillName(x.id)).join("+")}） | ${sumRate("firstFit", (r) => r.bySupport, s)} / ${sumRate("burst", (r) => r.bySupport, s)} |`)
  out()

  out("## 4. 遭遇面板与各包胜率（每格：常规 / 攒大招）")
  out()
  out(`| 遭遇 | 档位 | 属性 | 弱点 | 生命 | 攻击 | 防御 | ${damages.map(label).join(" | ")} |`)
  out(`|---|---|---|---|---:|---:|---:|${damages.map(() => "---:").join("|")}|`)
  for (const id of ids) {
    const r = outputs.firstFit.get(id)!
    const cells = damages.map((d) => {
      const a = outputs.firstFit.get(id)!.byDamage[d]!
      const b = outputs.burst.get(id)!.byDamage[d]!
      return `${pct(a.wins, a.runs)} / ${pct(b.wins, b.runs)}`
    })
    out(`| ${id} | ${r.info.tier} | ${r.info.element} | ${r.info.weaknesses.join("/") || "—"} | ${int(r.info.hpMax)} | ${int(r.info.atk)} | ${int(r.info.def)} | ${cells.join(" | ")} |`)
  }
  out()
  out(`（每格样本：${runsPerPackagePerEncounter} 局。）`)
  out()

  out("## 5. 重跑")
  out()
  out("```")
  out(`pnpm --filter @choke/api exec tsx scripts/analyze-archetypes.ts ${seedsPerTeam} --write "../../Design/流派数据报告 v0.1.md"`)
  out("```")
  out()

  const text = lines.join("\n")
  if (outFile) {
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true })
    fs.writeFileSync(path.resolve(outFile), text)
    console.log(`已写入 ${outFile}（${((Date.now() - started) / 1000).toFixed(1)}s，${workers} 线程）`)
  } else {
    console.log(text)
  }
}

if (isMainThread) await main()
