// 经济演算（只读，不碰数据库）：直接读 content/ 里的卡包、任务、商店、养成数值，
// 按"每日挂机包额度"不同档位，算每个玩家每月的卡数、稀有度、经验、碎片和金币供需。
// 用法：pnpm --filter @choke/api exec tsx scripts/calc-economy.ts [DAU]
import fs from "node:fs"
import path from "node:path"

import { NPC_RECYCLE_DAILY_LIMIT, NPC_RECYCLE_PRICES } from "@choke/shared/economy"

import { CONTENT_DIR } from "../src/content"

const read = (name: string) => JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, name), "utf8"))
const packsJson = read("packs.json")
const quests = read("quests.json")
const progression = read("progression.json").card

const DAU = Number(process.argv[2] ?? 500)
const DAYS = 28
const WEEKS = 4
const LIMITS = [60, 90, 120, 180]
const RARITIES = ["C", "UC", "R", "E", "L", "Mythic", "Prismatic"] as const
type Rarity = (typeof RARITIES)[number]
type Pool = string

const PACK_SIZE: number = packsJson.packSize
const weightsOf = (pool: Pool): Record<Rarity, number> => {
  const w = packsJson.packs[pool].weights as Partial<Record<Rarity, number>>
  const sum = RARITIES.reduce((s, r) => s + (w[r] ?? 0), 0)
  return Object.fromEntries(RARITIES.map((r) => [r, ((w[r] ?? 0) / sum) * 100])) as Record<Rarity, number>
}

interface Reward {
  coins?: number
  playerExp?: number
  items?: { itemId: string; count: number }[]
  packs?: { pool: string; count: number }[]
}
const EXP_OF_ITEM: Record<string, number> = { "exp-small": 200, "exp-medium": 1000, "exp-large": 5000 }

function addReward(total: { coins: number; exp: number; packs: Record<Pool, number> }, r: Reward | undefined, times: number) {
  if (!r) return
  total.coins += (r.coins ?? 0) * times
  for (const it of r.items ?? []) total.exp += (EXP_OF_ITEM[it.itemId] ?? 0) * it.count * times
  for (const p of r.packs ?? []) total.packs[p.pool] = (total.packs[p.pool] ?? 0) + p.count * times
}

// ---- 常驻来源（日常 / 周常 / 月常任务 + 活跃度宝箱 + 签到），按全部做完算 ----
function routine() {
  const total = { coins: 0, exp: 0, packs: {} as Record<Pool, number> }
  const taskCoins = { daily: 0, weekly: 0, monthly: 0 }
  const times = { daily: DAYS, weekly: WEEKS, monthly: 1 } as const
  for (const q of Object.values<{ period?: string; rewards?: Reward }>(quests.quests)) {
    if (q.period !== "daily" && q.period !== "weekly" && q.period !== "monthly") continue
    addReward(total, q.rewards, times[q.period])
    taskCoins[q.period] += (q.rewards?.coins ?? 0) * times[q.period]
  }
  const chest = { daily: 0, weekly: 0, monthly: 0 }
  for (const period of ["daily", "weekly", "monthly"] as const) {
    for (const tier of quests.activity[period] as { rewards: Reward }[]) {
      addReward(total, tier.rewards, times[period])
      chest[period] += (tier.rewards.coins ?? 0) * times[period]
    }
  }
  const sign = { coins: quests.signIn.base.coins * DAYS }
  total.coins += sign.coins
  for (const bonus of Object.values<Reward>(quests.signIn.bonus)) {
    addReward(total, bonus, 1)
    sign.coins += bonus.coins ?? 0
  }
  return { total, taskCoins, chest, sign }
}

const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })

function cardsFromPacks(packs: Record<Pool, number>) {
  const out = Object.fromEntries(RARITIES.map((r) => [r, 0])) as Record<Rarity, number>
  for (const [pool, count] of Object.entries(packs)) {
    if (!packsJson.packs[pool]) continue
    const w = weightsOf(pool)
    for (const r of RARITIES) out[r] += count * PACK_SIZE * (w[r] / 100)
  }
  return out
}

