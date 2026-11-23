import { prettifyError, z } from "zod"

import { ELEMENTS } from "../types"
import { ENEMY_TIERS, ENEMY_TRAITS, INTENT_KINDS, MAX_SUPPORT_SLOTS, STATUS_IDS, SUPPORT_KINDS } from "./types"

/**
 * 战斗内容：敌人（enemies/*.json）、敌方支援（enemy-supports.json）、遭遇（encounters/*.json）。
 * 文件名就是 id。这里只做校验和组装，不读磁盘——服务端读文件后交给 parseBattleContent。
 */

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, "id 只能用字母、数字和连字符")

/** 新手教学战用的遭遇；教程流程写死引用它，所以内容里必须有 */
export const TUTORIAL_ENCOUNTER_ID = "tutorial-ghost"
/** 遭遇没写 healBudget 时的治疗预算：最大生命的一半 */
export const DEFAULT_HEAL_BUDGET = 0.5
const element = z.enum(ELEMENTS)
const int = z.number().int()

// ---------- AI 条件原语 ----------

export type Condition =
  | { turnMod: [number, number] }
  | { turnAtLeast: number }
  | { supportStacks: { support: string; gte?: number; lte?: number } }
  | { hpBelow: number }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({
      /** [n, r]：回合数 % n === r */
      turnMod: z
        .tuple([int.min(2), int.min(0)])
        .refine(([n, r]) => r < n, "余数必须小于除数"),
    }),
    z.strictObject({ turnAtLeast: int.min(1) }),
    z.strictObject({
      /** 敌方某个支援的层数（不在场按 0 算） */
      supportStacks: z
        .strictObject({ support: id, gte: int.min(0).optional(), lte: int.min(0).optional() })
        .refine((s) => s.gte !== undefined || s.lte !== undefined, "gte / lte 至少写一个"),
    }),
    /** 敌人血量比例低于该值（0–1） */
    z.strictObject({ hpBelow: z.number().gt(0).max(1) }),
    z.strictObject({ all: z.array(conditionSchema).min(1) }),
    z.strictObject({ any: z.array(conditionSchema).min(1) }),
    z.strictObject({ not: conditionSchema }),
  ]),
)

// ---------- 招式与脚本 ----------

const moveFields = {
  label: z.string().min(1),
  desc: z.string(),
  element,
  power: z.number().min(0),
  hits: int.min(0),
  /** 附带 DOWN 威胁 */
  causesDown: z.boolean(),
  /** 难以打断：盲抽权重 ×0.4、成功率 ×0.4 */
  hardToInterrupt: z.boolean(),
  /** 拆除强度 1~3（只对 break_support 有意义，默认 1）：拆得动强度不超过它的我方支援 */
  breakTier: int.min(1).max(3),
  /** 蓄力满槽的大招：释放后清空蓄力支援 */
  chargedUltimate: z.boolean(),
  status: z.enum(STATUS_IDS),
}

const moveSchema = z.strictObject({
  kind: z.enum(INTENT_KINDS),
  ...moveFields,
  hits: moveFields.hits.default(1),
  causesDown: moveFields.causesDown.optional(),
  hardToInterrupt: moveFields.hardToInterrupt.optional(),
  breakTier: moveFields.breakTier.optional(),
  chargedUltimate: moveFields.chargedUltimate.optional(),
  status: moveFields.status.optional(),
  /** 按条件覆盖字段，依次套用（例如「偶数回合附带 DOWN」） */
  variants: z
    .array(z.strictObject({ when: conditionSchema, ...z.object(moveFields).partial().shape }))
    .optional(),
})

const scriptEntrySchema = z.union([
  z.strictObject({ always: id }),
  z.strictObject({ when: conditionSchema, use: id }),
  /** 紧跟在 when 后面：when 不成立时用这个 */
  z.strictObject({ otherwise: id }),
])

export const enemyAiSchema = z.strictObject({
  moves: z.record(id, moveSchema),
  /** 每回合从上到下执行，命中的招式按顺序成为本回合意图 */
  script: z.array(scriptEntrySchema).min(1),
})

