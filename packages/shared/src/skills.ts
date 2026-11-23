import { hashSeed, nextRandom } from "./rng"
import type { CardSkill, CardSkillRef, Element, Job, Rarity } from "./types"

export type SkillKind =
  | "damage"
  | "heal"
  | "guard"
  | "taunt"
  | "buff"
  | "debuff"
  | "control"
  | "interrupt"
  | "ap"
  | "summon"
  | "passive"

/**
 * 技能费用标签（卡牌数值与战斗机制 v0.1 §6.5）。
 * 疲惫是所有主动技能的通用机制（这张卡上回合用过该技能，本回合 +1 AP，不叠层），不再是标签：
 * - normal: 常态固定费用
 * - accumulate: 远征累积（每用 1 次，本场/远征永久 +1 AP）
 * - once: 单次（整场战斗限用 1 次）
 */
export type SkillCostTag = "normal" | "accumulate" | "once"

export type ExecuteCondition = "vulnerable" | "lowHp"

export interface SupportSpawnDef {
  kind: "attack" | "armor" | "aura" | "thorns"
  name: string
  element: Element
  power?: number
  hits?: number
  /** 每段命中给 Combo 加几层（默认 0） */
  combo?: number
  procRate?: number
  armorTier?: number
  stat?: "atk" | "int" | "def"
  amount?: number
  /** 支援强度 1~3（默认 1） */
  tier?: number
  roleText: string
}

export interface SelfStatusDef {
  id: string
  name: string
  amount: number
  turns: number
}

/** 被动效果：只有卡上带着这个技能才生效，卡被 Down 则失效 */
export type NumericEffectKey =
  | "regenPct"
  | "controlBonus"
  | "supportProcBonus"
  | "apRegenBonus"
  | "healBonus"
  | "triggerBonus"
  | "supportShield"

export interface SkillDef {
  id: string
  name: string
  /** 技能所属大职业（技能池按它划分） */
  job: Job
  element: Element
  ap: number
  kind: SkillKind
  costTag?: SkillCostTag
  power?: number
  hits?: number
  target?: "enemy" | "self" | "ally" | "team"
  stat?: "atk" | "int" | "def"
  amount?: number
  turns?: number
  once?: boolean
  passive?: boolean
  /** 附加异常状态 ID（对应 §11.1 状态表） */
  statusId?:
    | "freeze"
    | "shock"
    | "burn"
    | "poison"
    | "fear"
    | "charm"
    | "bleed"
    | "confuse"
    | "curse"
    | "silence"
    | "armor_break"
    | "stun"
    | "sleep"
    | "heal_block"
    | "weaken"
    | "slow"
    | "support_ban"
    | "thorns"
  /** 状态附带几率（0–1，基础值，会再乘敌人档位修正）；伤害/减益技能带状态时必写，硬控另有判定 */
  statusChance?: number
  selfHpCostPct?: number
  /** 穿甲：无视目标部分 DEF/减伤比例 */
  piercePct?: number
  /** 斩杀加成：满足 executeWhen 任一条件时额外倍率 */
  executeBonus?: number
  /** 斩杀触发条件（满足任一即触发）：vulnerable = 目标脆弱；lowHp = 目标当前血量低于 40% */
  executeWhen?: ExecuteCondition[]
  /** 清除敌方侧面支援数量 */
  clearEnemySupports?: number
  /** 拆除强度 1~3：只拆得动强度不超过它的敌方支援；写了 clearEnemySupports 必须写 */
  breakTier?: number
  supportDef?: SupportSpawnDef
  /** 手写文案（覆盖）；留空则由 describeSkill 按字段自动生成 */
  desc?: string
  /** 最低发放稀有度，默认 C；队伍核心与特殊机制技能只进最高档（发牌规则暂未按它过滤） */
  minRarity?: Rarity

  /* ---- 被动效果声明 ---- */
  /** 开局给自己上的状态 */
  openingStatus?: SelfStatusDef
  /** 自身 DEF 倍率 */
  defMul?: number
  /** 队伍血量低于 30% 时自身 ATK/INT 倍率 */
  lowHpMul?: number
  /** 造成伤害的吸血比例 */
  lifesteal?: number
  /** 队伍低血时法术暴击率加成（百分点） */
  spellCrit?: number
  /** 迅捷：命中 +5，可抢攻 */
  swift?: boolean
  /** 对脆弱目标暴击率加成（百分点） */
  critVsVulnerable?: number
  /** 每回合队伍回复最大生命比例 */
  regenPct?: number
  /** 硬控成功率加成 */
  controlBonus?: number
  /** 攻击型支援发动率加成 */
  supportProcBonus?: number
  /** 每回合 AP 恢复加成 */
  apRegenBonus?: number
  /** 治疗量加成 */
  healBonus?: number
  /** Boost / 必杀 / 连击概率加成 */
  triggerBonus?: number
  /** 敌方拆我方支援时，每个目标免拆概率 */
  supportShield?: number