const sumValues = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)
const R = routine()

console.log(`经济演算：DAU ${DAU}，每月 ${DAYS} 天。数据直接读 content/，不是文档里的数。\n`)

// ① 对账：文档 §4.1 / §8.3 的数和现在 content/ 里的数差多少
console.log("① 常驻来源对账（全部做完）")
console.log("  常驻卡包（每月，包）：", Object.fromEntries(Object.entries(R.total.packs).map(([k, v]) => [k, v])), "合计", sumValues(R.total.packs))
console.log("  文档 §4.1：普通 340 / 黄金 92 / 璀璨 7 / 天穹 1 / 棱彩 1，合计 441")
console.log(
  `  金币（每月）：任务 日${fmt(R.taskCoins.daily)} 周${fmt(R.taskCoins.weekly)} 月${fmt(R.taskCoins.monthly)}；宝箱 日${fmt(R.chest.daily)} 周${fmt(R.chest.weekly)} 月${fmt(R.chest.monthly)}；签到${fmt(R.sign.coins)}`,
)
const questCoins = R.total.coins
console.log(`  合计 ${fmt(questCoins)}（文档 §8.3：不含 NPC 为 13,260）\n`)

// ② 各档额度下的月产出
const dungeonExpLow = 4000 * 9 * DAYS
const dungeonExpHigh = 4000 * 13.5 * DAYS
const feedShare = 0.65
const dismantleShare = 0.25

interface Scenario {
  limit: number
  packs: number
  cards: Record<Rarity, number>
  idleCards: Record<Rarity, number>
  regularCards: Record<Rarity, number>
  feedExp: number
  shards: Record<Rarity, number>
  expSupplyLow: number
  expSupplyHigh: number
}

function scenario(limit: number): Scenario {
  const idle = { idle: limit * DAYS }
  const idleCards = cardsFromPacks(idle)
  const regularCards = cardsFromPacks(R.total.packs)
  const cards = Object.fromEntries(RARITIES.map((r) => [r, idleCards[r] + regularCards[r]])) as Record<Rarity, number>
  const feedExp = RARITIES.reduce((s, r) => s + cards[r] * feedShare * progression.feedExp[r], 0)
  const shards = Object.fromEntries(RARITIES.map((r) => [r, cards[r] * dismantleShare * progression.shardsPerDismantle])) as Record<Rarity, number>
  const base = feedExp + R.total.exp
  return { limit, packs: limit * DAYS + sumValues(R.total.packs), cards, idleCards, regularCards, feedExp, shards, expSupplyLow: base + dungeonExpLow, expSupplyHigh: base + dungeonExpHigh }
}

const scenarios = LIMITS.map(scenario)

console.log("② 每个玩家每月（按每日额度）")
console.table(
  Object.fromEntries(
    scenarios.map((s) => [
      `额度 ${s.limit}`,
      {
        总包数: fmt(s.packs),
        总卡数: fmt(sumValues(s.cards)),
        "挂机占比": `${((s.limit * DAYS) / s.packs * 100).toFixed(0)}%`,
        "全服每月卡(万)": fmt((sumValues(s.cards) * DAU) / 10000, 0),
        "20万池重印次数": fmt((sumValues(s.cards) * DAU) / 200000, 1),
      },
    ]),
  ),
)

console.log("③ 每月每人产出的卡（稀有度），括号内是其中来自挂机包的部分")
console.table(
  Object.fromEntries(
    scenarios.map((s) => [
      `额度 ${s.limit}`,
      Object.fromEntries(RARITIES.map((r) => [r, `${fmt(s.cards[r], 1)} (${fmt(s.idleCards[r], 1)})`])),
    ]),
  ),
)

