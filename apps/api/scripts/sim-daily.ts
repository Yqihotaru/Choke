// 逐日模拟（只读，不碰数据库，多线程并行）：N 个新玩家，第 1 天开新手启动包，之后每天领包、花体力刷经验本，
// 多余的卡全部喂给上场的 4 张，在第 1/3/7/14 天各拿机器人去打前期敌人，看战力曲线。
// 直接读取 content/packs.json 与 content/quests.json。用法：pnpm --filter @choke/api exec tsx scripts/sim-daily.ts [玩家数] [天数]
import os from "node:os"
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads"

import { ITEMS, type ItemId } from "@choke/shared/items"
import { STAMINA_MAX } from "@choke/shared/stamina"
import { resolveEncounter } from "@choke/shared/battle/content"
import { applyExp, feedExpOf, refundExpOf } from "@choke/shared/progression"
import { rollSkillRefs, seededRandom, SKILLS } from "@choke/shared/skills"
import type { Job, Rarity } from "@choke/shared/types"

import { BATTLE_CONTENT, QUEST_CONTENT } from "../src/content"
import { MYSTERY_PACK, PACK_SIZE, STARTER_PACKS } from "../src/gacha/packs"
import { RARITY_ORDER, rollRarity, type PoolId } from "../src/gacha/pools"
import { DECKS, face, inputs, playBot } from "./lib/battle-bot"

const PLAYERS = Number(process.argv[2] ?? 300)
const DAYS = Number(process.argv[3] ?? 14)
const SNAPSHOTS = [1, 3, 7, 14].filter((d) => d <= DAYS)

const STAMINA_PER_DAY = 240
const EXP_RUN_COST = 20
const EXP_RUN_REWARD = 3200

function sumActivityPacks(
  tiers: readonly { rewards: { packs?: readonly { pool: string; count: number }[] } }[] = [],
): Partial<Record<PoolId, number>> {
  const out: Partial<Record<PoolId, number>> = {}
  for (const t of tiers) {
    for (const p of t.rewards.packs ?? []) {
      out[p.pool as PoolId] = (out[p.pool as PoolId] ?? 0) + p.count
    }
  }
  return out
}

function sumRewardExp(items?: readonly { itemId: string; count: number }[]): number {
  let sum = 0
  for (const it of items ?? []) {
    sum += (ITEMS[it.itemId as ItemId]?.exp ?? 0) * it.count
  }
  return sum
}

// 每日挂机包额度可用环境变量 IDLE_LIMIT 覆盖（默认 60），用来对比放宽额度后的养成速度
const IDLE_LIMIT = Number(process.env.IDLE_LIMIT ?? 60)
const DAILY_PACKS: Partial<Record<PoolId, number>> = { idle: IDLE_LIMIT, ...sumActivityPacks(QUEST_CONTENT.activity.daily) }
const WEEKLY_PACKS: Partial<Record<PoolId, number>> = sumActivityPacks(QUEST_CONTENT.activity.weekly)
const MONTHLY_PACKS: Partial<Record<PoolId, number>> = sumActivityPacks(QUEST_CONTENT.activity.monthly)

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

function openPacks(pool: PoolId, count: number, random: () => number): Owned[] {
  const out: Owned[] = []
  for (let i = 0; i < count * PACK_SIZE; i += 1) {
    const rarity = rollRarity(pool, random) as Rarity
    const job = JOBS[Math.floor(random() * 4)]!
    out.push({ job, rarity, skills: rollSkillRefs(job, rarity, random).map((r) => r.skillId) })
  }
  return out
}

function packsOfDay(day: number, random: () => number): Partial<Record<PoolId, number>> {
  const total: Record<string, number> = {}
  const add = (src: Partial<Record<PoolId, number>>, scale: number) => {
    for (const [pool, n] of Object.entries(src)) total[pool] = (total[pool] ?? 0) + n! * scale
  }
  add(DAILY_PACKS, 1)
  if (day % 7 === 0) add(WEEKLY_PACKS, 1)
  add(MONTHLY_PACKS, 1 / 28)
  const out: Partial<Record<PoolId, number>> = {}
  for (const [pool, n] of Object.entries(total)) {
    const whole = Math.floor(n)
    out[pool as PoolId] = whole + (random() < n - whole ? 1 : 0)
  }
  return out
}

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
  exp: number[]
  pending: Owned[]
}

