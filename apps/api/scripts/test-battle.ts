// pnpm test:battle [--update]
//
// 战斗回归测试：content/encounters 里的每场遭遇 × 两套卡组 × 固定种子，用固定策略的机器人打完，检查
//   1. 确定性：同种子同操作打两遍，状态逐位相同
//   2. 可重放：replayBattle 复算的终局与实打相同（服务端校验靠的就是这个）
//   3. 回归：每局的回合数、步数、终局摘要与 fixtures/battle-golden.json 一致
//
// 有意改动了引擎数值或战斗内容 → 跑 `pnpm test:battle --update` 重录基准，并在提交里说明为什么变了。
// 没打算改却对不上 → 说明改动影响了战斗结果，先查清楚再更新基准。
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { replayBattle, withAction, type BattleAction } from "@choke/shared/battle/actions"
import { resolveEncounter, type EncounterSpec } from "@choke/shared/battle/content"
import { createBattle, type BattleInputCard } from "@choke/shared/battle/engine"
import { evaluateStars } from "@choke/shared/battle/stars"
import type { BattleState } from "@choke/shared/battle/types"
import { makeCard } from "@choke/shared/card-def"
import { skillsFor } from "@choke/shared/skills"
import type { Job, Mod, Rarity } from "@choke/shared/types"

import { BATTLE_CONTENT } from "../src/content"

const GOLDEN = path.resolve(import.meta.dirname, "fixtures/battle-golden.json")
const SEEDS_PER_DECK = 25
const MAX_TURNS = 40
const update = process.argv.includes("--update")

// ---------- 卡组：一套中等（打得过幽灵、打不过精英），一套满配（能打进终曲的蓄力阶段） ----------

function face(id: string, job: Job, rarity: Rarity, level: number, constellation: number, mods: Mod[] = []) {
  return makeCard({ id, name: id, rarity, job, level, constellation, mods, skills: skillsFor(job, rarity, true, id) })
}
function inputs(faces: ReturnType<typeof face>[], uidBase: number): BattleInputCard[] {
  return faces.map((f, i) => ({ uid: uidBase + i, cardId: f.id, face: f }))
}

const DECKS: Record<string, BattleInputCard[]> = {
  normal: inputs(
    [
      face("t-tank", "tank", "R", 20, 1),
      face("t-war", "warrior", "E", 25, 0, ["HR"]),
      face("t-mage", "mage", "L", 18, 2, ["DT", "HD"]),
      face("t-sup", "support", "UC", 30, 3),
    ],
    100,
  ),
  strong: inputs(
    [
      face("s-tank", "tank", "Radiant", 80, 6, ["HR"]),
      face("s-war", "warrior", "L", 80, 6, ["DT"]),
      face("s-mage", "mage", "Prismatic", 80, 6, ["HD", "DT"]),
      face("s-sup", "support", "L", 80, 6),
    ],
    300,
  ),
}
const BENCH = inputs([face("b-war", "warrior", "R", 15, 0), face("b-mage", "mage", "UC", 22, 1)], 200)

// ---------- 机器人：倒下的卡换替补；3 的倍数回合升 1 档防御；每张卡放第一个能放的技能；结束回合 ----------

function playBot(encounter: EncounterSpec, deck: BattleInputCard[], seed: string) {
  let state = createBattle(encounter, deck, { seed, bench: BENCH })
  const actions: BattleAction[] = []
  const act = (action: BattleAction) => {
    const result = withAction(state, action)
    if (result.error) return false
    state = result.state
    actions.push(action)
    return true
  }
  for (let guard = 0; guard < MAX_TURNS && state.phase === "player"; guard += 1) {
    state.cards.forEach((card, slot) => {
      if (!card.down) return
      const sub = state.bench.find((b) => !b.down)
      if (sub) act({ type: "swap", slot, benchUid: sub.uid })
    })
    if (state.turn % 3 === 0) act({ type: "defend" })
    for (let i = 0; i < state.cards.length && state.phase === "player"; i += 1) {
      for (const skill of state.cards[i]!.skills) {
        if (skill.passive) continue
        if (act({ type: "skill", card: i, skill: skill.id })) break
      }
    }
    if (state.phase === "player") act({ type: "endTurn" })
  }
  return { state, actions }
}

const digest = (state: BattleState) => createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 16)

interface GoldenEntry {
  phase: string
  turn: number
  actions: number
  stars: number
  digest: string
}

// ---------- 跑 ----------

const started = Date.now()
const results: Record<string, GoldenEntry> = {}
const problems: string[] = []
const table: Record<string, { 胜: number; 负: number; 平均回合: string; 平均星数: string }> = {}

for (const encounterId of Object.keys(BATTLE_CONTENT.encounters).sort()) {
  const encounter = resolveEncounter(BATTLE_CONTENT, encounterId)!
  for (const [deckName, deck] of Object.entries(DECKS)) {
    let won = 0
    let turns = 0
    let stars = 0
    for (let n = 0; n < SEEDS_PER_DECK; n += 1) {
      const key = `${encounterId}/${deckName}/${n}`
      const seed = `test-${key}`
      const a = playBot(encounter, deck, seed)
      const b = playBot(encounter, deck, seed)
      const live = JSON.stringify(a.state)
      if (live !== JSON.stringify(b.state)) problems.push(`${key}：同种子打两遍结果不同（引擎里有不走种子的随机或依赖外部状态）`)
      const replay = replayBattle({ encounter, cards: deck, bench: BENCH, seed }, a.actions)
      if (replay.invalidAt !== null) problems.push(`${key}：重放第 ${replay.invalidAt} 步不合法：${replay.error}`)
      else if (live !== JSON.stringify(replay.state)) problems.push(`${key}：重放结果与实打不同`)
      if (a.state.phase === "player") problems.push(`${key}：${MAX_TURNS} 回合内没分出胜负`)

      const rating = evaluateStars(a.state)
      const starCount = a.state.phase === "won" ? rating.count : 0
      results[key] = { phase: a.state.phase, turn: a.state.turn, actions: a.actions.length, stars: starCount, digest: digest(a.state) }
      if (a.state.phase === "won") won += 1
      turns += a.state.turn
      stars += starCount
    }
    table[`${encounterId}/${deckName}`] = {
      胜: won,
      负: SEEDS_PER_DECK - won,
      平均回合: (turns / SEEDS_PER_DECK).toFixed(1),
      平均星数: won ? (stars / won).toFixed(2) : "—",
    }
  }
}

console.table(table)
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
  console.log(`\n✘ ${problems.length} 个问题（${total} 局，${seconds}s）：`)
  for (const p of problems.slice(0, 30)) console.log(`  ${p}`)
  process.exitCode = 1
} else {
  console.log(`\n✔ ${total} 局：确定性、重放${update ? "" : "、基准"}全部通过（${seconds}s）`)
}