console.log("④ 经验供需（需求：2 支 2L+2E 满 80 级队 = 2,240,000）")
console.table(
  Object.fromEntries(
    scenarios.map((s) => [
      `额度 ${s.limit}`,
      {
        喂卡经验: fmt(s.feedExp),
        月供给下限: fmt(s.expSupplyLow),
        月供给上限: fmt(s.expSupplyHigh),
        "可拉满队数(下~上)": `${(s.expSupplyLow / 1120000).toFixed(1)} ~ ${(s.expSupplyHigh / 1120000).toFixed(1)}`,
      },
    ]),
  ),
)

console.log("⑤ 分解碎片月产（25% 的卡分解，每张 4 片）与单卡 40→80 突破需求")
const need: Record<Rarity, number> = Object.fromEntries(
  RARITIES.map((r) => [r, Object.values(progression.breakthroughShards[r] as Record<string, number>).reduce((a, b) => a + b, 0)]),
) as Record<Rarity, number>
console.log("  单卡突破碎片：", need)
console.table(
  Object.fromEntries(
    scenarios.map((s) => [
      `额度 ${s.limit}`,
      Object.fromEntries(RARITIES.map((r) => [r, fmt(s.shards[r])])),
    ]),
  ),
)

console.log("⑥ NPC 回收（日限 " + NPC_RECYCLE_DAILY_LIMIT + " 张）能消化多少")
for (const s of scenarios) {
  const total = sumValues(s.cards)
  const cap = NPC_RECYCLE_DAILY_LIMIT * DAYS
  const bag = Math.max(0, total - cap)
  const avg = RARITIES.reduce((sum, r) => sum + s.cards[r] * NPC_RECYCLE_PRICES[r], 0) / total
  console.log(`  额度 ${s.limit}: 月卡 ${fmt(total)} 张，NPC 最多收 ${cap} 张（占 ${((cap / total) * 100).toFixed(1)}%），其余 ${fmt(bag)} 张只能喂养/分解/市场；全部卡的均价 ${avg.toFixed(1)} 金币`)
}

// ⑦ 金币
console.log("\n⑦ 金币（每月每人）：额度只改变卡数，不直接产生金币；系统金币只来自任务/签到/NPC")
const npcIncome = NPC_RECYCLE_DAILY_LIMIT * DAYS * 7
const outlets = {
  体力药: 100 * 2 * DAYS,
  突破金币: 4 * 2000,
  市场税与押金: 1000,
  商店经验箱_燃料包_按限购打满: (150 * 2 + 200 * 2) * DAYS,
  商店盲盒_赌箱_保底包_打满: (40 * 10 + 250 * 3 + 150 * 2) * WEEKS,
}
console.log("  收入：任务/签到", fmt(questCoins), "+ NPC（按每张 7 金币估，日限打满）约", fmt(npcIncome), "=", fmt(questCoins + npcIncome))
console.log("  支出（上限）：", Object.fromEntries(Object.entries(outlets).map(([k, v]) => [k, fmt(v)])))
const basicOut = outlets.体力药 + outlets.突破金币 + outlets.市场税与押金
console.log(`  收入 - 基础支出(体力药+突破+税) = ${fmt(questCoins + npcIncome - basicOut)}（${(((questCoins + npcIncome - basicOut) / (questCoins + npcIncome)) * 100).toFixed(1)}%）`)

// ⑧ 商店"燃料包"对挂机额度的关系
const fuelPerMonth = 3 * 2 * DAYS
console.log(`\n⑧ 商店"绑定燃料包"月上限 ${fuelPerMonth} 包（200 金币 3 包），相当于挂机额度的 ${((fuelPerMonth / (60 * DAYS)) * 100).toFixed(0)}%（额度 60）/ ${((fuelPerMonth / (180 * DAYS)) * 100).toFixed(0)}%（额度 180）`)
console.log("  商店 shard-box-low 每周最多消耗 C 碎片：", 20 * 10, "片；额度 60/180 的月 C 碎片：", fmt(scenarios[0]!.shards.C), "/", fmt(scenarios[3]!.shards.C))

