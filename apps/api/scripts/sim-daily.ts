// 逐日模拟（只读，不碰数据库）：N 个新玩家，第 1 天开 30 个新手包，之后每天领包、花体力刷经验本，
// 多余的卡全部喂给上场的 4 张，在第 1/3/7/14 天各拿机器人去打前期敌人，看战力曲线。
// 不含游客和本体卡。用法：pnpm --filter @choke/api exec tsx scripts/sim-daily.ts [玩家数] [天数]
//
// ★ 占位数字（还没定，只是为了跑通；定了以后改这里）：
//   PACKS_PER_DAY：每天白拿几个普通卡包（任务、签到、挂机的合计）
//   STAMINA_PER_DAY：每天能花的体力（回复 240 + 其余来源，目前只算自然回复）
//   玩家活跃度：假设每天都上线、体力全部刷经验本，所以这是"勤快玩家"的上限
import { STAMINA_MAX } from "@choke/shared/stamina"
import { resolveEncounter } from "@choke/shared/battle/content"
import { applyExp, feedExpOf } from "@choke/shared/progression"
import { rollSkillRefs, seededRandom, SKILLS } from "@choke/shared/skills"
import type { Job, Rarity } from "@choke/shared/types"

import { BATTLE_CONTENT } from "../src/content"
import { PACK_SIZE } from "../src/gacha/packs"
import { RARITY_ORDER, rollRarity } from "../src/gacha/pools"
import { DECKS, face, inputs, playBot } from "./lib/battle-bot"

const PLAYERS = Number(process.argv[2] ?? 300)
const DAYS = Number(process.argv[3] ?? 14)
const SNAPSHOTS = [1, 3, 7, 14].filter((d) => d <= DAYS)

const STARTER_PACKS = 30
const PACKS_PER_DAY = 3 // 占位
const STAMINA_PER_DAY = 240 // 占位：只算自然回复（每 6 分钟 1 点）
const EXP_RUN_COST = 20
const EXP_RUN_REWARD = 3200

const JOBS: Job[] = ["tank", "warrior", "mage", "support"]
const NORMAL = ["ghost", "frost-dancer", "rock-drummer", "vine-fiddler", "wind-chime"]
const ELITE = ["bare-brawler", "dusk-warden", "ember-scribe", "halo-chorister", "vanguard"]
const ENCOUNTERS = [...NORMAL, ...ELITE]

interface Owned {
  job: Job
  rarity: Rarity
  skills: string[]
}

const rankOf = (r: string) => RARITY_ORDER.indexOf(r as (typeof RARITY_ORDER)[number])
const score = (c: Owned) => rankOf(c.rarity) * 10 + c.skills.filter((id) => !SKILLS[id]!.passive).length

function openPacks(pool: "starter" | "normal", count: number, random: () => number): Owned[] {
  const out: Owned[] = []
  for (let i = 0; i < count * PACK_SIZE; i += 1) {
    const rarity = rollRarity(pool, random) as Rarity
    const job = JOBS[Math.floor(random() * 4)]!
    out.push({ job, rarity, skills: rollSkillRefs(job, rarity, random).map((r) => r.skillId) })
  }
  return out
}

/** 聪明玩家：每个职业取最好的一张，缺的职业用剩下最好的补 */
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

interface Player {
  luck: number
  team: Owned[]
  /** 上场卡各自累计吃到的经验 */
  exp: number[]
  /** 还没处理的卡（等着当喂养材料） */
  pending: Owned[]
}

function feedAll(p: Player, extra: number) {
  const fodder = p.pending.reduce((sum, c) => sum + feedExpOf({ rarity: c.rarity, level: 1, exp: 0 }), 0)
  p.pending = []
  const each = Math.floor((fodder + extra) / p.team.length)
  p.exp = p.exp.map((e) => e + each)
}

function deckOf(p: Player) {
  const faces = p.team.map((c, i) => {
    const { level } = applyExp(1, 0, p.exp[i]!, c.rarity, false)
    return face(`d-${i}`, c.job, c.rarity, level, 0, c.skills)
  })
  return { deck: inputs(faces, 100), level: faces.reduce((s, f) => s + f.level, 0) / faces.length }
}

const started = Date.now()
const encounters = Object.fromEntries(ENCOUNTERS.map((id) => [id, resolveEncounter(BATTLE_CONTENT, id)!]))

interface Snap {
  levels: number[]
  normalWins: number
  eliteWins: number
  /** 按运气四分位（0 最差 … 3 最好） */
  byQuartile: { normal: number; elite: number; n: number }[]
}
const snaps: Record<number, Snap> = Object.fromEntries(
  SNAPSHOTS.map((d) => [d, { levels: [], normalWins: 0, eliteWins: 0, byQuartile: [0, 1, 2, 3].map(() => ({ normal: 0, elite: 0, n: 0 })) }]),
)