/** 窗口弱点：条件成立的回合才露出，回合开始时算一次，整回合固定 */
export const weaknessWindowSchema = z.strictObject({
  when: conditionSchema,
  elements: z.array(element).min(1),
})

export const enemySchema = z.strictObject({
  name: z.string().min(1),
  title: z.string(),
  tier: z.enum(ENEMY_TIERS),
  element,
  /** 公开弱点：一直生效，一直显示 */
  weaknesses: z.array(element),
  /** 隐藏弱点：一直生效，打中一次才显示 */
  hiddenWeaknesses: z.array(element).default([]),
  weaknessWindows: z.array(weaknessWindowSchema).default([]),
  traits: z.array(z.enum(ENEMY_TRAITS)).default([]),
  stats: z.strictObject({ hp: int.positive(), atk: int.min(0), int: int.min(0), def: int.min(0) }),
  enrageOnInterrupt: z.boolean().optional(),
  ai: enemyAiSchema,
})

export const enemySupportSchema = z.strictObject({
  name: z.string().min(1),
  kind: z.enum(SUPPORT_KINDS).exclude(["defense", "aura"]),
  element,
  atk: int.min(0).optional(),
  power: z.number().min(0).optional(),
  hits: int.min(1).optional(),
  procRate: z.number().min(0).max(1).optional(),
  defenseTier: int.min(1).max(4).optional(),
  stacks: int.min(0).optional(),
  maxStacks: int.min(1).optional(),
  /** 硬壳支援：单段伤害低于这个值只算 100 */
  threshold: int.min(1).optional(),
  tier: int.min(1).max(3).optional(),
  roleText: z.string(),
})

// ---------- 三星 ----------

export const starConditionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("turnsAtMost"), value: int.min(1) }),
  z.strictObject({ type: z.literal("noDown") }),
  z.strictObject({ type: z.literal("apSpentAtMost"), value: int.min(0) }),
])

export const encounterSchema = z.strictObject({
  enemy: id,
  supports: z.array(id).max(MAX_SUPPORT_SLOTS).default([]),
  stars: z.array(starConditionSchema).length(3),
  /** 关卡选择处的一句话介绍 */
  summary: z.string(),
  /** 开场日志；缺省为「讨伐开始：遭遇【敌人名】！」 */
  intro: z.string().optional(),
  /** 是否出现在自由讨伐列表里（教学关等不出现） */
  listed: z.boolean().default(true),
  /**
   * 本场治疗预算：最多靠治疗回最大生命的几倍（0.5 = 一半）；"unlimited" = 不限（永动机 BOSS 用）。
   * 治疗技能、生生不息、吸血都算进去，用完就不能再回血
   */
  healBudget: z.union([z.number().min(0).max(3), z.literal("unlimited")]).default(DEFAULT_HEAL_BUDGET),
  /** 战斗背景图名，对应 public/battle-bg/<名>.jpg；缺省用遭遇 id */
  background: id.optional(),
})

export type EnemyAi = z.infer<typeof enemyAiSchema>
export type EnemyMove = z.infer<typeof moveSchema>
export type ScriptEntry = z.infer<typeof scriptEntrySchema>
export type WeaknessWindow = z.infer<typeof weaknessWindowSchema>
export type EnemyDef = z.infer<typeof enemySchema>
export type EnemySupportDef = z.infer<typeof enemySupportSchema>
export type StarCondition = z.infer<typeof starConditionSchema>
export type EncounterDef = z.infer<typeof encounterSchema>

export interface BattleContent {
  enemies: Record<string, EnemyDef>
  supports: Record<string, EnemySupportDef>
  encounters: Record<string, EncounterDef>
}

