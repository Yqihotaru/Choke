// 技能伤害报告：固定条件下实测每个伤害类技能的伤害，找出"打出来不尽如人意"的技能。
//
// 用法：pnpm --filter @choke/api exec tsx scripts/skill-report.ts [--level 60] [--rarity L] [--def 1500] [--seeds 300] [--write Design/技能伤害报告.md]
//
// 测量条件：
// - 攻击方：一张被测卡（默认 L 级 60 级、无命座）+ 一张不动的坦克陪衬卡，清掉本回合 Boost / 必杀 / 连击
// - 敌人：属性中立、没有弱点、没有支援、DEF 与 INT 都是 --def 的木桩，血量取极大，所以不会被打死
// - 每个技能每个种子各打一次：Combo=0（冷启动）和 Combo=6（打到中段）各一组
// 只量单次施放的直接伤害；中毒、流血等持续伤害和纯辅助效果不在这里。
import { writeFileSync } from "node:fs"

import { withAction } from "@choke/shared/battle/actions"
import { resolveEncounter, type EncounterSpec } from "@choke/shared/battle/content"
import { createBattle } from "@choke/shared/battle/engine"
import type { BattleState } from "@choke/shared/battle/types"
import { JOB_ORDER, SKILLS, type SkillDef } from "@choke/shared/skills"
import { ELEMENT_LABEL, type Job, type Rarity } from "@choke/shared/types"

import { BATTLE_CONTENT } from "../src/content"
import { face, inputs } from "./lib/battle-bot"

const argv = process.argv.slice(2)
const arg = (name: string, fallback: string) => {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 && argv[at + 1] ? argv[at + 1]! : fallback
}
const LEVEL = Number(arg("level", "60"))
const RARITY = arg("rarity", "L") as Rarity
const REF_DEF = Number(arg("def", "1500"))
const SEEDS = Number(arg("seeds", "300"))
const WRITE_TO = argv.includes("--write") ? arg("write", "") : ""
const WARM_COMBO = 6

const JOB_LABEL: Record<Job, string> = { tank: "坦克", warrior: "战士", mage: "法师", support: "辅助" }
const COST_TAG: Record<string, string> = { normal: "", accumulate: "累积", once: "单次" }

const base = resolveEncounter(BATTLE_CONTENT, "ghost")!
const dummy: EncounterSpec = structuredClone(base)
dummy.supports = []
dummy.enemy.element = "physical"
dummy.enemy.traits = []
dummy.enemy.weaknesses = []
dummy.enemy.hiddenWeaknesses = []
dummy.enemy.weaknessWindows = []
dummy.enemy.stats = { hp: 1e9, atk: 600, int: REF_DEF, def: REF_DEF }

const BIG_HP = 1e12

function setup(job: Job, skillId: string, seed: string, combo: number): BattleState {
  const cards = inputs(
    [face("under-test", job, RARITY, LEVEL, 0, [skillId]), face("filler", "tank", RARITY, LEVEL, 0, ["bulwark_quake"])],
    10,
  )
  const s = createBattle(dummy, cards, { apMax: 10, seed })
  for (const card of s.cards) card.trigger = null
  s.ap = 10
  s.combo = combo
  s.enemy.hp = s.enemy.hpMax = BIG_HP
  return s
}

function cast(state: BattleState, skillId: string): BattleState {
  const result = withAction(state, { type: "skill", card: 0, skill: skillId })
  if (result.error) throw new Error(`${skillId} 施放失败：${result.error}`)
  return result.state
}

interface Row {
  skill: SkillDef
  cold: number
  warm: number
  hitRate: number
  statusRate: number | null
  statUsed: "ATK" | "INT"
  statUtil: number
  effectiveAp: number
  perApWarm: number
  note: string
}