  /* ---- 主动技能效果字段 ---- */
  /** 第 N 回合起才能用 */
  unlockTurn?: number
  /** 净化全队负面状态 */
  cleanse?: boolean
  /** 为 N 张未行动队友点亮 BOOST */
  boostAllies?: number
  /** 救醒倒下的队友："all" 或指定张数 */
  revive?: "all" | number
  /** 对自己施加的状态 */
  selfStatus?: SelfStatusDef
}

/** 大职业四维权重（四维合计 4.00） */
export const JOB_STAT_WEIGHTS: Record<Job, { hp: number; atk: number; def: number; int: number }> = {
  tank: { hp: 1.35, atk: 0.75, def: 1.3, int: 0.6 },
  warrior: { hp: 0.95, atk: 1.3, def: 0.85, int: 0.9 },
  mage: { hp: 0.85, atk: 0.65, def: 0.8, int: 1.7 },
  support: { hp: 1.0, atk: 0.55, def: 0.9, int: 1.55 },
}

export const ARCHETYPE_COEF: Record<Job, number> = {
  tank: 0.9,
  warrior: 1.1,
  mage: 1.05,
  support: 0.95,
}

const S = (skill: SkillDef) => skill

export const SKILLS: Record<string, SkillDef> = {
  /* ==================== 坦克：bulwark_* ==================== */
  bulwark_taunt: S({
    id: "bulwark_taunt",
    job: "tank",
    selfStatus: { id: "thorns", name: "荆棘", amount: 0.4, turns: 2 },
    name: "嘲讽咆哮",
    element: "physical",
    ap: 1,
    kind: "taunt",
    costTag: "normal",
    target: "self",
    turns: 1,
    desc: "本回合敌方单体攻击与 Down 判定强制指向自己，并挂上 2 回合【荆棘】反伤",
  }),
  bulwark_guard: S({
    id: "bulwark_guard",
    job: "tank",
    name: "铁壁架势",
    element: "earth",
    ap: 1,
    kind: "guard",
    costTag: "normal",
    target: "team",
    power: 1,
    desc: "提升全队侧面防御档位 +1（最高 IV 档 −90%）",
  }),
  bulwark_quake: S({
    id: "bulwark_quake",
    job: "tank",
    name: "震地重锤",
    element: "earth",
    ap: 2,
    kind: "damage",
    costTag: "normal",
    power: 1.35,
    hits: 1,
    target: "enemy",
    statusId: "weaken",
    statusChance: 0.8,
    turns: 2,
    desc: "1.35× 土属性伤害，附带 2 回合【衰弱】（ATK/INT −20%）",
  }),
  bulwark_thorns: S({
    id: "bulwark_thorns",
    job: "tank",
    openingStatus: { id: "thorns", name: "荆棘", amount: 0.35, turns: 2 },
    name: "荆棘重甲",
    element: "metal",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：开局自带 2 回合【荆棘】，受击时按自身 INT 反弹固定魔法伤害",
  }),

  /* ==================== 坦克：warden_* ==================== */
  warden_bash: S({
    id: "warden_bash",
    job: "tank",
    name: "盾击平推",
    element: "physical",
    ap: 0,
    kind: "damage",
    costTag: "normal",
    power: 0.6,
    hits: 1,
    target: "enemy",
    desc: "0 AP 盾击（0.6× 物理伤害），稳定垫高 Combo",
  }),
  warden_armor: S({
    id: "warden_armor",
    job: "tank",
    name: "重装甲展开",
    element: "metal",
    ap: 2,
    kind: "summon",
    costTag: "once",
    once: true,
    target: "team",
    supportDef: {
      kind: "armor",
      name: "重装甲 II",
      element: "metal",
      armorTier: 2,
      tier: 2,
      roleText: "常驻防御 II 档 (−40%)",
    },
    desc: "单次：在右侧支援栏部署强度 2 的【重装甲 II】，常驻提供 II 档防御减伤",
  }),
  warden_stun: S({
    id: "warden_stun",
    job: "tank",
    name: "粉碎击晕",
    element: "physical",
    ap: 3,
    kind: "control",
    costTag: "normal",
    target: "enemy",
    statusId: "stun",
    turns: 1,
    desc: "硬控（3 AP）：作废目标本回合全部行动（受击即打醒；可打断蓄力使其脆弱）。本回合有难以打断的招式时成功率 ×0.4",
  }),
  warden_hold: S({
    id: "warden_hold",
    job: "tank",
    defMul: 1.1,
    name: "不动如山",
    element: "earth",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：常驻 DEF +10%",
  }),

  /* ==================== 战士：berserker_* ==================== */
  berserker_zero: S({
    id: "berserker_zero",
    job: "warrior",
    name: "狂乱平砍",
    element: "physical",
    ap: 1,
    kind: "damage",
    costTag: "normal",
    power: 0.55,
    hits: 2,
    target: "enemy",
    desc: "2 段 × 0.55× 物理平刀，快速叠 2 层 Combo",
  }),
  berserker_cleave: S({
    id: "berserker_cleave",
    job: "warrior",
    name: "血祭乱舞",
    element: "fire",
    ap: 3,
    kind: "damage",
    costTag: "normal",
    power: 0.42,
    hits: 4,
    selfHpCostPct: 0.08,
    target: "enemy",
    statusId: "bleed",
    statusChance: 0.8,
    turns: 3,
    desc: "消耗队伍 8% 生命，打出 4 段 × 0.42× 火焰斩击并叠【流血】",
  }),
  berserker_wind: S({
    id: "berserker_wind",
    job: "warrior",
    name: "裂空断头台",
    element: "thunder",
    ap: 2,
    kind: "damage",
    costTag: "accumulate",
    power: 2.3,
    hits: 1,
    executeBonus: 0.4,
    executeWhen: ["lowHp"],
    target: "enemy",
    desc: "2.3× 雷属性重劈（目标血量低于 40% 时 +40%）· 远征累积 (+1 AP/次)",
  }),
  berserker_blood: S({
    id: "berserker_blood",
    job: "warrior",
    lowHpMul: 1.25,
    lifesteal: 0.08,
    name: "血怒狂躯",
    element: "dark",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：队伍生命低于 30% 时 ATK +25%，造成伤害时 8% 吸血回复队伍生命",
  }),

  /* ==================== 战士：paladin_* ==================== */
  paladin_smite: S({
    id: "paladin_smite",
    job: "warrior",
    name: "圣光裁决",
    element: "light",
    ap: 2,
    kind: "damage",
    costTag: "normal",
    power: 1.65,
    hits: 1,
    target: "enemy",
    desc: "1.65× 光属性神圣打击",
  }),
  paladin_protect: S({
    id: "paladin_protect",
    job: "warrior",
    name: "圣盾援护",
    element: "light",
    ap: 1,
    kind: "summon",
    costTag: "normal",
    target: "team",
    supportDef: {
      kind: "aura",
      name: "守护圣印",
      element: "light",
      stat: "def",
      amount: 0.2,
      tier: 2,
      roleText: "强度 2 支援 · 全队 DEF+20%",
    },
    desc: "在右侧支援栏展开强度 2 的【守护圣印】，普通拆除拆不动，保护我方支援栏",
  }),
  paladin_judgment: S({
    id: "paladin_judgment",
    job: "warrior",
    name: "神威重斩",
    element: "light",
    ap: 3,
    kind: "damage",
    costTag: "normal",
    power: 1.15,
    hits: 2,
    target: "enemy",
    desc: "2 段 × 1.15× 光属性重击",
  }),
  paladin_aura: S({
    id: "paladin_aura",
    job: "warrior",
    supportShield: 0.3,
    name: "守护光环",
    element: "light",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：敌方拆毁我方侧面支援时，每个目标有 30% 概率免于被拆",
  }),

  /* ==================== 战士：breaker_* ==================== */
  breaker_break: S({
    id: "breaker_break",
    job: "warrior",
    name: "破甲碎盾",
    element: "metal",
    ap: 1,
    kind: "debuff",
    costTag: "normal",
    power: 1.0,
    hits: 1,
    target: "enemy",
    statusId: "armor_break",
    statusChance: 0.8,
    clearEnemySupports: 1,
    breakTier: 1,
    turns: 3,
    desc: "1.0× 金属性伤害，施加【破防】（敌方防御档位 −1 或 DEF 削减）并拆毁 1 个强度 ≤1 的敌方支援",
  }),
  breaker_rift: S({
    id: "breaker_rift",
    job: "warrior",
    name: "裂法三连",
    element: "dark",
    ap: 2,
    kind: "damage",
    costTag: "normal",
    power: 0.48,
    hits: 3,
    target: "enemy",
    statusId: "silence",
    statusChance: 0.45,
    turns: 2,
    desc: "3 段 × 0.48× 暗属性连斩，附带【沉默】",
  }),
  breaker_counter: S({
    id: "breaker_counter",
    job: "warrior",
    name: "增援号令",
    element: "thunder",
    ap: 1,
    kind: "summon",
    costTag: "once",
    once: true,
    target: "self",
    supportDef: {
      kind: "attack",
      name: "破法剑卫",
      element: "thunder",
      power: 0.5,
      hits: 1,
      combo: 1,
      procRate: 0.65,
      roleText: "65% 概率回合初雷击 +1 Combo",
    },
    desc: "单次：呼叫【破法剑卫】进入右侧支援栏，每回合初自动雷击铺 Combo",
  }),
  breaker_swift: S({
    id: "breaker_swift",
    job: "warrior",
    swift: true,
    name: "迅捷破魔",
    element: "thunder",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：【迅捷】标签（命中 +5%，回合初可触发 0.7× 免费抢攻）",
  }),

  /* ==================== 战士：ranger_* ==================== */
  ranger_zero: S({
    id: "ranger_zero",
    job: "warrior",
    name: "牵制速射",
    element: "physical",
    ap: 0,
    kind: "damage",
    costTag: "normal",
    power: 0.6,
    hits: 1,
    target: "enemy",
    desc: "0 AP 速射（0.6× 物理伤害），零消耗垫高 Combo",
  }),
  ranger_volley: S({
    id: "ranger_volley",
    job: "warrior",
    name: "疾风连射",
    element: "physical",
    ap: 1,
    kind: "damage",
    costTag: "normal",
    power: 0.55,
    hits: 2,
    target: "enemy",
    desc: "1 AP 打出 2 段 × 0.55× 箭雨，平刀队核心连击引擎",
  }),
  ranger_pierce: S({
    id: "ranger_pierce",
    job: "warrior",
    name: "穿甲狙击",
    element: "ice",
    ap: 2,
    kind: "damage",
    costTag: "normal",
    power: 1.65,
    hits: 1,
    piercePct: 0.5,
    statusId: "armor_break",
    statusChance: 0.8,
    turns: 3,
    target: "enemy",
    desc: "1.65× 冰属性穿透箭，无视 50% 减伤并附加【破防】",
  }),
  ranger_harvest: S({
    id: "ranger_harvest",
    job: "warrior",
    name: "虚弱收割",
    element: "physical",
    ap: 3,
    kind: "damage",
    costTag: "accumulate",
    power: 2.4,
    hits: 1,
    executeBonus: 0.6,
    executeWhen: ["vulnerable"],
    target: "enemy",
    desc: "2.4× 终结箭（目标处于【脆弱】时伤害 +60%）· 远征累积",
  }),
  ranger_swift: S({
    id: "ranger_swift",
    job: "warrior",
    swift: true,
    critVsVulnerable: 15,
    name: "鹰眼迅捷",
    element: "thunder",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：【迅捷】标签（命中 +5%，可抢攻，对脆弱目标暴击率 +15%）",
  }),

  /* ==================== 战士：assassin_* ==================== */
  assassin_zero: S({
    id: "assassin_zero",
    job: "warrior",
    name: "瞬影刺",
    element: "physical",
    ap: 0,
    kind: "damage",
    costTag: "normal",
    power: 0.6,
    hits: 1,
    target: "enemy",
    desc: "0 AP 瞬步快刀（0.6× 物理伤害），无消耗起手叠 Combo",
  }),
  assassin_interrupt: S({
    id: "assassin_interrupt",
    job: "warrior",
    name: "盲抽打断",
    element: "dark",
    ap: 1,
    kind: "interrupt",
    costTag: "normal",
    power: 0.8,
    hits: 1,
    target: "enemy",
    desc: "每回合限 1 次：0.8× 暗属性伤害照常结算，并额外盲抽敌方本回合 1 个意图尝试打断（失败不影响伤害与 Combo）；打断蓄力使其进入【脆弱 (+30%易伤)】",
  }),
  assassin_backstab: S({
    id: "assassin_backstab",
    job: "warrior",
    name: "影袭三连",
    element: "dark",
    ap: 2,
    kind: "damage",
    costTag: "normal",
    power: 0.45,
    hits: 3,
    statusId: "poison",
    statusChance: 0.65,
    turns: 4,
    target: "enemy",
    desc: "3 段 × 0.45× 暗影连刺，附带 4 回合【中毒】",
  }),
  assassin_execute: S({
    id: "assassin_execute",
    job: "warrior",
    name: "暗杀奥义",
    element: "dark",
    ap: 3,
    kind: "damage",
    costTag: "once",
    once: true,
    power: 2.8,
    hits: 1,
    executeBonus: 0.5,
    executeWhen: ["vulnerable", "lowHp"],
    target: "enemy",
    desc: "单次：2.8× 暗属性必杀一击（目标脆弱或血量低于 40% 时额外 +50%）",
  }),
  assassin_swift: S({
    id: "assassin_swift",
    job: "warrior",
    swift: true,
    name: "暗影迅捷",
    element: "thunder",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：【迅捷】标签（命中 +5%，回合初高概率触发免费抢攻）",
  }),

  /* ==================== 法师：warlock_* ==================== */
  warlock_frost: S({
    id: "warlock_frost",
    job: "mage",
    name: "极寒霜缚",
    element: "ice",
    ap: 1,
    kind: "damage",
    costTag: "normal",
    power: 1.35,
    hits: 1,
    statusId: "freeze",
    statusChance: 0.65,
    turns: 2,
    target: "enemy",
    desc: "1.35× 冰属性法术，附加【冻结】（冰伤+20%、25%行动失败）",
  }),
  warlock_starfire: S({
    id: "warlock_starfire",
    job: "mage",
    name: "雷火崩星",
    element: "thunder",
    ap: 2,
    kind: "damage",
    costTag: "normal",
    power: 0.95,
    hits: 2,
    statusId: "shock",
    statusChance: 0.65,
    turns: 3,
    target: "enemy",
    desc: "2 段 × 0.95× 雷属性法术，附加【触电】（受雷伤 +30%）",
  }),
  warlock_meteor: S({
    id: "warlock_meteor",
    job: "mage",
    name: "虹彩齐射",
    element: "fire",
    ap: 4,
    kind: "damage",
    costTag: "accumulate",
    power: 3.4,
    hits: 1,
    statusId: "burn",
    statusChance: 0.65,
    turns: 3,
    target: "enemy",
    desc: "3.4× 火属性究极奥义，附加【燃烧】，最适合在满 Combo 收尾 · 远征累积",
  }),
  warlock_lowhp: S({
    id: "warlock_lowhp",
    job: "mage",
    lowHpMul: 1.25,
    spellCrit: 10,
    name: "魔力暴走",
    element: "fire",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：队伍生命低于 30% 时 INT +25%，法术暴击率 +10%",
  }),

  /* ==================== 法师：life_* ==================== */
  life_renew: S({
    id: "life_renew",
    job: "mage",
    name: "生机涌动",
    element: "wood",
    ap: 1,
    kind: "heal",
    costTag: "normal",
    power: 0.15,
    target: "team",
    desc: "为队伍总血条回复 0.15× INT 生命值",
  }),
  life_mass: S({
    id: "life_mass",
    job: "mage",
    name: "藤蔓毒蚀",
    element: "wood",
    ap: 1,
    kind: "damage",
    costTag: "normal",
    power: 1.1,
    hits: 1,
    statusId: "poison",
    statusChance: 0.65,
    turns: 4,
    target: "enemy",
    desc: "1.1× 木属性伤害，附加 4 回合【中毒】（每回合扣当前生命 3%）",
  }),
  life_revive: S({
    id: "life_revive",
    job: "mage",
    revive: "all",
    name: "复苏结界",
    element: "light",
    ap: 2,
    kind: "heal",
    costTag: "normal",
    power: 0.36,
    target: "team",
    desc: "回复 0.36× INT 队伍生命并立即唤醒所有被 Down 的队友",
  }),
  life_regen: S({
    id: "life_regen",
    job: "mage",
    regenPct: 0.015,
    name: "生生不息",
    element: "wood",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：每回合开始自动为队伍回复 1.5% 最大生命",
  }),

  /* ==================== 法师：binder_* ==================== */
  binder_sleep: S({
    id: "binder_sleep",
    job: "mage",
    name: "深渊眠咒",
    element: "dark",
    ap: 3,
    kind: "control",
    costTag: "normal",
    statusId: "sleep",
    turns: 1,
    target: "enemy",
    desc: "硬控（3 AP）：催眠目标作废其本回合全部行动（受击即打醒；可打断蓄力）。本回合有难以打断的招式时成功率 ×0.4",
  }),
  binder_charm: S({
    id: "binder_charm",
    job: "mage",
    name: "幻惑之瞳",
    element: "dark",
    ap: 2,
    kind: "debuff",
    costTag: "normal",
    statusId: "charm",
    statusChance: 0.45,
    turns: 2,
    target: "enemy",
    desc: "软控（2 AP）：施加 2 回合【魅惑】（50% 概率打错目标自残，受击不打醒）",
  }),
  binder_bind: S({
    id: "binder_bind",
    job: "mage",
    name: "诅咒荆棘",
    element: "wood",
    ap: 1,
    kind: "debuff",
    costTag: "normal",
    power: 0.9,
    hits: 1,
    statusId: "curse",
    statusChance: 0.65,
    turns: 3,
    target: "enemy",
    desc: "0.9× 木属性伤害并施加 3 回合【诅咒】（倒计时结束扣目标当前生命 15%）",
  }),
  binder_focus: S({
    id: "binder_focus",
    job: "mage",
    controlBonus: 0.15,
    name: "精神专注",
    element: "light",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：硬控与软控判定成功率 +15%",
  }),

  /* ==================== 法师：summoner_* ==================== */
  summoner_call: S({
    id: "summoner_call",
    job: "mage",
    name: "使徒召唤",
    element: "dark",
    ap: 1,
    kind: "summon",
    costTag: "normal",
    target: "self",
    supportDef: {
      kind: "attack",
      name: "暗影使魔",
      element: "dark",
      power: 0.5,
      hits: 1,
      combo: 1,
      procRate: 0.6,
      roleText: "60% 概率回合初攻击 +1 Combo",
    },
    desc: "在右侧支援栏召唤【暗影使魔】（上限 7 格），每回合初先于主队发动 50% 攻击并 +1 Combo",
  }),
  summoner_poison: S({
    id: "summoner_poison",
    job: "mage",
    name: "召唤小队",
    element: "earth",
    ap: 2,
    kind: "summon",
    costTag: "normal",
    target: "self",
    supportDef: {
      kind: "attack",
      name: "哈尼突击队",
      element: "earth",
      power: 0.5,
      hits: 2,
      combo: 1,
      procRate: 0.65,
      roleText: "65% 概率回合初 2 连击 +2 Combo",
    },
    desc: "在右侧支援栏部署【哈尼突击队】，回合初发动 2 段支援连击快速垫高 Combo",
  }),
  summoner_ward: S({
    id: "summoner_ward",
    job: "mage",
    name: "荆棘结界",
    element: "wood",
    ap: 1,
    kind: "summon",
    costTag: "once",
    once: true,
    target: "team",
    supportDef: {
      kind: "thorns",
      name: "荆棘藤阵",
      element: "wood",
      power: 0.35,
      roleText: "常驻反伤 · 受击反弹固定魔伤",
    },
    desc: "单次：在右侧支援栏布下【荆棘藤阵】，我方每受一段攻击自动反弹固定魔法伤害",
  }),
  summoner_aura: S({
    id: "summoner_aura",
    job: "mage",
    supportProcBonus: 0.15,
    name: "召唤共鸣",
    element: "dark",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：我方所有攻击型侧面支援发动率 +15%",
  }),

  /* ==================== 辅助：dancer_* ==================== */
  dancer_step: S({
    id: "dancer_step",
    job: "support",
    unlockTurn: 4,
    name: "无偿之舞",
    element: "light",
    ap: 0,
    kind: "ap",
    costTag: "normal",
    amount: 1,
    target: "team",
    desc: "【无偿】：0 AP 换 +1 AP（前 3 回合锁定，第 4 回合起可用；连用触发疲惫变 1 换 1）",
  }),
  dancer_frenzy: S({
    id: "dancer_frenzy",
    job: "support",
    name: "狂热之舞",
    element: "fire",
    ap: 2,
    kind: "ap",
    costTag: "once",
    once: true,
    amount: 3,
    target: "team",
    desc: "主动爆发（单次）：花 2 AP 使全队本回合 AP 立即 +3（净赚 1 AP 并激活高费大招）",
  }),
  dancer_veil: S({
    id: "dancer_veil",
    job: "support",
    name: "扇舞连击",
    element: "light",
    ap: 1,
    kind: "damage",
    costTag: "normal",
    power: 0.5,
    hits: 2,
    target: "enemy",
    desc: "1 AP 扇舞 2 连击，为队友铺垫 +2 Combo",
  }),
  dancer_grace: S({
    id: "dancer_grace",
    job: "support",
    apRegenBonus: 1,
    name: "舞者增幅",
    element: "light",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动形态：该卡存活在场时，我方每回合基础 AP 恢复由 +2 提升至 +3",
  }),

  /* ==================== 辅助：healer_* ==================== */
  healer_heal: S({
    id: "healer_heal",
    job: "support",
    name: "圣光治愈",
    element: "light",
    ap: 1,
    kind: "heal",
    costTag: "normal",
    power: 0.2,
    target: "team",
    desc: "1 AP 为队伍总血条回复 0.2× INT 生命值",
  }),
  healer_cleanse: S({
    id: "healer_cleanse",
    job: "support",
    cleanse: true,
    name: "净化之泉",
    element: "light",
    ap: 1,
    kind: "heal",
    costTag: "normal",
    power: 0.1,
    target: "team",
    desc: "回复 0.1× INT 队伍生命，并净化全队与卡片身上的负面异常状态",
  }),
  healer_revive: S({
    id: "healer_revive",
    job: "support",
    revive: "all",
    name: "奇迹抬人",
    element: "light",
    ap: 2,
    kind: "heal",
    costTag: "normal",
    power: 0.35,
    target: "team",
    desc: "救醒场上所有被 Down 的卡片，并回复 0.35× INT 队伍生命",
  }),
  healer_plus: S({
    id: "healer_plus",
    job: "support",
    healBonus: 0.2,
    name: "医者仁心",
    element: "wood",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：全队治疗量 +20%",
  }),

  /* ==================== 辅助：bard_* ==================== */
  bard_inspire: S({
    id: "bard_inspire",
    job: "support",
    name: "全军阵法",
    element: "light",
    ap: 1,
    kind: "summon",
    costTag: "once",
    once: true,
    target: "team",
    supportDef: {
      kind: "aura",
      name: "军师战歌",
      element: "light",
      stat: "atk",
      amount: 0.2,
      roleText: "常驻支援 · 全队 ATK/INT+20%",
    },
    desc: "单次：在右侧支援栏部署【军师战歌】，常驻提升全队 20% 攻击与魔力",
  }),
  bard_ward: S({
    id: "bard_ward",
    job: "support",
    boostAllies: 2,
    name: "激昂乐章",
    element: "thunder",
    ap: 1,
    kind: "buff",
    costTag: "normal",
    stat: "atk",
    amount: 0.2,
    turns: 2,
    target: "team",
    desc: "全队 ATK/INT +20%（2 回合），并立即为 1~2 张未行动队友赋予【BOOST 1.5×】！",
  }),
  bard_anthem: S({
    id: "bard_anthem",
    job: "support",
    name: "破魔回响",
    element: "metal",
    ap: 1,
    kind: "damage",
    costTag: "normal",
    power: 0.9,
    hits: 1,
    clearEnemySupports: 2,
    breakTier: 1,
    target: "enemy",
    desc: "0.9× 音波伤害，一次性驱散/拆毁敌方左侧最多 2 个强度 ≤1 的支援",
  }),
  bard_aura: S({
    id: "bard_aura",
    job: "support",
    triggerBonus: 0.1,
    name: "余音绕梁",
    element: "light",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：全队每回合开始触发 Boost / 必杀 / 连击的概率提升 +10%",
  }),
}