// ⑨ 市场供给：能进市场的 L / Mythic / Prismatic（挂机卡本身没有绑定标记）
console.log("\n⑨ 能进市场的高稀有度卡，月产全服（DAU " + DAU + "）")
console.table(
  Object.fromEntries(
    scenarios.map((s) => [
      `额度 ${s.limit}`,
      {
        "L 全服": fmt(s.cards.L * DAU),
        "其中挂机": fmt(s.idleCards.L * DAU),
        "Mythic 全服": fmt(s.cards.Mythic * DAU),
        "Prismatic 全服": fmt(s.cards.Prismatic * DAU, 1),
        "挂机占 L 比": `${((s.idleCards.L / s.cards.L) * 100).toFixed(0)}%`,
      },
    ]),
  ),
)

// =====================================================================================
// 下面是整套经济的总账：不再只看挂机包，把每种资源的来源和去向、养成一张卡的真实成本、
// 谁是瓶颈、商店的期望值、新手第一周、一次性成就全部算一遍。
// =====================================================================================
const items = read("items.json") as Record<string, { exp: number }>
const shopJson = read("shop.json") as Record<
  string,
  { limit: number; cost: { coins?: number; items?: { itemId: string; count: number }[] }; reward: { kind: string; items?: { itemId: string; count: number }[]; pool?: { weight: number; items: { itemId: string; count: number }[] }[] } }
>
const economyJson = read("economy.json") as { foilEssence: Record<Rarity, number>; foilEssenceMultiplier: number; foilCost: number }

const expOfItems = (list: { itemId: string; count: number }[] = []) => list.reduce((s, it) => s + (items[it.itemId]?.exp ?? EXP_OF_ITEM[it.itemId] ?? 0) * it.count, 0)

const BREAK_COINS = Object.values(progression.breakthroughCoins as Record<string, number>).reduce((a, b) => a + b, 0)
const BREAK_SHARDS = need

console.log("\n\n================ 总账 ================")

// ⑩ 养成一张卡到 80 级要什么
console.log("\n⑩ 养成一张卡 1→80 的完整成本（经验 / 同品质碎片 / 金币），以及用不同来源的资源能养几张")
const feedPerCard = progression.feedExp as Record<Rarity, number>
console.table(
  Object.fromEntries(
    RARITIES.map((r) => [
      r,
      {
        经验: fmt(progression.levelExpTotal[r]),
        "折合同稀有度喂卡张数": fmt(progression.levelExpTotal[r] / feedPerCard[r], 0),
        同品质碎片: BREAK_SHARDS[r],
        突破金币: fmt(BREAK_COINS),
        "洗技能一轮金币": fmt(progression.skillReroll.coins[r] * progression.skillReroll.pityInterval),
      },
    ]),
  ),
)

// 体力分配：每天 240 恢复 + 2 瓶药 = 360
const STAMINA_DAY = 240 + 60 * 2
console.log("\n⑪ 谁是瓶颈？每月最多能把几张 E / L 卡养到 80 级（取最紧的一项）")
console.log(`  体力 ${STAMINA_DAY}/天：50% 刷经验本（9 次/天=36,000 经验）；金币只算任务+签到+NPC 估算，减掉体力药 5,600 和税 1,000`)
const goldForRaising = questCoins + npcIncome - outlets.体力药 - outlets.市场税与押金
const rows: Record<string, Record<string, string>> = {}
for (const s of scenarios) {
  for (const r of ["E", "L"] as const) {
    const byExp = s.expSupplyLow / progression.levelExpTotal[r]
    const byShard = s.shards[r] / BREAK_SHARDS[r]
    const byGold = goldForRaising / BREAK_COINS
    const min = Math.min(byExp, byShard, byGold)
    const which = min === byGold ? "金币" : min === byExp ? "经验" : "碎片"
    rows[`额度 ${s.limit} · ${r}`] = {
      "按经验能养": byExp.toFixed(1),
      "按碎片能养": byShard.toFixed(1),
      "按金币能养": byGold.toFixed(1),
      "实际最多": `${min.toFixed(1)} 张`,
      瓶颈: which,
    }
  }
}
console.table(rows)

