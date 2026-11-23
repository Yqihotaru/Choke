import { prettifyError, z } from "zod"

import { SKILLS, type SkillDef } from "./skills"
import { ELEMENTS, ELEMENT_LABEL, RARITIES } from "./types"

/* ======================== 校验 ======================== */

const STATUS_IDS = [
  "freeze", "shock", "burn", "poison", "fear", "charm", "bleed", "confuse", "curse",
  "silence", "armor_break", "stun", "sleep", "heal_block", "weaken", "slow", "support_ban", "thorns",
] as const

const STATUS_LABEL: Record<(typeof STATUS_IDS)[number], string> = {
  freeze: "冻结", shock: "触电", burn: "燃烧", poison: "中毒", fear: "恐惧", charm: "魅惑", bleed: "流血",
  confuse: "混乱", curse: "诅咒", silence: "沉默", armor_break: "破甲", stun: "眩晕", sleep: "沉睡",
  heal_block: "禁疗", weaken: "衰弱", slow: "迟缓", support_ban: "禁援", thorns: "荆棘",
}

const selfStatus = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  amount: z.number(),
  turns: z.int().min(1),
})

const supportDef = z.strictObject({
  kind: z.enum(["attack", "armor", "aura", "thorns"]),
  name: z.string().min(1),
  element: z.enum(ELEMENTS),
  power: z.number().positive().optional(),
  hits: z.int().min(1).optional(),
  combo: z.int().min(0).max(3).optional(),
  procRate: z.number().min(0).max(1).optional(),
  armorTier: z.int().min(1).optional(),
  stat: z.enum(["atk", "int", "def"]).optional(),
  amount: z.number().optional(),
  tier: z.int().min(1).max(3).optional(),
  roleText: z.string().min(1),
})

const ratio = z.number().positive().max(1)

const skillSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z]+_[a-z0-9_]+$/, "id 只能用小写字母、数字和下划线，形如 <流派>_<动词>"),
    name: z.string().min(1).max(8),
    job: z.enum(["tank", "warrior", "mage", "support"]),
    element: z.enum(ELEMENTS),
    ap: z.int().min(0).max(5),
    kind: z.enum(["damage", "heal", "guard", "taunt", "buff", "debuff", "control", "interrupt", "ap", "summon", "passive"]),
    costTag: z.enum(["normal", "accumulate", "once"]).optional(),
    power: z.number().positive().max(10).optional(),
    hits: z.int().min(1).max(10).optional(),
    target: z.enum(["enemy", "self", "ally", "team"]).optional(),
    stat: z.enum(["atk", "int", "def"]).optional(),
    amount: z.number().positive().optional(),
    turns: z.int().min(1).max(10).optional(),
    once: z.boolean().optional(),
    passive: z.boolean().optional(),
    statusId: z.enum(STATUS_IDS).optional(),
    statusChance: ratio.optional(),
    selfHpCostPct: ratio.optional(),
    piercePct: ratio.optional(),
    executeBonus: z.number().positive().max(3).optional(),
    executeWhen: z.array(z.enum(["vulnerable", "lowHp"])).min(1).max(2).optional(),
    clearEnemySupports: z.int().min(1).max(5).optional(),
    breakTier: z.int().min(1).max(3).optional(),
    supportDef: supportDef.optional(),
    /** 手写文案；留空则由 describeSkill 自动生成 */
    desc: z.string().min(1).optional(),
    minRarity: z.enum(RARITIES).optional(),

    openingStatus: selfStatus.optional(),
    defMul: z.number().min(1).max(2).optional(),
    lowHpMul: z.number().min(1).max(2).optional(),
    lifesteal: ratio.optional(),
    spellCrit: z.number().positive().max(50).optional(),
    swift: z.boolean().optional(),
    critVsVulnerable: z.number().positive().max(50).optional(),
    regenPct: ratio.optional(),
    controlBonus: ratio.optional(),
    supportProcBonus: ratio.optional(),
    apRegenBonus: z.int().min(1).max(3).optional(),
    healBonus: ratio.optional(),
    triggerBonus: ratio.optional(),
    supportShield: ratio.optional(),

    unlockTurn: z.int().min(2).max(10).optional(),
    cleanse: z.boolean().optional(),
    boostAllies: z.int().min(1).max(3).optional(),
    revive: z.union([z.literal("all"), z.int().min(1).max(4)]).optional(),
    selfStatus: selfStatus.optional(),
  })
  .superRefine((def, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message })
    const has = (key: keyof typeof def) => def[key] !== undefined
    const PASSIVE_KEYS = [
      "openingStatus", "defMul", "lowHpMul", "lifesteal", "spellCrit", "swift", "critVsVulnerable", "regenPct",
      "controlBonus", "supportProcBonus", "apRegenBonus", "healBonus", "triggerBonus", "supportShield",
    ] as const

    if (def.passive) {
      if (def.kind !== "passive") fail("passive 为真时 kind 必须是 passive")
      if (def.ap !== 0) fail("被动技能 ap 必须是 0")
      if (!PASSIVE_KEYS.some(has)) fail("被动技能必须声明至少一个效果字段")
      for (const key of ["power", "hits", "statusId", "unlockTurn", "cleanse", "boostAllies", "revive", "selfStatus", "supportDef"] as const) {
        if (has(key)) fail(`被动技能不能带主动字段 ${key}`)
      }
      return
    }
    if (def.kind === "passive") fail("kind 为 passive 时必须标 passive: true")
    for (const key of PASSIVE_KEYS) if (has(key)) fail(`主动技能不能带被动效果字段 ${key}`)

    if (has("statusId") && !has("turns")) fail("带状态的技能必须写 turns")
    if (has("statusChance") && !has("statusId")) fail("statusChance 必须配合 statusId")
    if (def.kind === "control") {
      if (has("statusChance")) fail("硬控技能不写 statusChance（硬控另有判定）")
    } else if (has("statusId") && !has("statusChance")) {
      fail("带状态的技能必须写 statusChance")
    }
    if (has("executeBonus") !== has("executeWhen")) fail("executeBonus 与 executeWhen 必须同时写")
    if (def.executeWhen && new Set(def.executeWhen).size !== def.executeWhen.length) fail("executeWhen 不能重复")
    if (has("clearEnemySupports") !== has("breakTier")) fail("clearEnemySupports 与 breakTier 必须同时写")
    if (has("hits") && !has("power")) fail("写了 hits 就必须写 power")
    if (has("cleanse") && def.kind !== "heal") fail("cleanse 只能用在 heal 技能上")
    if (has("revive") && def.kind !== "heal") fail("revive 只能用在 heal 技能上")
    if (has("boostAllies") && def.kind !== "buff") fail("boostAllies 只能用在 buff 技能上")
    if (has("selfStatus") && def.kind !== "taunt") fail("selfStatus 目前只能用在 taunt 技能上")
    if (def.once && def.costTag === "accumulate") fail("once 与 accumulate 费用标签冲突")

    switch (def.kind) {
      case "damage":
        if (!has("power") || !has("hits")) fail("damage 必须写 power 和 hits")
        break
      case "heal":
      case "guard":
        if (!has("power")) fail(`${def.kind} 必须写 power`)
        break
      case "interrupt":
        if (!has("power") || !has("hits")) fail("interrupt 必须写 power 和 hits")
        break
      case "control":
        if (!has("statusId")) fail("control 必须写 statusId")
        break
      case "debuff":
        if (!has("statusId")) fail("debuff 必须写 statusId")
        break
      case "summon":
        if (!has("supportDef")) fail("summon 必须写 supportDef")
        break
      case "ap":
        if (!has("amount")) fail("ap 必须写 amount")
        break
      case "buff":
        if (!has("stat") || !has("amount") || !has("turns")) fail("buff 必须写 stat、amount 和 turns")
        break
      case "taunt":
        if (!has("selfStatus")) fail("taunt 必须写 selfStatus")
        break
    }
  })

/** 检查一个技能定义；返回错误列表（空表示通过） */
export function checkSkill(def: unknown): string[] {
  const result = skillSchema.safeParse(def)
  return result.success ? [] : prettifyError(result.error).split("\n")
}

/** 检查整张技能表：每个技能自身合法、id 与键一致、名字不重复 */
export function checkSkillTable(table: Record<string, SkillDef> = SKILLS): string[] {
  const problems: string[] = []
  const names = new Map<string, string>()
  for (const [key, def] of Object.entries(table)) {
    for (const line of checkSkill(def)) problems.push(`${key}：${line}`)
    if (def.id !== key) problems.push(`${key}：表里的键与 id（${def.id}）不一致`)
    const other = names.get(def.name)
    if (other) problems.push(`${key}：名字「${def.name}」与 ${other} 重复`)
    names.set(def.name, key)
  }
  return problems
}

/* ======================== 描述 ======================== */

const pct = (value: number) => `${Math.round(value * 100)}%`
const STAT_LABEL = { atk: "ATK", int: "INT", def: "DEF" } as const