export function hashOf(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return h
}

/** 两个槽的卡里，主动 / 被动配比的权重（百分数，合计 100）；2/0 占多数，被动偏少 */
export const TWO_SLOT_PLANS: Record<"common" | "legendary", { actives: number; weight: number }[]> = {
  // C / UC / R / E：2/0 占 60%，1/1 占 30%，0/2 占 10%
  common: [
    { actives: 2, weight: 60 },
    { actives: 1, weight: 30 },
    { actives: 0, weight: 10 },
  ],
  // L：2/0 占 55%，1/1 占 35%，0/2 占 10%
  legendary: [
    { actives: 2, weight: 55 },
    { actives: 1, weight: 35 },
    { actives: 0, weight: 10 },
  ],
}

/** 种子字符串 → 随机流；只给预览、本地原型卡用，真正发牌用服务端的 Math.random */
export function seededRandom(seed: string): () => number {
  let state = hashSeed(seed)
  return () => {
    const [next, value] = nextRandom(state)
    state = next
    return value
  }
}

/** 两个槽的卡按配比抽 2/0、1/1、0/2 */
export function rollActiveCount(rarity: Rarity, random: () => number): number {
  const plans = rarity === "L" ? TWO_SLOT_PLANS.legendary : TWO_SLOT_PLANS.common
  let roll = random() * 100
  for (const plan of plans) {
    if (roll < plan.weight) return plan.actives
    roll -= plan.weight
  }
  return plans[plans.length - 1]!.actives
}