function measure(skill: SkillDef): Row {
  let cold = 0
  let warm = 0
  let landed = 0
  let swings = 0
  let statusHit = 0
  for (let i = 0; i < SEEDS; i += 1) {
    const seed = `report-${skill.id}-${i}`
    const a = setup(skill.job, skill.id, seed, 0)
    cold += BIG_HP - cast(a, skill.id).enemy.hp
    const b = setup(skill.job, skill.id, seed, WARM_COMBO)
    const after = cast(b, skill.id)
    warm += BIG_HP - after.enemy.hp
    const hits = after.events.filter((e) => e.type === "damage" && e.target === "enemy").length
    landed += hits
    swings += skill.hits ?? 1
    if (skill.statusId && after.enemy.statuses.some((s) => s.id === skill.statusId)) statusHit += 1
  }
  const probe = setup(skill.job, skill.id, "probe", 0).cards[0]!
  const magic = skill.element !== "physical"
  const used = magic ? probe.stats.int : probe.stats.atk
  const best = Math.max(probe.stats.atk, probe.stats.int)
  const effectiveAp = skill.ap === 0 ? 0.5 : skill.ap
  const notes: string[] = []
  if (skill.selfHpCostPct) notes.push(`扣队伍 ${Math.round(skill.selfHpCostPct * 100)}% 生命`)
  if (skill.executeBonus) notes.push(`斩杀 +${Math.round(skill.executeBonus * 100)}%（本表不计）`)
  if (skill.clearEnemySupports) notes.push(`拆 ${skill.clearEnemySupports} 个支援`)
  if (skill.kind === "interrupt") notes.push("含打断")
  if (skill.ap === 0) notes.push("0 费按每回合 0.5 AP 折算")
  return {
    skill,
    cold: cold / SEEDS,
    warm: warm / SEEDS,
    hitRate: landed / swings,
    statusRate: skill.statusId ? statusHit / SEEDS : null,
    statUsed: magic ? "INT" : "ATK",
    statUtil: used / best,
    effectiveAp,
    perApWarm: warm / SEEDS / effectiveAp,
    note: notes.join("；"),
  }
}

/** 召唤攻击型支援：放下后第一次回合初发动的期望伤害 */
function measureSummon(skill: SkillDef) {
  let total = 0
  for (let i = 0; i < SEEDS; i += 1) {
    const s = cast(setup(skill.job, skill.id, `report-sup-${skill.id}-${i}`, 0), skill.id)
    const before = s.enemy.hp
    const next = withAction(s, { type: "endTurn" })
    if (next.error) throw new Error(next.error)
    total += before - next.state.enemy.hp
  }
  return total / SEEDS
}