const players: Player[] = []
for (let n = 0; n < PLAYERS; n += 1) {
  const random = seededRandom(`daily-${n}`)
  const cards = openPacks("starter", STARTER_PACKS, random)
  const luck = cards.reduce((sum, c) => sum + feedExpOf({ rarity: c.rarity, level: 1, exp: 0 }), 0)
  const team = pickBalanced(cards)
  players.push({ luck, team, exp: team.map(() => 0), pending: cards.filter((c) => !team.includes(c)) })
}
const sortedLuck = players.map((p) => p.luck).sort((a, b) => a - b)
const quartileOf = (luck: number) => {
  const idx = sortedLuck.findIndex((v) => v >= luck)
  return Math.min(3, Math.floor((idx / sortedLuck.length) * 4))
}

for (let day = 1; day <= DAYS; day += 1) {
  for (let n = 0; n < players.length; n += 1) {
    const p = players[n]!
    const random = seededRandom(`daily-${n}-day-${day}`)
    // 当天收入：第 1 天满体力，之后每天固定体力；每天固定几个卡包
    const stamina = day === 1 ? STAMINA_MAX : STAMINA_PER_DAY
    const expFromRuns = Math.floor(stamina / EXP_RUN_COST) * EXP_RUN_REWARD
    if (day > 1) p.pending.push(...openPacks("normal", PACKS_PER_DAY, random))
    feedAll(p, expFromRuns)

    if (SNAPSHOTS.includes(day)) {
      const { deck, level } = deckOf(p)
      const snap = snaps[day]!
      snap.levels.push(level)
      let normal = 0
      let elite = 0
      for (const id of ENCOUNTERS) {
        const { state } = playBot(encounters[id]!, deck, `sim-${n}-${day}-${id}`, [])
        if (state.phase !== "won") continue
        if (NORMAL.includes(id)) normal += 1
        else elite += 1
      }
      snap.normalWins += normal
      snap.eliteWins += elite
      const q = snap.byQuartile[quartileOf(p.luck)]!
      q.normal += normal
      q.elite += elite
      q.n += 1
    }
  }
}

// ---- 参照：手写基准卡组打同样的敌人（每场 10 局）----
const reference: Record<string, { 等级: string; 普通怪胜率: string; 精英胜率: string }> = {}
for (const [name, deck] of Object.entries(DECKS)) {
  let normal = 0
  let elite = 0
  const runs = 10
  for (const id of ENCOUNTERS) {
    for (let s = 0; s < runs; s += 1) {
      const { state } = playBot(encounters[id]!, deck, `ref-${name}-${id}-${s}`, [])
      if (state.phase !== "won") continue
      if (NORMAL.includes(id)) normal += 1
      else elite += 1
    }
  }
  const lv = deck.reduce((sum, c) => sum + c.face.level, 0) / deck.length
  reference[name] = {
    等级: lv.toFixed(1),
    普通怪胜率: `${((normal / (NORMAL.length * runs)) * 100).toFixed(0)}%`,
    精英胜率: `${((elite / (ELITE.length * runs)) * 100).toFixed(0)}%`,
  }
}

const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
console.log(`\n逐日模拟：${PLAYERS} 人 × ${DAYS} 天，耗时 ${((Date.now() - started) / 1000).toFixed(0)}s`)
console.log(`占位数字：每天 ${PACKS_PER_DAY} 个普通包、每天 ${STAMINA_PER_DAY} 体力（第 1 天 ${STAMINA_MAX}）全刷经验本（${EXP_RUN_COST} 体力出 ${EXP_RUN_REWARD} 经验）`)
console.log("玩家：每职业各取最好的一张上场（固定不换），经验平均分给 4 张，所有多余的卡喂掉\n")

const table: Record<string, Record<string, string>> = {}
for (const d of SNAPSHOTS) {
  const s = snaps[d]!
  const row: Record<string, string> = {
    平均等级: avg(s.levels).toFixed(1),
    普通怪胜率: `${((s.normalWins / (PLAYERS * NORMAL.length)) * 100).toFixed(0)}%`,
    精英胜率: `${((s.eliteWins / (PLAYERS * ELITE.length)) * 100).toFixed(0)}%`,
  }
  s.byQuartile.forEach((q, i) => {
    const label = ["运气最差 25%", "偏差 25%", "偏好 25%", "运气最好 25%"][i]!
    row[`${label}（普通/精英）`] = q.n ? `${((q.normal / (q.n * NORMAL.length)) * 100).toFixed(0)}% / ${((q.elite / (q.n * ELITE.length)) * 100).toFixed(0)}%` : "-"
  })
  table[`第 ${d} 天`] = row
}
console.table(table)
console.log("参照（手写基准卡组）：")
console.table(reference)