/**
 * 给一张新卡发技能：每张卡各掷各的，同名卡的技能互不相同，发出去就固定。
 * 先按配比定槽型，再在本大职业的池子里一个一个抽，抽到什么是什么（同一张卡内不重复）：
 * - C / UC / R / E：2/0 占 60%，1/1 占 30%，0/2 占 10%
 * - L：2/0 占 55%，1/1 占 35%，0/2 占 10%
 * - Mythic / Prismatic / 本体卡：3 个槽（暂定 2 主动 + 1 被动，其余配比等技能池扩充时放开）
 * 绝不额外硬塞第 4、第 5 个技能。
 */
export function rollSkillRefs(job: Job, rarity: Rarity, random: () => number, wantThree = false): CardSkillRef[] {
  const pool = Object.values(SKILLS).filter((skill) => skill.job === job)
  const actives = pool.filter((skill) => !skill.passive)
  const passives = pool.filter((skill) => skill.passive)
  const threeSlots = wantThree || rarity === "Mythic" || rarity === "Prismatic"
  const slotCount = threeSlots ? 3 : 2
  const activeCount = Math.min(actives.length, threeSlots ? 2 : rollActiveCount(rarity, random))
  const passiveCount = Math.min(passives.length, slotCount - activeCount)
  const drawFrom = (source: SkillDef[], count: number): SkillDef[] => {
    const left = [...source]
    const picked: SkillDef[] = []
    for (let i = 0; i < count; i += 1) {
      picked.push(left.splice(Math.floor(random() * left.length), 1)[0]!)
    }
    return picked
  }
  return [...drawFrom(actives, activeCount), ...drawFrom(passives, passiveCount)].map((def) => ({ skillId: def.id }))
}
export function skillById(id: string): SkillDef | undefined {
  return SKILLS[id]
}

