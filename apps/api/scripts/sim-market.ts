// 市场与金币流动模拟（只读，不碰数据库）：投机者 / 普通玩家 / 推进度者 / 多号收割者，每天赚金币、开包、
// 上架和购买、抽签名池，看金币发多宽会怎样。卡包和任务数值直接读 content/，市场规则（2% 上架税、5% 成交税、
// 7 天过期、NPC 回收价）读 shared；"人怎么想"的部分都是假设，集中写在下面的 PROFILES 和常量里，改它们重跑即可。
// 用法：pnpm --filter @choke/api exec tsx scripts/sim-market.ts [--pity=80] [--idle=120] [--days=90] [--price=1600]
//       [--pass=10] [--route=5] [--seed=1] [--mults=1,3,6]
import fs from "node:fs"
import path from "node:path"

import {
  MARKET_LIST_TAX_RATE,
  MARKET_TRADE_TAX_RATE,
  NPC_RECYCLE_DAILY_LIMIT,
  NPC_RECYCLE_PRICES,
} from "@choke/shared/economy"

import { CONTENT_DIR } from "../src/content"

const argv = process.argv.slice(2)
const argText = (name: string, fallback: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback
const argNum = (name: string, fallback: number) => Number(argText(name, String(fallback)))

const PITY = argNum("pity", 80)
const IDLE_LIMIT = argNum("idle", 120)
const DAYS = argNum("days", 90)
const PULL_PRICE = argNum("price", 1600)
const PASS_TICKETS = argNum("pass", 10)
const ROUTE_TICKETS = argNum("route", 5)
const SEED = argNum("seed", 1)
const MULTS = argText("mults", "1,3,6").split(",").map(Number)
const SEASON_DAYS = 30
const RATE = { ssr: argNum("ssrRate", 0.015), sr: argNum("srRate", 0.06), r: argNum("rRate", 0.2) }

const RARITIES = ["C", "UC", "R", "E", "L", "Mythic", "Prismatic"] as const
const TRADE = ["E", "L", "Mythic", "Prismatic"] as const
type Rarity = (typeof RARITIES)[number]
type Trade = (typeof TRADE)[number]
const TRADE_VALUE_DAYS: Record<Trade, number> = { E: 0.3, L: 1.5, Mythic: 6, Prismatic: 20 }

const read = (name: string) => JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, name), "utf8"))
const packsJson = read("packs.json")
const quests = read("quests.json")
const PACK_SIZE: number = packsJson.packSize

function weightsOf(pool: string): Record<Rarity, number> {
  const w = packsJson.packs[pool].weights as Partial<Record<Rarity, number>>
  const sum = RARITIES.reduce((s, r) => s + (w[r] ?? 0), 0)
  return Object.fromEntries(RARITIES.map((r) => [r, (w[r] ?? 0) / sum])) as Record<Rarity, number>
}

interface Reward {
  coins?: number
  packs?: { pool: string; count: number }[]
}

function routine() {
  const packs: Record<string, number> = {}
  let coins = 0
  const add = (r: Reward | undefined, times: number) => {
    if (!r) return
    coins += (r.coins ?? 0) * times
    for (const p of r.packs ?? []) packs[p.pool] = (packs[p.pool] ?? 0) + p.count * times
  }
  const times = { daily: 28, weekly: 4, monthly: 1 } as const
  for (const q of Object.values<{ period?: string; rewards?: Reward }>(quests.quests)) {
    if (q.period === "daily" || q.period === "weekly" || q.period === "monthly") add(q.rewards, times[q.period])
  }
  for (const period of ["daily", "weekly", "monthly"] as const) {
    for (const tier of quests.activity[period] as { rewards: Reward }[]) add(tier.rewards, times[period])
  }
  coins += quests.signIn.base.coins * 28
  for (const bonus of Object.values<Reward>(quests.signIn.bonus)) add(bonus, 1)
  return { coinsPerDay: coins / 28, packsPerDay: Object.entries(packs).map(([pool, n]) => [pool, n / 28] as const) }
}
const ROUTINE = routine()

function meanCardsPerDay(idleShare: number): Record<Rarity, number> {
  const out = Object.fromEntries(RARITIES.map((r) => [r, 0])) as Record<Rarity, number>
  const add = (pool: string, packs: number) => {
    const w = weightsOf(pool)
    for (const r of RARITIES) out[r] += packs * PACK_SIZE * w[r]
  }
  for (const [pool, n] of ROUTINE.packsPerDay) if (packsJson.packs[pool]) add(pool, n)
  add("idle", IDLE_LIMIT * idleShare)
  return out
}