/** 按字段自动生成的描述（不看手写文案） */
export function autoDescribeSkill(def: SkillDef): string {
  const parts: string[] = []
  const element = def.element === "physical" ? "" : ELEMENT_LABEL[def.element]
  const hitText = (def.hits ?? 1) > 1 ? `${def.hits} 段，每段` : ""

  if (def.passive) {
    if (def.openingStatus) parts.push(`开局自身获得${def.openingStatus.name}（${pct(def.openingStatus.amount)}，${def.openingStatus.turns} 回合）`)
    if (def.defMul) parts.push(`自身 DEF +${pct(def.defMul - 1)}`)
    if (def.lowHpMul) parts.push(`队伍血量低于 30% 时自身 ATK/INT +${pct(def.lowHpMul - 1)}`)
    if (def.lifesteal) parts.push(`造成伤害的 ${pct(def.lifesteal)} 回复给队伍`)
    if (def.spellCrit) parts.push(`队伍血量低于 30% 时法术暴击率 +${def.spellCrit}%`)
    if (def.swift) parts.push("命中 +5%，可在敌方行动前抢攻")
    if (def.critVsVulnerable) parts.push(`对脆弱目标暴击率 +${def.critVsVulnerable}%`)
    if (def.regenPct) parts.push(`每回合队伍回复 ${pct(def.regenPct)} 最大生命`)
    if (def.controlBonus) parts.push(`硬控成功率 +${pct(def.controlBonus)}`)
    if (def.supportProcBonus) parts.push(`攻击型支援发动率 +${pct(def.supportProcBonus)}`)
    if (def.apRegenBonus) parts.push(`每回合 AP 恢复 +${def.apRegenBonus}`)
    if (def.healBonus) parts.push(`治疗量 +${pct(def.healBonus)}`)
    if (def.triggerBonus) parts.push(`Boost 与必杀触发概率 +${pct(def.triggerBonus)}`)
    if (def.supportShield) parts.push(`敌方拆除我方侧面支援时，每个目标 ${pct(def.supportShield)} 概率免于被拆`)
    return parts.join("；")
  }

  if (def.unlockTurn) parts.push(`第 ${def.unlockTurn} 回合起可用`)
  switch (def.kind) {
    case "damage":
    case "interrupt":
      parts.push(`${hitText}造成 ${pct(def.power ?? 0)} ${element}伤害`.replace("  ", " "))
      if (def.piercePct) parts.push(`无视目标 ${pct(def.piercePct)} 防御`)
      if (def.executeBonus && def.executeWhen) {
        const label = def.executeWhen.map((c) => (c === "vulnerable" ? "处于【脆弱】" : "血量低于 40%")).join("或")
        parts.push(`目标${label}时伤害 +${pct(def.executeBonus)}`)
      }
      if (def.selfHpCostPct) parts.push(`消耗队伍 ${pct(def.selfHpCostPct)} 生命`)
      if (def.clearEnemySupports) parts.push(`清除敌方 ${def.clearEnemySupports} 个强度 ≤${def.breakTier ?? 1} 的侧面支援`)
      if (def.kind === "interrupt") parts.push("打断敌方蓄力")
      break
    case "heal":
      if (def.power) parts.push(`为队伍回复 ${pct(def.power)} INT 的生命`)
      if (def.cleanse) parts.push("清除队伍所有负面状态")
      if (def.revive) parts.push(def.revive === "all" ? "救醒所有倒下的队友" : `救醒 ${def.revive} 名倒下的队友`)
      break
    case "guard":
      parts.push(`为队伍提供 ${pct(def.power ?? 0)} DEF 的护盾`)
      break
    case "taunt":
      parts.push("吸引敌方攻击")
      break
    case "buff":
      if (def.stat && def.amount) parts.push(`全队 ${STAT_LABEL[def.stat]} +${pct(def.amount)}，持续 ${def.turns} 回合`)
      if (def.boostAllies) parts.push(`点亮 ${def.boostAllies} 名未行动队友的 BOOST`)
      break
    case "ap":
      parts.push(`获得 ${def.amount} 点 AP`)
      break
    case "summon":
      if (def.supportDef) {
        const tier = def.supportDef.tier ?? 1
        parts.push(`布置${tier > 1 ? `强度 ${tier} 的` : ""}侧面支援【${def.supportDef.name}】：${def.supportDef.roleText}`)
      }
      break
    case "control":
    case "debuff":
      if ((def.power ?? 0) > 0) parts.push(`${hitText}造成 ${pct(def.power ?? 0)} ${element}伤害`)
      if (def.clearEnemySupports) parts.push(`清除敌方 ${def.clearEnemySupports} 个强度 ≤${def.breakTier ?? 1} 的侧面支援`)
      break
  }
  if (def.statusId) {
    const chance = def.statusChance !== undefined ? `（几率 ${pct(def.statusChance)}）` : ""
    parts.push(`附加${STATUS_LABEL[def.statusId]}，持续 ${def.turns} 回合${chance}`)
  }
  if (def.selfStatus) parts.push(`自身获得${def.selfStatus.name}（${pct(def.selfStatus.amount)}，${def.selfStatus.turns} 回合）`)
  if (def.once) parts.push("整场限用 1 次")
  return parts.join("；")
}

/** 界面显示的技能描述：有手写文案用手写，没有则自动生成 */
export function describeSkill(def: SkillDef): string {
  if (def.desc === undefined) return autoDescribeSkill(def)
  return def.statusChance !== undefined ? `${def.desc} · 状态几率 ${pct(def.statusChance)}` : def.desc
}