const num = (v: number) => Math.round(v).toLocaleString("en-US")
const pct = (v: number) => `${Math.round(v * 100)}%`
const median = (values: number[]) => {
  const sorted = [...values].sort((x, y) => x - y)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

const out: string[] = []
const line = (text = "") => out.push(text)

line(`# 技能伤害报告（快照）`)
line()
line(`> 生成方式：\`pnpm --filter @choke/api exec tsx scripts/skill-report.ts\`。条件：${RARITY} 级 ${LEVEL} 级无命座的卡，木桩 DEF/INT ${REF_DEF}、属性中立无弱点，每技能 ${SEEDS} 个种子；热身 Combo=${WARM_COMBO}。`)
line(`> 只量单次施放的直接伤害，持续伤害（中毒、流血、燃烧）和辅助效果不计。`)
line()

line(`## 一、各职业的面板`)
line()
line(`| 职业 | ATK | INT | 吃 ATK 的技能 | 吃 INT 的技能 |`)
line(`|---|--:|--:|---|---|`)
for (const job of JOB_ORDER) {
  const probe = setup(job, "bulwark_quake", "probe", 0).cards[0]!
  line(`| ${JOB_LABEL[job]} | ${num(probe.stats.atk)} | ${num(probe.stats.int)} | 只有物理属性 | 其他所有属性（火冰雷木土金光暗） |`)
}
line()
line(`伤害公式里 \`非物理属性 = 魔法 = 吃 INT\`，物理属性才吃 ATK。所以战士和坦克的"属性利用率"取决于技能是不是物理属性。`)
line()

const allRows: Row[] = []
const verdicts: string[] = []
for (const job of JOB_ORDER) {
  const skills = Object.values(SKILLS).filter(
    (s) => s.job === job && !s.passive && s.power !== undefined && (s.kind === "damage" || s.kind === "debuff" || s.kind === "interrupt"),
  )
  const rows = skills.map(measure)
  allRows.push(...rows)
  const med = median(rows.map((r) => r.perApWarm))
  rows.sort((x, y) => y.perApWarm - x.perApWarm)
  const phys = rows.filter((r) => r.statUsed === "ATK")
  const magic = rows.filter((r) => r.statUsed === "INT")

  line(`## 二、${JOB_LABEL[job]}：直接伤害技能（${rows.length} 个）`)
  line()
  line(`同职业每 AP 伤害（Combo ${WARM_COMBO}）中位数：**${num(med)}**。「对比」是该技能相对这个中位数的比例。`)
  if (phys.length > 0 && magic.length > 0) {
    line(`物理技能（吃 ATK，${phys.length} 个）中位数 **${num(median(phys.map((r) => r.perApWarm)))}**；非物理技能（吃 INT，${magic.length} 个）中位数 **${num(median(magic.map((r) => r.perApWarm)))}**。`)
  }
  line()
  line(`| 技能 | AP | 倍率 | 属性 | 吃 | 利用率 | 命中 | 冷启动 | 热身 | 每 AP | 对比 | 状态挂上 | 备注 |`)
  line(`|---|--:|---|---|---|--:|--:|--:|--:|--:|--:|--:|---|`)
  for (const r of rows) {
    const s = r.skill
    const ratio = r.perApWarm / med
    const flag = ratio < 0.7 ? " ⚠偏弱" : ratio > 1.4 ? " 偏强" : ""
    if (ratio < 0.7) verdicts.push(`${JOB_LABEL[job]}｜${s.name}（${s.id}）每 AP ${num(r.perApWarm)}，只有同职业中位数的 ${pct(ratio)}`)
    const tag = COST_TAG[s.costTag ?? "normal"]
    const power = `${s.power}×${s.hits ?? 1}`
    line(
      `| ${s.name}${tag ? `（${tag}）` : ""} | ${s.ap} | ${power} | ${s.element === "physical" ? "物理" : ELEMENT_LABEL[s.element]} | ${r.statUsed} | ${pct(r.statUtil)} | ${pct(r.hitRate)} | ${num(r.cold)} | ${num(r.warm)} | ${num(r.perApWarm)} | ${pct(ratio)}${flag} | ${r.statusRate === null ? "—" : `${s.statusId} ${pct(r.statusRate)}`} | ${r.note} |`,
    )
  }
  line()
}

line(`## 三、召唤攻击型支援（第一次发动的期望伤害）`)
line()
line(`放下之后每回合初有几率自动出手，支援会一直在场，所以真正的价值是"发动回合数 × 每次期望"。下表只量第一次回合初。`)
line()
line(`| 技能 | 职业 | AP | 支援 | 发动率 | 单次出手 | 第一次回合初期望伤害 | 每 AP（首回合） |`)
line(`|---|---|--:|---|--:|---|--:|--:|`)
for (const skill of Object.values(SKILLS).filter((s) => s.kind === "summon" && s.supportDef?.kind === "attack")) {
  const def = skill.supportDef!
  const exp = measureSummon(skill)
  line(
    `| ${skill.name}${COST_TAG[skill.costTag ?? "normal"] ? `（${COST_TAG[skill.costTag ?? "normal"]}）` : ""} | ${JOB_LABEL[skill.job]} | ${skill.ap} | ${def.name}（强度 ${def.tier ?? 1}） | ${pct(def.procRate ?? 1)} | ${def.power}×${def.hits ?? 1}，+${(def.combo ?? 0) * (def.hits ?? 1)} Combo | ${num(exp)} | ${num(exp / Math.max(skill.ap, 0.5))} |`,
  )
}
line()

line(`## 四、各职业整体对比`)
line()
line(`| 职业 | 伤害技能数 | 每 AP 伤害中位数（热身） | 冷启动 / 热身 | 平均命中 |`)
line(`|---|--:|--:|--:|--:|`)
for (const job of JOB_ORDER) {
  const rows = allRows.filter((r) => r.skill.job === job)
  const warmMed = median(rows.map((r) => r.perApWarm))
  const coldTotal = rows.reduce((sum, r) => sum + r.cold, 0)
  const warmTotal = rows.reduce((sum, r) => sum + r.warm, 0)
  const hit = rows.reduce((sum, r) => sum + r.hitRate, 0) / rows.length
  line(`| ${JOB_LABEL[job]} | ${rows.length} | ${num(warmMed)} | ${pct(coldTotal / warmTotal)} | ${pct(hit)} |`)
}
line()

line(`## 五、被标成"偏弱"的技能（每 AP 低于同职业中位数 70%）`)
line()
if (verdicts.length === 0) line(`没有。`)
for (const v of verdicts) line(`- ${v}`)
line()

console.log(out.join("\n"))
if (WRITE_TO) {
  writeFileSync(WRITE_TO, `${out.join("\n")}\n`, "utf8")
  console.log(`\n已写入 ${WRITE_TO}`)
}