// ---------------- 假设：几类人怎么玩 ----------------
type Kind = "progressor" | "casual" | "spec" | "farmer" | "alt"
interface Profile {
  label: string
  count: number
  quest: number
  idle: number
  keep: Record<Trade, number>
  npc: boolean
  potion: number
  breakthrough: number
  pullShare: number
  buyShare: number
  intent: Record<Trade, number>
  routeTickets: number
}
const PROFILES: Record<Kind, Profile> = {
  progressor: {
    label: "推进度者",
    count: 400,
    quest: 1,
    idle: 1,
    keep: { E: 0.9, L: 0.85, Mythic: 1, Prismatic: 1 },
    npc: false,
    potion: 200,
    breakthrough: 320,
    pullShare: 0.5,
    buyShare: 0.4,
    intent: { E: 0.1, L: 0.04, Mythic: 0.008, Prismatic: 0.001 },
    routeTickets: 1,
  },
  casual: {
    label: "普通玩家",
    count: 450,
    quest: 0.6,
    idle: 0.5,
    keep: { E: 0.3, L: 0.3, Mythic: 0.5, Prismatic: 0.9 },
    npc: true,
    potion: 50,
    breakthrough: 0,
    pullShare: 0.8,
    buyShare: 0.3,
    intent: { E: 0.01, L: 0.004, Mythic: 0.001, Prismatic: 0.0003 },
    routeTickets: 0.5,
  },
  spec: {
    label: "投机者",
    count: 100,
    quest: 0.7,
    idle: 0.8,
    keep: { E: 0, L: 0, Mythic: 0, Prismatic: 0 },
    npc: true,
    potion: 100,
    breakthrough: 0,
    pullShare: 0.2,
    buyShare: 0.6,
    intent: { E: 0, L: 0, Mythic: 0, Prismatic: 0 },
    routeTickets: 0.5,
  },
  farmer: {
    label: "多号收割者（本号）",
    count: 25,
    quest: 1,
    idle: 1,
    keep: { E: 0.9, L: 0.85, Mythic: 1, Prismatic: 1 },
    npc: false,
    potion: 200,
    breakthrough: 320,
    pullShare: 1,
    buyShare: 0.4,
    intent: { E: 0.1, L: 0.04, Mythic: 0.008, Prismatic: 0.001 },
    routeTickets: 1,
  },
  alt: {
    label: "多号收割者（小号，每人 4 个）",
    count: 100,
    quest: 0.9,
    idle: 0.8,
    keep: { E: 0, L: 0, Mythic: 0, Prismatic: 0 },
    npc: true,
    potion: 0,
    breakthrough: 0,
    pullShare: 0,
    buyShare: 0,
    intent: { E: 0, L: 0, Mythic: 0, Prismatic: 0 },
    routeTickets: 0,
  },
}
const KINDS = Object.keys(PROFILES) as Kind[]
const ALTS_PER_FARMER = 4

// ---------------- 随机数 ----------------
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Season {
  pulls: number
  ssr: number
  sr: number
  pity: number
}
interface Account {
  id: number
  kind: Kind
  master: number
  coins: number
  tickets: number
  since: { ssr: number; sr: number; r: number }
  season: Season
  seasons: Season[]
  earned: { quest: number; npc: number; market: number; transfer: number }
  sunk: { pool: number; potion: number; breakthrough: number; tax: number }
  flip: { spent: number; revenue: number; tax: number; bought: number; sold: number }
}
interface Listing {
  seller: number
  rarity: Trade
  ask: number
  age: number
  cost: number | null
  sold: boolean
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}
const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })

