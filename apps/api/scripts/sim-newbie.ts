// 新手模拟（只读，不碰数据库）：N 个玩家各开 30 个新手包，把多余的卡全部喂给自己挑的 4 张，
// 再用战斗机器人去打前期敌人。统计最差玩家的胜率、缺哪类关键技能。
// 不含游客和本体卡。用法：pnpm --filter @choke/api exec tsx scripts/sim-newbie.ts [玩家数]
import { resolveEncounter } from "@choke/shared/battle/content"
import { applyExp, feedExpOf } from "@choke/shared/progression"
import { SKILLS, rollSkillRefs, seededRandom } from "@choke/shared/skills"
import type { Job, Rarity } from "@choke/shared/types"

import { BATTLE_CONTENT } from "../src/content"
import { PACK_SIZE } from "../src/gacha/packs"
import { RARITY_ORDER, rollRarity } from "../src/gacha/pools"
import { face, inputs, playBot } from "./lib/battle-bot"

const PLAYERS = Number(process.argv[2] ?? 1000)
/** 喂养之外额外给上场卡的经验（比如体力刷经验本）；平均分给 4 张卡 */
const EXTRA_EXP = Number(process.argv[3] ?? 0)
const PACK_COUNT = 30
const JOBS: Job[] = ["tank", "warrior", "mage", "support"]
const ENCOUNTERS = [
  "ghost", "frost-dancer", "rock-drummer", "vine-fiddler", "wind-chime", // 普通怪
  "bare-brawler", "dusk-warden", "ember-scribe", "halo-chorister", "vanguard", // 精英
]
const NORMALS = new Set(ENCOUNTERS.slice(0, 5))

interface Owned {
  job: Job
  rarity: Rarity
  skills: string[]
}

const rankOf = (r: string) => RARITY_ORDER.indexOf(r as (typeof RARITY_ORDER)[number])

// ---- 关键技能分类 ----
const isTankKey = (id: string) => {
  const s = SKILLS[id]!
  return s.kind === "guard" || s.kind === "taunt" || s.supportDef?.kind === "armor"
}
const isHealKey = (id: string) => SKILLS[id]!.kind === "heal"
const isControlKey = (id: string) => ["control", "interrupt"].includes(SKILLS[id]!.kind) || !!SKILLS[id]!.revive
const isBreakKey = (id: string) => SKILLS[id]!.statusId === "armor_break" || !!SKILLS[id]!.clearEnemySupports

function openStarter(random: () => number): Owned[] {
  const all: Owned[] = []
  let sawL = false
  for (let p = 0; p < PACK_COUNT; p += 1) {
    const pack: Owned[] = []
    for (let i = 0; i < PACK_SIZE; i += 1) {
      const rarity = rollRarity("starter", random) as Rarity
      const job = JOBS[Math.floor(random() * 4)]!
      pack.push({ job, rarity, skills: rollSkillRefs(job, rarity, random).map((r) => r.skillId) })
    }
    if (rankOf(pack.reduce((best, c) => (rankOf(c.rarity) > rankOf(best) ? c.rarity : best), "C" as Rarity)) >= rankOf("L")) sawL = true
    // 最后一包兜底：之前没出过 L，就把最差的一张换成 L
    if (p === PACK_COUNT - 1 && !sawL) {
      const worst = pack.reduce((w, c, i) => (rankOf(c.rarity) < rankOf(pack[w]!.rarity) ? i : w), 0)
      const job = JOBS[Math.floor(random() * 4)]!
      pack[worst] = { job, rarity: "L", skills: rollSkillRefs(job, "L", random).map((r) => r.skillId) }
    }
    all.push(...pack)
  }
  return all
}

const score = (c: Owned) => rankOf(c.rarity) * 10 + c.skills.filter((id) => !SKILLS[id]!.passive).length

/** 聪明玩家：每个职业取最好的一张；缺的职业用剩下最好的补 */
function pickBalanced(cards: Owned[]): Owned[] {
  const team: Owned[] = []
  for (const job of JOBS) {
    const best = cards.filter((c) => c.job === job).sort((a, b) => score(b) - score(a))[0]
    if (best) team.push(best)
  }
  const rest = cards.filter((c) => !team.includes(c)).sort((a, b) => score(b) - score(a))
  while (team.length < 4) team.push(rest.shift()!)
  return team
}

/** 只看稀有度的玩家：最高的 4 张，不管职业 */
function pickTop(cards: Owned[]): Owned[] {
  return [...cards].sort((a, b) => score(b) - score(a)).slice(0, 4)
}

function buildDeck(team: Owned[], all: Owned[], tag: string) {
  const rest = all.filter((c) => !team.includes(c))
  const exp = rest.reduce((sum, c) => sum + feedExpOf({ rarity: c.rarity, level: 1, exp: 0 }), 0) + EXTRA_EXP
  const each = Math.floor(exp / team.length)
  const faces = team.map((c, i) => {
    const { level } = applyExp(1, 0, each, c.rarity, false)
    return face(`${tag}-${i}`, c.job, c.rarity, level, 0, c.skills)
  })
  return inputs(faces, 100)
}

const started = Date.now()
const encounters = Object.fromEntries(ENCOUNTERS.map((id) => [id, resolveEncounter(BATTLE_CONTENT, id)!]))