// 金币换进度的效率
console.log("\n⑫ 金币能换到多少经验（越大越划算）")
const potionExp = (60 / 20) * 4000
console.log(`  体力药水：100 金币 → 60 体力 → 3 次练习室 = ${fmt(potionExp)} 经验（${(potionExp / 100).toFixed(0)} 经验 / 金币，且受每日 2 瓶限制）`)
console.log(`  经验补给箱：150 金币 → 4,000 经验（${(4000 / 150).toFixed(1)} 经验 / 金币，每日 2 个）`)
console.log(`  绑定燃料包 ×3：200 金币 → 15 张挂机卡 → 约 ${fmt(15 * RARITIES.reduce((s, r) => s + (weightsOf("idle")[r] / 100) * feedPerCard[r], 0))} 经验（折合）`)
console.log(`  突破：每张 2,000 金币，不换经验，只是放行`)
console.log(`  NPC 回收：1 张卡只换 2～450 金币，同一张卡喂养能换 50～9,600 经验`)

// 商店期望
console.log("\n⑬ 商店博弈的期望值（用碎片的经验价值折算，每次）")
const shopRows: Record<string, Record<string, string>> = {}
for (const [id, def] of Object.entries(shopJson)) {
  if (def.reward.kind === "gamble" && def.reward.pool) {
    const totalWeight = def.reward.pool.reduce((s, p) => s + p.weight, 0)
    const ev = def.reward.pool.reduce((s, p) => s + (p.weight / totalWeight) * expOfItems(p.items), 0)
    const costExp = expOfItems(def.cost.items)
    shopRows[id] = { 花费: `${def.cost.coins ?? 0} 金币 + ${fmt(costExp)} 经验的碎片`, 期望产出经验: fmt(ev), 产出占投入: `${((ev / (costExp + (def.cost.coins ?? 0) * 0)) * 100).toFixed(0)}%`, 每周上限: String(def.limit) }
  } else if (def.reward.kind === "fixed" && def.reward.items) {
    const ev = expOfItems(def.reward.items)
    const costExp = expOfItems(def.cost.items)
    shopRows[id] = { 花费: `${def.cost.coins ?? 0} 金币 + ${fmt(costExp)} 经验的碎片`, 期望产出经验: fmt(ev), 产出占投入: costExp ? `${((ev / costExp) * 100).toFixed(0)}%` : "-", 每周上限: String(def.limit) }
  }
}
console.table(shopRows)

// 精华与闪卡
console.log("\n⑭ 闪卡与精华（月，每个玩家）：闪卡被喂养或分解才产精华，镀闪每次 " + economyJson.foilCost + " 精华")
for (const s of scenarios) {
  let foils = 0
  let essence = 0
  const idleCardsByPool: [string, number][] = [["idle", s.limit * DAYS * PACK_SIZE], ...Object.entries(R.total.packs).map(([p, n]) => [p, n * PACK_SIZE] as [string, number])]
  for (const [pool, cardCount] of idleCardsByPool) {
    const w = weightsOf(pool)
    const rate = packsJson.packs[pool]?.foilRate ?? 0
    for (const r of RARITIES) {
      const foilCards = cardCount * (w[r] / 100) * rate
      foils += foilCards
      essence += foilCards * (feedShare + dismantleShare) * economyJson.foilEssence[r] * economyJson.foilEssenceMultiplier
    }
  }
  const dungeonEssence = 0.1 * STAMINA_DAY * DAYS / 20 * 50
  console.log(`  额度 ${s.limit}: 闪卡 ${fmt(foils)} 张；分解/喂养得精华 ${fmt(essence)}；副本 10% 体力再得 ${fmt(dungeonEssence)}；合计 ${fmt(essence + dungeonEssence)} 精华，可镀闪 ${fmt((essence + dungeonEssence) / economyJson.foilCost)} 张`)
}