function run(mult: number) {
  const rng = mulberry32(SEED)
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng())
  const poisson = (mean: number) => {
    if (mean <= 0) return 0
    if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * gauss()))
    const limit = Math.exp(-mean)
    let k = 0
    let p = 1
    do {
      k += 1
      p *= rng()
    } while (p > limit)
    return k - 1
  }

  const income0 = ROUTINE.coinsPerDay
  const value = Object.fromEntries(TRADE.map((r) => [r, TRADE_VALUE_DAYS[r] * income0 * mult])) as Record<Trade, number>
  const refPrice = { ...value }
  const means = Object.fromEntries(KINDS.map((k) => [k, meanCardsPerDay(PROFILES[k].idle)])) as Record<Kind, Record<Rarity, number>>

  const accounts: Account[] = []
  const newAccount = (kind: Kind, master: number): Account => {
    const acc: Account = {
      id: accounts.length,
      kind,
      master,
      coins: 0,
      tickets: 0,
      since: { ssr: 0, sr: 0, r: 0 },
      season: { pulls: 0, ssr: 0, sr: 0, pity: 0 },
      seasons: [],
      earned: { quest: 0, npc: 0, market: 0, transfer: 0 },
      sunk: { pool: 0, potion: 0, breakthrough: 0, tax: 0 },
      flip: { spent: 0, revenue: 0, tax: 0, bought: 0, sold: 0 },
    }
    accounts.push(acc)
    return acc
  }
  for (const kind of KINDS) {
    if (kind === "alt") continue
    for (let i = 0; i < PROFILES[kind].count; i += 1) {
      const main = newAccount(kind, -1)
      if (kind === "farmer") for (let j = 0; j < ALTS_PER_FARMER; j += 1) newAccount("alt", main.id)
    }
  }

  let listings: Listing[] = []
  const market = Object.fromEntries(TRADE.map((r) => [r, { trades: 0, volume: 0, listed: 0, expired: 0, prices: [] as number[] }])) as Record<
    Trade,
    { trades: number; volume: number; listed: number; expired: number; prices: number[] }
  >
  const taxTotals = { list: 0, trade: 0, transfer: 0 }

  const spendTax = (a: Account, amount: number) => {
    a.sunk.tax += amount
  }
  const list = (a: Account, rarity: Trade, cost: number | null, special: boolean) => {
    const ask = special
      ? Math.max(refPrice[rarity] * 1.2, (cost ?? 0) * 1.15)
      : refPrice[rarity] * Math.exp(0.1 + 0.25 * gauss())
    const price = Math.max(1, Math.round(ask))
    const tax = Math.max(1, Math.floor(price * MARKET_LIST_TAX_RATE))
    if (a.coins < tax) return
    a.coins -= tax
    spendTax(a, tax)
    taxTotals.list += tax
    if (cost !== null) a.flip.tax += tax
    listings.push({ seller: a.id, rarity, ask: price, age: 0, cost, sold: false })
    market[rarity].listed += 1
  }

  const pull = (a: Account) => {
    a.since.ssr += 1
    a.since.sr += 1
    a.since.r += 1
    let tier: "ssr" | "sr" | "r" | "none"
    let pity = false
    if (a.since.ssr >= PITY) {
      tier = "ssr"
      pity = true
    } else if (a.since.sr >= PITY / 2) {
      tier = "sr"
      pity = true
    } else if (a.since.r >= 10) {
      tier = "r"
      pity = true
    } else {
      const x = rng()
      tier = x < RATE.ssr ? "ssr" : x < RATE.ssr + RATE.sr ? "sr" : x < RATE.ssr + RATE.sr + RATE.r ? "r" : "none"
    }
    a.season.pulls += 1
    if (pity) a.season.pity += 1
    if (tier === "ssr") {
      a.season.ssr += 1
      a.since.ssr = 0
      a.since.sr = 0
      a.since.r = 0
    } else if (tier === "sr") {
      a.season.sr += 1
      a.since.sr = 0
      a.since.r = 0
    } else if (tier === "r") {
      a.since.r = 0
    }
  }

  for (let day = 1; day <= DAYS; day += 1) {
    if ((day - 1) % SEASON_DAYS === 0) {
      for (const a of accounts) a.tickets += PASS_TICKETS * (a.kind === "alt" ? 0 : 1) + ROUTE_TICKETS * PROFILES[a.kind].routeTickets
    }

    for (const a of accounts) {
      const prof = PROFILES[a.kind]
      const quest = income0 * prof.quest * mult
      a.coins += quest
      a.earned.quest += quest
      const cards = Object.fromEntries(RARITIES.map((r) => [r, poisson(means[a.kind][r])])) as Record<Rarity, number>
      if (prof.npc) {
        let slots = NPC_RECYCLE_DAILY_LIMIT
        for (const r of ["R", "UC", "C"] as const) {
          const n = Math.min(cards[r], slots)
          slots -= n
          const gain = n * NPC_RECYCLE_PRICES[r]
          a.coins += gain
          a.earned.npc += gain
        }
      }
      for (const r of TRADE) {
        for (let i = 0; i < cards[r]; i += 1) {
          if (rng() >= prof.keep[r]) list(a, r, null, a.kind === "spec")
        }
      }
    }

    const byRarity = Object.fromEntries(TRADE.map((r) => [r, listings.filter((l) => !l.sold && l.rarity === r).sort((x, y) => x.ask - y.ask)])) as Record<Trade, Listing[]>
    const order = accounts.map((_, i) => i).sort(() => rng() - 0.5)
    const todayPrices = Object.fromEntries(TRADE.map((r) => [r, [] as number[]])) as Record<Trade, number[]>
    for (const idx of order) {
      const a = accounts[idx]!
      const prof = PROFILES[a.kind]
      if (prof.buyShare <= 0) continue
      for (const r of TRADE) {
        const units = a.kind === "spec" ? 3 : poisson(prof.intent[r])
        for (let u = 0; u < units; u += 1) {
          const book = byRarity[r]
          const budget = a.coins * prof.buyShare
          const limit = a.kind === "spec" ? Math.min(refPrice[r] * 0.8, budget) : Math.min(value[r] * Math.exp(0.25 * gauss()), budget)
          let hit = -1
          for (let i = 0; i < book.length; i += 1) {
            if (book[i]!.seller === a.id) continue
            if (book[i]!.ask <= limit) hit = i
            break
          }
          if (hit < 0) break
          const l = book.splice(hit, 1)[0]!
          l.sold = true
          const seller = accounts[l.seller]!
          const tradeTax = Math.floor(l.ask * MARKET_TRADE_TAX_RATE)
          a.coins -= l.ask
          seller.coins += l.ask - tradeTax
          seller.earned.market += l.ask - tradeTax
          seller.sunk.tax += tradeTax
          taxTotals.trade += tradeTax
          market[r].trades += 1
          market[r].volume += l.ask
          todayPrices[r].push(l.ask)
          if (l.cost !== null) {
            seller.flip.revenue += l.ask - tradeTax
            seller.flip.sold += 1
          }
          if (a.kind === "spec") {
            a.flip.spent += l.ask
            a.flip.bought += 1
            list(a, r, l.ask, true)
          }
        }
      }
    }
    for (const r of TRADE) {
      if (todayPrices[r].length > 0) refPrice[r] = Math.max(NPC_RECYCLE_PRICES[r] * 1.2, refPrice[r] * 0.8 + median(todayPrices[r]) * 0.2)
    }

    const next: Listing[] = []
    for (const l of listings) {
      if (l.sold) continue
      l.age += 1
      const seller = accounts[l.seller]!
      if (l.age > 7) {
        market[l.rarity].expired += 1
        if (l.cost !== null && seller.kind === "spec") list(seller, l.rarity, l.cost, true)
        continue
      }
      l.ask = Math.max(1, Math.round(l.cost !== null ? Math.max(l.cost * 1.02, l.ask * 0.98) : l.ask * 0.95))
      next.push(l)
    }
    listings = next

    for (const a of accounts) {
      const prof = PROFILES[a.kind]
      const potion = Math.min(a.coins, prof.potion)
      a.coins -= potion
      a.sunk.potion += potion
      const raise = Math.min(a.coins * 0.6, prof.breakthrough)
      a.coins -= raise
      a.sunk.breakthrough += raise
      const pulls = a.tickets + Math.floor((a.coins * prof.pullShare) / PULL_PRICE)
      for (let i = 0; i < pulls; i += 1) {
        if (a.tickets > 0) a.tickets -= 1
        else {
          a.coins -= PULL_PRICE
          a.sunk.pool += PULL_PRICE
        }
        pull(a)
      }
      if (a.kind === "alt" && a.coins > 0) {
        const fee = Math.floor(a.coins * (MARKET_LIST_TAX_RATE + MARKET_TRADE_TAX_RATE))
        const main = accounts[a.master]!
        main.coins += a.coins - fee
        main.earned.transfer += a.coins - fee
        a.sunk.tax += fee
        taxTotals.transfer += fee
        a.coins = 0
      }
      if (day % SEASON_DAYS === 0) {
        a.seasons.push(a.season)
        a.season = { pulls: 0, ssr: 0, sr: 0, pity: 0 }
      }
    }
  }

  return { accounts, market, taxTotals, refPrice, value }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0)