/** 一场遭遇展开后的全部数据：引擎开战只需要它，前端从接口拿到的也是它 */
export interface EncounterSpec {
  id: string
  summary: string
  intro?: string
  /** 背景图名（public/battle-bg/<名>.jpg）；图不存在时前端退回纯色 */
  background: string
  /** 治疗预算（最大生命的倍数）；"unlimited" 不限 */
  healBudget: number | "unlimited"
  stars: StarCondition[]
  enemy: EnemyDef & { id: string }
  supports: (EnemySupportDef & { id: string })[]
}

/** 讨伐列表里的一项（listed 为 false 的是教学关等，不进选关列表） */
export interface EncounterSummary {
  id: string
  name: string
  title: string
  tier: EnemyDef["tier"]
  element: EnemyDef["element"]
  weaknesses: EnemyDef["weaknesses"]
  /** 只给数量；具体是什么属性要打中才知道 */
  hiddenWeaknessCount: number
  hp: number
  summary: string
  stars: StarCondition[]
  listed: boolean
}

const battleContentSchema = z
  .strictObject({
    enemies: z.record(id, enemySchema),
    supports: z.record(id, enemySupportSchema),
    encounters: z.record(id, encounterSchema),
  })
  .superRefine((content, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message })

    const checkCondition = (cond: Condition, path: (string | number)[]) => {
      if ("supportStacks" in cond && !Object.hasOwn(content.supports, cond.supportStacks.support)) {
        issue([...path, "supportStacks", "support"], `敌方支援 ${cond.supportStacks.support} 不存在`)
      }
      if ("all" in cond) cond.all.forEach((c, i) => checkCondition(c, [...path, "all", i]))
      if ("any" in cond) cond.any.forEach((c, i) => checkCondition(c, [...path, "any", i]))
      if ("not" in cond) checkCondition(cond.not, [...path, "not"])
    }

    for (const [enemyId, enemy] of Object.entries(content.enemies)) {
      const known = new Set(enemy.weaknesses)
      enemy.hiddenWeaknesses.forEach((el, i) => {
        const path = ["enemies", enemyId, "hiddenWeaknesses", i]
        if (known.has(el)) issue(path, `隐藏弱点 ${el} 与公开弱点或其他隐藏弱点重复`)
        known.add(el)
      })
      enemy.weaknessWindows.forEach((window, i) => {
        const path = ["enemies", enemyId, "weaknessWindows", i]
        checkCondition(window.when, [...path, "when"])
        window.elements.forEach((el, j) => {
          if (known.has(el)) issue([...path, "elements", j], `窗口弱点 ${el} 与公开弱点或隐藏弱点重复`)
          if (window.elements.indexOf(el) !== j) issue([...path, "elements", j], `窗口弱点 ${el} 在同一个窗口里重复`)
        })
      })

      const base = ["enemies", enemyId, "ai"]
      const { moves, script } = enemy.ai
      for (const [moveId, move] of Object.entries(moves)) {
        move.variants?.forEach((v, i) => checkCondition(v.when, [...base, "moves", moveId, "variants", i, "when"]))
        const writesBreakTier = move.breakTier !== undefined || move.variants?.some((v) => v.breakTier !== undefined)
        if (writesBreakTier && move.kind !== "break_support") {
          issue([...base, "moves", moveId, "breakTier"], "breakTier 只能写在 break_support 招式上")
        }
      }
      script.forEach((entry, i) => {
        const path = [...base, "script", i]
        const moveId = "always" in entry ? entry.always : "use" in entry ? entry.use : entry.otherwise
        if (!Object.hasOwn(moves, moveId)) issue(path, `招式 ${moveId} 不存在`)
        if ("when" in entry) checkCondition(entry.when, [...path, "when"])
        if ("otherwise" in entry) {
          const prev = script[i - 1]
          if (!prev || !("when" in prev)) issue(path, "otherwise 必须紧跟在 when 后面")
        }
      })
    }

    for (const [supportId, support] of Object.entries(content.supports)) {
      if (support.kind === "charge" && support.maxStacks === undefined) {
        issue(["supports", supportId, "maxStacks"], "蓄力支援必须写 maxStacks")
      }
      if (support.kind === "armor" && support.defenseTier === undefined) {
        issue(["supports", supportId, "defenseTier"], "装甲支援必须写 defenseTier")
      }
      if (support.kind === "shell" && support.threshold === undefined) {
        issue(["supports", supportId, "threshold"], "硬壳支援必须写 threshold")
      }
      if (support.kind !== "shell" && support.threshold !== undefined) {
        issue(["supports", supportId, "threshold"], "threshold 只能写在硬壳支援上")
      }
    }

    for (const [encounterId, encounter] of Object.entries(content.encounters)) {
      const base = ["encounters", encounterId]
      if (!Object.hasOwn(content.enemies, encounter.enemy)) issue([...base, "enemy"], `敌人 ${encounter.enemy} 不存在`)
      encounter.supports.forEach((supportId, i) => {
        if (!Object.hasOwn(content.supports, supportId)) issue([...base, "supports", i], `敌方支援 ${supportId} 不存在`)
        if (encounter.supports.indexOf(supportId) !== i) issue([...base, "supports", i], `敌方支援 ${supportId} 重复`)
      })
      const types = encounter.stars.map((s) => s.type)
      if (new Set(types).size !== types.length) issue([...base, "stars"], "三星条件类型不能重复")
    }

    if (!Object.hasOwn(content.encounters, TUTORIAL_ENCOUNTER_ID)) {
      issue(["encounters"], `缺少教学战遭遇 ${TUTORIAL_ENCOUNTER_ID}`)
    }
    if (!Object.values(content.encounters).some((encounter) => encounter.listed)) {
      issue(["encounters"], "至少要有一场出现在讨伐列表里（listed）的遭遇")
    }
  })