// 新手第一周
console.log("\n⑮ 新手第一周（第 1～7 天），额度 60 与 120")
const starterPacks: Record<Pool, number> = { starter: packsJson.starterGrant.starter, golden: packsJson.starterGrant.golden }
const week1 = { coins: 0, exp: 0, packs: { ...starterPacks } as Record<Pool, number> }
for (let d = 1; d <= 7; d += 1) addReward(week1, quests.quests[`ach-starter-${d}`]?.rewards, 1)
const daily1 = { coins: 0, exp: 0, packs: {} as Record<Pool, number> }
for (const q of Object.values<{ period?: string; rewards?: Reward }>(quests.quests)) if (q.period === "daily") addReward(daily1, q.rewards, 7)
for (const tier of quests.activity.daily as { rewards: Reward }[]) addReward(daily1, tier.rewards, 7)
addReward(daily1, quests.signIn.bonus["7"], 1)
daily1.coins += quests.signIn.base.coins * 6
for (const [k, v] of Object.entries(daily1.packs)) week1.packs[k] = (week1.packs[k] ?? 0) + v
week1.coins += daily1.coins
week1.exp += daily1.exp
for (const limit of [60, 120]) {
  const packs = { ...week1.packs, idle: limit * 7 }
  const cards = cardsFromPacks(packs)
  const feed = RARITIES.reduce((s, r) => s + cards[r] * feedShare * progression.feedExp[r], 0)
  console.log(`  额度 ${limit}: 包 ${fmt(sumValues(packs))}（挂机 ${limit * 7}），卡 ${fmt(sumValues(cards))}，其中 E ${cards.E.toFixed(0)} / L ${cards.L.toFixed(1)}；喂卡经验 ${fmt(feed)} + 任务经验 ${fmt(week1.exp)} + 7 天练习室 ${fmt(4000 * 9 * 7)}；金币 ${fmt(week1.coins)}`)
}
console.log("  （金币只有 " + fmt(week1.coins) + "：第一周靠它买体力药要 " + fmt(100 * 2 * 7) + "，突破每张 2,000——前期不会缺经验，缺的是金币）")

// 一次性成就
console.log("\n⑯ 一次性成就（不重置，终身只领一次，不含首周补给）")
const once = { coins: 0, exp: 0, packs: {} as Record<Pool, number> }
let onceCount = 0
for (const [id, q] of Object.entries<{ period?: string; rewards?: Reward }>(quests.quests)) {
  if (q.period && q.period !== "once") continue
  if (id.startsWith("ach-starter-")) continue
  onceCount += 1
  addReward(once, q.rewards, 1)
}
console.log(`  ${onceCount} 项，金币 ${fmt(once.coins)}，经验 ${fmt(once.exp)}，卡包`, once.packs, `共 ${sumValues(once.packs)} 包`)

// 汇总一屏
console.log("\n================ 一屏汇总（每玩家每月，额度 60 / 120 / 180）================")
const summary: Record<string, Record<string, string>> = {}
for (const s of scenarios.filter((x) => [60, 120, 180].includes(x.limit))) {
  const total = sumValues(s.cards)
  summary[`额度 ${s.limit}`] = {
    总包: fmt(s.packs),
    总卡: fmt(total),
    "E+ 卡": fmt(s.cards.E + s.cards.L + s.cards.Mythic + s.cards.Prismatic),
    L: s.cards.L.toFixed(1),
    月经验供给: fmt(s.expSupplyLow),
    "可拉满队": (s.expSupplyLow / 1120000).toFixed(1),
    月金币收入: fmt(questCoins + npcIncome),
    "金币能养 E/L 张数": (goldForRaising / BREAK_COINS).toFixed(1),
    "NPC 消化占比": `${((NPC_RECYCLE_DAILY_LIMIT * DAYS / total) * 100).toFixed(1)}%`,
  }
}
console.table(summary)