type Strategy = "balanced" | "top"
const wins: Record<Strategy, Record<string, number>> = { balanced: {}, top: {} }
const perPlayerNormal: Record<Strategy, number[]> = { balanced: [], top: [] }
const perPlayerAll: Record<Strategy, number[]> = { balanced: [], top: [] }
const levels: Record<Strategy, number[]> = { balanced: [], top: [] }
const has = { rJob: [0, 0, 0, 0], key: { tank: 0, heal: 0, control: 0, brk: 0 }, teamKey: { tank: 0, heal: 0, control: 0, brk: 0 }, noL: 0, dupSkillCards: 0 }
const rarityCount: Record<string, number> = {}

for (let n = 0; n < PLAYERS; n += 1) {
  const random = seededRandom(`newbie-${n}`)
  const cards = openStarter(random)
  cards.forEach((c) => (rarityCount[c.rarity] = (rarityCount[c.rarity] ?? 0) + 1))

  // 库存层面：R 以上每职业有没有、有没有关键技能
  const rPlus = cards.filter((c) => rankOf(c.rarity) >= rankOf("R"))
  JOBS.forEach((job, j) => {
    if (rPlus.some((c) => c.job === job)) has.rJob[j]! += 1
  })
  const anyKey = (pred: (id: string) => boolean) => rPlus.some((c) => c.skills.some(pred))
  if (anyKey(isTankKey)) has.key.tank += 1
  if (anyKey(isHealKey)) has.key.heal += 1
  if (anyKey(isControlKey)) has.key.control += 1
  if (anyKey(isBreakKey)) has.key.brk += 1
  if (!cards.some((c) => rankOf(c.rarity) >= rankOf("L"))) has.noL += 1

  for (const strategy of ["balanced", "top"] as Strategy[]) {
    const team = strategy === "balanced" ? pickBalanced(cards) : pickTop(cards)
    const deck = buildDeck(team, cards, strategy[0]!)
    levels[strategy].push(deck.reduce((s, c) => s + c.face.level, 0) / 4)
    if (strategy === "balanced") {
      const hit = (pred: (id: string) => boolean) => team.some((c) => c.skills.some(pred))
      if (hit(isTankKey)) has.teamKey.tank += 1
      if (hit(isHealKey)) has.teamKey.heal += 1
      if (hit(isControlKey)) has.teamKey.control += 1
      if (hit(isBreakKey)) has.teamKey.brk += 1
    }
    let normalWins = 0
    let allWins = 0
    for (const id of ENCOUNTERS) {
      const { state } = playBot(encounters[id]!, deck, `sim-${n}-${id}`, [])
      const won = state.phase === "won"
      if (won) {
        wins[strategy][id] = (wins[strategy][id] ?? 0) + 1
        allWins += 1
        if (NORMALS.has(id)) normalWins += 1
      }
    }
    perPlayerNormal[strategy].push(normalWins)
    perPlayerAll[strategy].push(allWins)
  }
}

const pct = (n: number) => `${((n / PLAYERS) * 100).toFixed(1)}%`
const percentile = (arr: number[], p: number) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length * p)]!
const avg = (arr: number[]) => (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)

console.log(`\n玩家 ${PLAYERS} 人，每人 ${PACK_COUNT} 个新手包（${PACK_COUNT * PACK_SIZE} 张），额外经验 ${EXTRA_EXP}，耗时 ${((Date.now() - started) / 1000).toFixed(0)}s`)
console.log("平均每人各档稀有度张数：", Object.fromEntries(RARITY_ORDER.map((r) => [r, ((rarityCount[r] ?? 0) / PLAYERS).toFixed(1)])))
console.log("\n— 库存（R 以上的卡）—")
console.table({
  "每职业至少一张 R+": Object.fromEntries(JOBS.map((j, i) => [j, pct(has.rJob[i]!)])),
  "R+ 卡里有该类关键技能": { 重装甲或嘲讽: pct(has.key.tank), 治疗: pct(has.key.heal), 控制或复苏: pct(has.key.control), 破甲或拆支援: pct(has.key.brk) },
  "（聪明玩家）上场 4 张里有": { 重装甲或嘲讽: pct(has.teamKey.tank), 治疗: pct(has.teamKey.heal), 控制或复苏: pct(has.teamKey.control), 破甲或拆支援: pct(has.teamKey.brk) },
})
console.log("没抽到 L 以上的玩家：", pct(has.noL))

for (const strategy of ["balanced", "top"] as Strategy[]) {
  console.log(`\n— 策略：${strategy === "balanced" ? "每职业各取最好一张（聪明）" : "只挑最高稀有度 4 张（不看职业）"} —`)
  console.log(`上场卡平均等级 ${avg(levels[strategy])}`)
  const table: Record<string, { 胜率: string }> = {}
  for (const id of ENCOUNTERS) table[id] = { 胜率: pct(wins[strategy][id] ?? 0) }
  console.table(table)
  const normal = perPlayerNormal[strategy]
  const all = perPlayerAll[strategy]
  console.log(`5 个普通怪胜场：平均 ${avg(normal)}；最差 5% 玩家 ≤ ${percentile(normal, 0.05)}；全败 ${pct(normal.filter((w) => w === 0).length)}；胜 ≤2 场 ${pct(normal.filter((w) => w <= 2).length)}`)
  console.log(`10 个敌人胜场：平均 ${avg(all)}；最差 5% 玩家 ≤ ${percentile(all, 0.05)}`)
}