function feedAll(p: Player, extra: number) {
  for (let i = 0; i < p.team.length; i += 1) {
    const old = p.team[i]!
    const cand = p.pending
      .filter((c) => c.job === old.job && rankOf(c.rarity) > rankOf(old.rarity))
      .sort((a, b) => score(b) - score(a))[0]
    if (!cand) continue
    const { level } = applyExp(1, 0, p.exp[i]!, old.rarity, false)
    extra += refundExpOf(level, 0, old.rarity, false)
    p.pending.splice(p.pending.indexOf(cand), 1)
    p.pending.push(old)
    p.team[i] = cand
    p.exp[i] = 0
  }
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

interface PlayerOutcome {
  luck: number
  snaps: Record<number, { level: number; normal: number; elite: number }>
}

function runSlice(start: number, end: number, days: number, snapshots: number[]): PlayerOutcome[] {
  const encounters = Object.fromEntries(ENCOUNTERS.map((id) => [id, resolveEncounter(BATTLE_CONTENT, id)!]))
  const out: PlayerOutcome[] = []

  for (let n = start; n < end; n += 1) {
    const initRandom = seededRandom(`daily-${n}`)
    const cards: Owned[] = []
    for (const [pool, count] of Object.entries(STARTER_PACKS)) {
      if (pool === MYSTERY_PACK.id || !count) continue
      cards.push(...openPacks(pool as PoolId, count, initRandom))
    }
    const luck = cards.reduce((sum, c) => sum + feedExpOf({ rarity: c.rarity, level: 1, exp: 0 }), 0)
    const team = pickBalanced(cards)
    const p: Player = { luck, team, exp: team.map(() => 0), pending: cards.filter((c) => !team.includes(c)) }
    const snaps: PlayerOutcome["snaps"] = {}

    for (let day = 1; day <= days; day += 1) {
      const random = seededRandom(`daily-${n}-day-${day}`)
      const stamina = day === 1 ? STAMINA_MAX : STAMINA_PER_DAY
      let extraExp = Math.floor(stamina / EXP_RUN_COST) * EXP_RUN_REWARD
      const starterBonus = QUEST_CONTENT.quests[`ach-starter-${day}`]?.rewards
      const signInBonus = QUEST_CONTENT.signIn.bonus[String(day)]
      for (const reward of [starterBonus, signInBonus]) {
        if (!reward) continue
        extraExp += sumRewardExp(reward.items)
        for (const pk of reward.packs ?? []) {
          p.pending.push(...openPacks(pk.pool as PoolId, pk.count, random))
        }
      }
      if (day > 1) {
        for (const [pool, count] of Object.entries(packsOfDay(day, random))) {
          p.pending.push(...openPacks(pool as PoolId, count!, random))
        }
      }
      feedAll(p, extraExp)

      if (snapshots.includes(day)) {
        const { deck, level } = deckOf(p)
        let normal = 0
        let elite = 0
        for (const id of ENCOUNTERS) {
          const { state } = playBot(encounters[id]!, deck, `sim-${n}-${day}-${id}`, [])
          if (state.phase !== "won") continue
          if (NORMAL.includes(id)) normal += 1
          else elite += 1
        }
        snaps[day] = { level, normal, elite }
      }
    }
    out.push({ luck, snaps })
  }
  return out
}

if (!isMainThread) {
  const { start, end, days, snapshots } = workerData as {
    start: number
    end: number
    days: number
    snapshots: number[]
  }
  parentPort!.postMessage(runSlice(start, end, days, snapshots))
} else {
  const started = Date.now()
  const workers = Math.max(1, Math.min(os.availableParallelism(), 8, PLAYERS))
  const chunk = Math.ceil(PLAYERS / workers)
  const parts = await Promise.all(
    Array.from({ length: workers }, (_, i) => {
      const start = i * chunk
      const end = Math.min(PLAYERS, start + chunk)
      if (start >= end) return Promise.resolve<PlayerOutcome[]>([])
      if (workers === 1) return Promise.resolve(runSlice(start, end, DAYS, SNAPSHOTS))
      return new Promise<PlayerOutcome[]>((resolve, reject) => {
        const w = new Worker(import.meta.filename, {
          execArgv: process.execArgv,
          workerData: { start, end, days: DAYS, snapshots: SNAPSHOTS },
        })
        w.on("message", (res: PlayerOutcome[]) => {
          resolve(res)
          void w.terminate()
        })
        w.on("error", reject)
      })
    }),
  )

  const outcomes = parts.flat()
  const sortedLuck = outcomes.map((o) => o.luck).sort((a, b) => a - b)
  const quartileOf = (luck: number) => {
    const idx = sortedLuck.findIndex((v) => v >= luck)
    return Math.min(3, Math.floor((idx / sortedLuck.length) * 4))
  }

  interface Snap {
    levels: number[]
    normalWins: number
    eliteWins: number
    byQuartile: { normal: number; elite: number; n: number }[]
  }
  const snaps: Record<number, Snap> = Object.fromEntries(
    SNAPSHOTS.map((d) => [d, { levels: [], normalWins: 0, eliteWins: 0, byQuartile: [0, 1, 2, 3].map(() => ({ normal: 0, elite: 0, n: 0 })) }]),
  )

  for (const o of outcomes) {
    const qIdx = quartileOf(o.luck)
    for (const d of SNAPSHOTS) {
      const s = snaps[d]!
      const rec = o.snaps[d]!
      s.levels.push(rec.level)
      s.normalWins += rec.normal
      s.eliteWins += rec.elite
      const q = s.byQuartile[qIdx]!
      q.normal += rec.normal
      q.elite += rec.elite
      q.n += 1
    }
  }

  const encounters = Object.fromEntries(ENCOUNTERS.map((id) => [id, resolveEncounter(BATTLE_CONTENT, id)!]))
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
  console.log(`\n逐日模拟：${PLAYERS} 人 × ${DAYS} 天，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s（${workers} 线程）`)
  console.log(`配置读取：每天卡包 ${JSON.stringify(DAILY_PACKS)} + 周常 ${JSON.stringify(WEEKLY_PACKS)} + 月常平摊 ${JSON.stringify(MONTHLY_PACKS)} + 签到`)
  console.log(`体力：每天 ${STAMINA_PER_DAY}（第 1 天 ${STAMINA_MAX}）全刷经验本（${EXP_RUN_COST} 体力出 ${EXP_RUN_REWARD} 经验）\n`)

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
      row[`${label}（普通/精英）`] = q.n
        ? `${((q.normal / (q.n * NORMAL.length)) * 100).toFixed(0)}% / ${((q.elite / (q.n * ELITE.length)) * 100).toFixed(0)}%`
        : "-"
    })
    table[`第 ${d} 天`] = row
  }
  console.table(table)
  console.log("参照（手写基准卡组）：")
  console.table(reference)
}