/** 校验整份战斗内容；失败直接抛错（服务端因此拒绝启动） */
export function parseBattleContent(raw: {
  enemies: Record<string, unknown>
  supports: unknown
  encounters: Record<string, unknown>
}): BattleContent {
  // 文件名就是 id；先单独查一遍，报错比 zod 的「Invalid key in record」好懂
  const badIds = (["enemies", "encounters"] as const).flatMap((dir) =>
    Object.keys(raw[dir]).filter((key) => !id.safeParse(key).success).map((key) => `${dir}/${key}.json`),
  )
  if (badIds.length > 0) {
    throw new Error(`战斗内容校验失败：文件名就是 id，只能用字母、数字和连字符：${badIds.join(", ")}`)
  }
  const result = battleContentSchema.safeParse(raw)
  if (!result.success) throw new Error(`战斗内容校验失败：\n${prettifyError(result.error)}`)
  return result.data
}

export function resolveEncounter(content: BattleContent, encounterId: string): EncounterSpec | null {
  const encounter = content.encounters[encounterId]
  if (!encounter) return null
  const enemy = content.enemies[encounter.enemy]!
  return {
    id: encounterId,
    summary: encounter.summary,
    intro: encounter.intro,
    background: encounter.background ?? encounterId,
    healBudget: encounter.healBudget,
    stars: encounter.stars,
    enemy: { id: encounter.enemy, ...enemy },
    supports: encounter.supports.map((supportId) => ({ id: supportId, ...content.supports[supportId]! })),
  }
}

export function listEncounters(content: BattleContent): EncounterSummary[] {
  return Object.entries(content.encounters)
    .map(([encounterId, encounter]) => {
      const enemy = content.enemies[encounter.enemy]!
      return {
        id: encounterId,
        name: enemy.name,
        title: enemy.title,
        tier: enemy.tier,
        element: enemy.element,
        weaknesses: enemy.weaknesses,
        hiddenWeaknessCount: enemy.hiddenWeaknesses.length,
        hp: enemy.stats.hp,
        summary: encounter.summary,
        stars: encounter.stars,
        listed: encounter.listed,
      }
    })
    .sort((a, b) => ENEMY_TIERS.indexOf(a.tier) - ENEMY_TIERS.indexOf(b.tier) || a.hp - b.hp)
}