/** 认不出的技能 id 直接报错，不做任何兜底 */
export function requireSkill(id: string): SkillDef {
  const def = SKILLS[id]
  if (!def) throw new Error(`未知技能 id：${id}`)
  return def
}

/** 技能定义 → 卡面上显示的技能（带 id，费用和属性一律取注册表） */
export function cardSkillOf(def: SkillDef): CardSkill {
  return {
    id: def.id,
    name: def.name,
    element: def.element,
    ap: def.passive ? 0 : def.ap,
    passive: def.passive || undefined,
  }
}

/** 把技能引用还原成卡面技能；有认不出的 id 就报错 */
export function cardSkillsFromRefs(refs: CardSkillRef[]): CardSkill[] {
  return refs.map((ref) => cardSkillOf(requireSkill(ref.skillId)))
}

/** 卡面技能 → 战斗内可执行的技能定义（只认 id） */
export function skillDefFromCardSkill(skill: CardSkill): SkillDef {
  return requireSkill(skill.id)
}

export const JOB_ORDER: Job[] = ["tank", "warrior", "mage", "support"]

/** 预览 / 本地原型卡用：按种子固定地发一份技能；玩家的卡由服务端发牌时存在卡实例上 */
export function skillsFor(job: Job, rarity: Rarity, wantThree: boolean, seed: string): CardSkill[] {
  return cardSkillsFromRefs(rollSkillRefs(job, rarity, seededRandom(`${seed}|skills`), wantThree))
}