console.log(
  `市场与金币模拟：${DAYS} 天（${Math.floor(DAYS / SEASON_DAYS)} 个赛季，每季 ${SEASON_DAYS} 天），挂机额度 ${IDLE_LIMIT}，抽价 ${PULL_PRICE}/抽，保底 SSR ${PITY} / SR ${PITY / 2} / R 10，` +
    `通行证 ${PASS_TICKETS} 张 + 路线奖励最多 ${ROUTE_TICKETS} 张抽券。\n基础金币收入 ${fmt(ROUTINE.coinsPerDay)}/天（读 quests.json，全做完口径）。` +
    `金币放大倍数：${MULTS.join(" / ")}。\n`,
)
console.log(`假设：SSR/SR/R 基础概率 ${RATE.ssr * 100}% / ${RATE.sr * 100}% / ${RATE.r * 100}%；卡的心理价值（日收入的倍数）E ${TRADE_VALUE_DAYS.E} / L ${TRADE_VALUE_DAYS.L} / Mythic ${TRADE_VALUE_DAYS.Mythic} / Prismatic ${TRADE_VALUE_DAYS.Prismatic}；签名卡不进市场。\n`)

for (const mult of MULTS) {
  const r = run(mult)
  const per30 = 30 / DAYS
  console.log(`================ 金币放大 ×${mult}（日收入约 ${fmt(ROUTINE.coinsPerDay * mult)} 金币/满额玩家）================`)
  const rows: Record<string, Record<string, string>> = {}
  for (const kind of KINDS) {
    const accs = r.accounts.filter((a) => a.kind === kind)
    const seasons = accs.flatMap((a) => a.seasons)
    const created = avg(accs.map((a) => a.earned.quest + a.earned.npc))
    rows[PROFILES[kind].label] = {
      账号数: fmt(accs.length),
      "月系统金币收入": fmt(created * per30),
      "月市场净收入": fmt(avg(accs.map((a) => a.earned.market)) * per30),
      "月花在签名池": fmt(avg(accs.map((a) => a.sunk.pool)) * per30),
      "月花在药与突破": fmt(avg(accs.map((a) => a.sunk.potion + a.sunk.breakthrough)) * per30),
      月交税: fmt(avg(accs.map((a) => a.sunk.tax)) * per30),
      期末金币均值: fmt(avg(accs.map((a) => a.coins))),
      每季抽数: fmt(avg(seasons.map((s) => s.pulls)), 1),
      "每季 SSR": fmt(avg(seasons.map((s) => s.ssr)), 2),
      "每季 SSR≥1 占比": `${((seasons.filter((s) => s.ssr >= 1).length / Math.max(1, seasons.length)) * 100).toFixed(0)}%`,
    }
  }
  console.table(rows)

  const mrows: Record<string, Record<string, string>> = {}
  for (const t of TRADE) {
    const m = r.market[t]
    mrows[t] = {
      "心理价值": fmt(r.value[t]),
      期末参考价: fmt(r.refPrice[t]),
      "参考价/心理价值": (r.refPrice[t] / r.value[t]).toFixed(2),
      "NPC 回收价占参考价": `${((NPC_RECYCLE_PRICES[t] / r.refPrice[t]) * 100).toFixed(1)}%`,
      上架数: fmt(m.listed),
      成交数: fmt(m.trades),
      成交率: `${((m.trades / Math.max(1, m.listed)) * 100).toFixed(0)}%`,
      过期数: fmt(m.expired),
      成交金额: fmt(m.volume),
    }
  }
  console.table(mrows)

  const specs = r.accounts.filter((a) => a.kind === "spec")
  const spent = sum(specs.map((a) => a.flip.spent))
  const profit = sum(specs.map((a) => a.flip.revenue - a.flip.tax)) - sum(specs.map((a) => a.flip.spent * (a.flip.sold / Math.max(1, a.flip.bought))))
  console.log(
    `投机者：${DAYS} 天共买入 ${fmt(sum(specs.map((a) => a.flip.bought)))} 张、卖出 ${fmt(sum(specs.map((a) => a.flip.sold)))} 张，` +
      `已卖出部分利润约 ${fmt(profit / specs.length)} 金币/人（投入 ${fmt(spent / specs.length)}/人）。`,
  )
  const farmers = r.accounts.filter((a) => a.kind === "farmer")
  const prog = r.accounts.filter((a) => a.kind === "progressor")
  const farmerIncome = avg(farmers.map((a) => a.earned.quest + a.earned.npc + a.earned.transfer + a.earned.market))
  const progIncome = avg(prog.map((a) => a.earned.quest + a.earned.npc + a.earned.market))
  console.log(
    `多号收割者：本号加 ${ALTS_PER_FARMER} 个小号，${DAYS} 天金币收入 ${fmt(farmerIncome)}，同期推进度者 ${fmt(progIncome)}（${(farmerIncome / Math.max(1, progIncome)).toFixed(1)} 倍）；` +
      `转账交税合计 ${fmt(r.taxTotals.transfer)}。`,
  )
  console.log(`税：上架税 ${fmt(r.taxTotals.list)} + 成交税 ${fmt(r.taxTotals.trade)} + 小号转账税 ${fmt(r.taxTotals.transfer)}。\n`)
}
