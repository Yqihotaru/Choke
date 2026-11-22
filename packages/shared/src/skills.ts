import type { CardSkill, CardSkillRef, Element, Job, Rarity } from "./types"

export type SubJobId =
  | "bulwark"
  | "warden"
  | "berserker"
  | "paladin"
  | "spellbreaker"
  | "ranger"
  | "assassin"
  | "warlock"
  | "lifebringer"
  | "binder"
  | "summoner"
  | "dancer"
  | "healer"
  | "bard"

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
 * 技能费用标签（卡牌数值与战斗机制 v0.1 §6.5）：
 * - normal: 常态固定费用
 * - fatigue: 疲惫（上一回合刚用过则本回合 +1 AP，不叠层）
 * - accumulate: 远征累积（每用 1 次，本场/远征永久 +1 AP）
 * - once: 单次（整场战斗限用 1 次）
 */
export type SkillCostTag = "normal" | "fatigue" | "accumulate" | "once"

export interface SupportSpawnDef {
  kind: "attack" | "armor" | "aura" | "thorns"
  name: string
  element: Element
  power?: number
  hits?: number
  procRate?: number
  armorTier?: number
  stat?: "atk" | "int" | "def"
  amount?: number
  locked?: boolean
  roleText: string
}

export interface SkillDef {
  id: string
  name: string
  element: Element
  ap: number
  mp?: number
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
  /** 卖血换输出：消耗队伍当前/最大 HP 比例 */
  selfHpCostPct?: number
  /** 穿甲：无视目标部分 DEF/减伤比例 */
  piercePct?: number
  /** 虚弱/斩杀收割：目标处于脆弱或低血量时额外倍率 */
  executeBonus?: number
  /** 清除敌方侧面支援数量 */
  clearEnemySupports?: number
  /** 召唤/布置侧面支援定义 */
  supportDef?: SupportSpawnDef
  desc: string
}

export interface SubJob {
  id: SubJobId
  label: string
  archetype: Job
  hp: number
  atk: number
  def: number
  int: number
  tags: string[]
  skills: string[]
}

export const ARCHETYPE_COEF: Record<Job, number> = {
  tank: 0.9,
  warrior: 1.1,
  mage: 1.05,
  support: 0.95,
}

/** 保留导出以兼容旧引用；v0.1 已将单卡韧性合并入队伍总血条模型 */
export const POISE_COEF: Record<Job, number> = {
  tank: 1.4,
  warrior: 1.2,
  mage: 0.8,
  support: 0.9,
}

/** MP 上限与每回合回复（§2.6 法系专属资源） */
export const MP_MAX_BY_RARITY: Record<Rarity, number> = {
  C: 10,
  UC: 12,
  R: 15,
  E: 18,
  L: 22,
  Radiant: 26,
  Prismatic: 30,
}

export const MP_REGEN_BY_RARITY: Record<Rarity, number> = {
  C: 2,
  UC: 2,
  R: 3,
  E: 3,
  L: 4,
  Radiant: 4,
  Prismatic: 5,
}

const S = (skill: SkillDef) => skill

export const SKILLS: Record<string, SkillDef> = {
  /* ==================== 坦克：肉坦 (bulwark) ==================== */
  bulwark_taunt: S({
    id: "bulwark_taunt",
    name: "嘲讽咆哮",
    element: "physical",
    ap: 1,
    kind: "taunt",
    costTag: "normal",
    target: "self",
    turns: 1,
    desc: "本回合敌方单体攻击与 Down 判定强制指向自己，并挂上 2 回合【荆棘】反伤",
    statusId: "thorns",
  }),
  bulwark_guard: S({
    id: "bulwark_guard",
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
    name: "震地重锤",
    element: "earth",
    ap: 2,
    kind: "damage",
    costTag: "fatigue",
    power: 1.35,
    hits: 1,
    target: "enemy",
    statusId: "weaken",
    turns: 2,
    desc: "1.35× 土属性伤害，附带 2 回合【衰弱】（ATK/INT −20%）· 疲惫",
  }),
  bulwark_thorns: S({
    id: "bulwark_thorns",
    name: "荆棘重甲",
    element: "metal",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：开局自带 2 回合【荆棘】，受击时按自身 INT 反弹固定魔法伤害",
  }),

  /* ==================== 坦克：战坦 (warden) ==================== */
  warden_bash: S({
    id: "warden_bash",
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
      locked: true,
      roleText: "常驻防御 II 档 (−40%)",
    },
    desc: "单次：在右侧支援栏部署锁定【重装甲 II】，常驻提供 II 档防御减伤",
  }),
  warden_stun: S({
    id: "warden_stun",
    name: "粉碎击晕",
    element: "physical",
    ap: 3,
    kind: "control",
    costTag: "fatigue",
    target: "enemy",
    statusId: "stun",
    turns: 1,
    desc: "硬控（3 AP）：作废目标本回合全部行动（受击即打醒；可打断蓄力使其脆弱）",
  }),
  warden_hold: S({
    id: "warden_hold",
    name: "不动如山",
    element: "earth",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：常驻 DEF +10%，可在场解锁全队 IV 档（90%）极限防御",
  }),

  /* ==================== 战士：狂战士 (berserker) ==================== */
  berserker_zero: S({
    id: "berserker_zero",
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
    name: "血祭乱舞",
    element: "fire",
    ap: 3,
    kind: "damage",
    costTag: "fatigue",
    power: 0.42,
    hits: 4,
    selfHpCostPct: 0.08,
    target: "enemy",
    statusId: "bleed",
    turns: 3,
    desc: "消耗队伍 8% 生命，打出 4 段 × 0.42× 火焰斩击并叠【流血】· 疲惫",
  }),
  berserker_wind: S({
    id: "berserker_wind",
    name: "裂空断头台",
    element: "thunder",
    ap: 2,
    kind: "damage",
    costTag: "accumulate",
    power: 2.3,
    hits: 1,
    executeBonus: 0.4,
    target: "enemy",
    desc: "2.3× 雷属性重劈（目标残血或脆弱时 +40%）· 远征累积 (+1 AP/次)",
  }),
  berserker_blood: S({
    id: "berserker_blood",
    name: "血怒狂躯",
    element: "dark",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：队伍生命低于 30% 时 ATK +25%，造成伤害时 20% 吸血回复队伍生命",
  }),

  /* ==================== 战士：圣骑士 (paladin) ==================== */
  paladin_smite: S({
    id: "paladin_smite",
    name: "圣光裁决",
    element: "light",
    ap: 2,
    mp: 3,
    kind: "damage",
    costTag: "normal",
    power: 1.65,
    hits: 1,
    target: "enemy",
    desc: "1.65× 光属性神圣打击（消耗 3 MP）",
  }),
  paladin_protect: S({
    id: "paladin_protect",
    name: "圣盾援护",
    element: "light",
    ap: 1,
    mp: 2,
    kind: "summon",
    costTag: "normal",
    target: "team",
    supportDef: {
      kind: "aura",
      name: "守护圣印",
      element: "light",
      stat: "def",
      amount: 0.2,
      locked: true,
      roleText: "锁定支援 · 全队 DEF+20%",
    },
    desc: "在右侧支援栏展开锁定【守护圣印】，保护我方支援栏免遭敌方拆毁",
  }),
  paladin_judgment: S({
    id: "paladin_judgment",
    name: "毗沙门天剑",
    element: "light",
    ap: 3,
    mp: 5,
    kind: "damage",
    costTag: "fatigue",
    power: 1.15,
    hits: 2,
    target: "enemy",
    desc: "2 段 × 1.15× 光属性重击（消耗 5 MP）· 疲惫",
  }),
  paladin_aura: S({
    id: "paladin_aura",
    name: "守护光环",
    element: "light",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：高魔抗半坦，视同坦克解锁 IV 档防御并保护侧面支援",
  }),

  /* ==================== 战士：破法者 (spellbreaker) ==================== */
  breaker_break: S({
    id: "breaker_break",
    name: "破甲碎盾",
    element: "metal",
    ap: 1,
    kind: "debuff",
    costTag: "normal",
    power: 1.0,
    hits: 1,
    target: "enemy",
    statusId: "armor_break",
    clearEnemySupports: 1,
    turns: 3,
    desc: "1.0× 金属性伤害，施加【破防】（敌方防御档位 −1 或 DEF 削减）并拆毁 1 个敌方支援",
  }),
  breaker_rift: S({
    id: "breaker_rift",
    name: "裂法三连",
    element: "dark",
    ap: 2,
    kind: "damage",
    costTag: "fatigue",
    power: 0.48,
    hits: 3,
    target: "enemy",
    statusId: "silence",
    turns: 2,
    desc: "3 段 × 0.48× 暗属性连斩，附带【沉默】· 疲惫",
  }),
  breaker_counter: S({
    id: "breaker_counter",
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
      procRate: 0.65,
      roleText: "65% 概率回合初雷击 +1 Combo",
    },
    desc: "单次：呼叫【破法剑卫】进入右侧支援栏，每回合初自动雷击铺 Combo",
  }),
  breaker_swift: S({
    id: "breaker_swift",
    name: "迅捷破魔",
    element: "thunder",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：【迅捷】标签（命中 +5%，回合初可触发 0.7× 免费抢攻）",
  }),

  /* ==================== 战士：游侠 (ranger) ==================== */
  ranger_zero: S({
    id: "ranger_zero",
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
    name: "穿甲狙击",
    element: "ice",
    ap: 2,
    kind: "damage",
    costTag: "fatigue",
    power: 1.65,
    hits: 1,
    piercePct: 0.5,
    statusId: "armor_break",
    turns: 3,
    target: "enemy",
    desc: "1.65× 冰属性穿透箭，无视 50% 减伤并附加【破防】· 疲惫",
  }),
  ranger_harvest: S({
    id: "ranger_harvest",
    name: "虚弱收割",
    element: "physical",
    ap: 3,
    kind: "damage",
    costTag: "accumulate",
    power: 2.4,
    hits: 1,
    executeBonus: 0.6,
    target: "enemy",
    desc: "2.4× 终结箭（目标处于【脆弱】或带异常时伤害 +60%）· 远征累积",
  }),
  ranger_swift: S({
    id: "ranger_swift",
    name: "鹰眼迅捷",
    element: "thunder",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：【迅捷】标签（命中 +5%，可抢攻，对脆弱目标暴击率 +15%）",
  }),

  /* ==================== 战士：刺客 (assassin) ==================== */
  assassin_zero: S({
    id: "assassin_zero",
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
    name: "盲抽打断",
    element: "dark",
    ap: 1,
    kind: "interrupt",
    costTag: "normal",
    power: 0.8,
    hits: 1,
    target: "enemy",
    desc: "刺客专属（每回合限 1 次）：从敌方本回合预告意图中随机抽 1 个打断；打断蓄力使其进入【脆弱 (+30%易伤)】",
  }),
  assassin_backstab: S({
    id: "assassin_backstab",
    name: "影袭三连",
    element: "dark",
    ap: 2,
    kind: "damage",
    costTag: "fatigue",
    power: 0.45,
    hits: 3,
    statusId: "poison",
    turns: 4,
    target: "enemy",
    desc: "3 段 × 0.45× 暗影连刺，附带 4 回合【中毒】· 疲惫",
  }),
  assassin_execute: S({
    id: "assassin_execute",
    name: "暗杀奥义",
    element: "dark",
    ap: 3,
    kind: "damage",
    costTag: "once",
    once: true,
    power: 2.8,
    hits: 1,
    executeBonus: 0.5,
    target: "enemy",
    desc: "单次：2.8× 暗属性必杀一击（目标脆弱或残血时额外 +50%）",
  }),
  assassin_swift: S({
    id: "assassin_swift",
    name: "暗影迅捷",
    element: "thunder",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：【迅捷】标签（命中 +5%，回合初高概率触发免费抢攻）",
  }),

  /* ==================== 法师：咒术师 (warlock) ==================== */
  warlock_frost: S({
    id: "warlock_frost",
    name: "极寒霜缚",
    element: "ice",
    ap: 1,
    mp: 3,
    kind: "damage",
    costTag: "normal",
    power: 1.35,
    hits: 1,
    statusId: "freeze",
    turns: 2,
    target: "enemy",
    desc: "1.35× 冰属性法术（3 MP），附加【冻结】（冰伤+20%、25%行动失败）",
  }),
  warlock_starfire: S({
    id: "warlock_starfire",
    name: "雷火崩星",
    element: "thunder",
    ap: 2,
    mp: 4,
    kind: "damage",
    costTag: "fatigue",
    power: 0.95,
    hits: 2,
    statusId: "shock",
    turns: 3,
    target: "enemy",
    desc: "2 段 × 0.95× 雷属性法术（4 MP），附加【触电】（受雷伤 +30%）· 疲惫",
  }),
  warlock_meteor: S({
    id: "warlock_meteor",
    name: "六色破坏光线",
    element: "fire",
    ap: 4,
    mp: 8,
    kind: "damage",
    costTag: "accumulate",
    power: 3.4,
    hits: 1,
    statusId: "burn",
    turns: 3,
    target: "enemy",
    desc: "3.4× 火属性究极奥义（8 MP），附加【燃烧】，最适合在满 Combo 收尾 · 远征累积",
  }),
  warlock_lowhp: S({
    id: "warlock_lowhp",
    name: "魔力暴走",
    element: "fire",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：队伍生命低于 30% 时 INT +25%，法术暴击率 +10%",
  }),

  /* ==================== 法师：生术师 (lifebringer) ==================== */
  life_renew: S({
    id: "life_renew",
    name: "生机涌动",
    element: "wood",
    ap: 1,
    mp: 2,
    kind: "heal",
    costTag: "normal",
    power: 1.0,
    target: "team",
    desc: "消耗 2 MP，为队伍总血条回复 1.0× INT 生命值",
  }),
  life_mass: S({
    id: "life_mass",
    name: "藤蔓毒蚀",
    element: "wood",
    ap: 1,
    mp: 3,
    kind: "damage",
    costTag: "normal",
    power: 1.1,
    hits: 1,
    statusId: "poison",
    turns: 4,
    target: "enemy",
    desc: "1.1× 木属性伤害（3 MP），附加 4 回合【中毒】（每回合扣当前生命 3%）",
  }),
  life_revive: S({
    id: "life_revive",
    name: "复苏结界",
    element: "light",
    ap: 2,
    mp: 5,
    kind: "heal",
    costTag: "fatigue",
    power: 1.6,
    target: "team",
    desc: "消耗 5 MP，大幅回复队伍生命并立即唤醒 1 张被 Down 的队友 · 疲惫",
  }),
  life_regen: S({
    id: "life_regen",
    name: "生生不息",
    element: "wood",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：每回合开始自动为队伍回复 4% 最大生命",
  }),

  /* ==================== 法师：缚术师 (binder) ==================== */
  binder_sleep: S({
    id: "binder_sleep",
    name: "深渊眠咒",
    element: "dark",
    ap: 3,
    mp: 5,
    kind: "control",
    costTag: "fatigue",
    statusId: "sleep",
    turns: 1,
    target: "enemy",
    desc: "硬控（3 AP + 5 MP）：催眠目标作废其本回合全部行动（受击即打醒；可打断蓄力）",
  }),
  binder_charm: S({
    id: "binder_charm",
    name: "幻惑之瞳",
    element: "dark",
    ap: 2,
    mp: 3,
    kind: "debuff",
    costTag: "normal",
    statusId: "charm",
    turns: 2,
    target: "enemy",
    desc: "软控（2 AP + 3 MP）：施加 2 回合【魅惑】（50% 概率打错目标自残，受击不打醒）",
  }),
  binder_bind: S({
    id: "binder_bind",
    name: "诅咒荆棘",
    element: "wood",
    ap: 1,
    mp: 2,
    kind: "debuff",
    costTag: "normal",
    power: 0.9,
    hits: 1,
    statusId: "curse",
    turns: 3,
    target: "enemy",
    desc: "0.9× 木属性伤害并施加 3 回合【诅咒】（倒计时结束扣目标当前生命 15%）",
  }),
  binder_focus: S({
    id: "binder_focus",
    name: "精神专注",
    element: "light",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：硬控与软控判定成功率 +15%",
  }),

  /* ==================== 法师：召唤师 (summoner) ==================== */
  summoner_call: S({
    id: "summoner_call",
    name: "使徒召唤",
    element: "dark",
    ap: 1,
    mp: 3,
    kind: "summon",
    costTag: "normal",
    target: "self",
    supportDef: {
      kind: "attack",
      name: "暗影使魔",
      element: "dark",
      power: 0.5,
      hits: 1,
      procRate: 0.6,
      roleText: "60% 概率回合初攻击 +1 Combo",
    },
    desc: "在右侧支援栏召唤【暗影使魔】（上限 7 格），每回合初先于主队发动 50% 攻击并 +1 Combo",
  }),
  summoner_poison: S({
    id: "summoner_poison",
    name: "哈尼军团",
    element: "earth",
    ap: 2,
    mp: 4,
    kind: "summon",
    costTag: "fatigue",
    target: "self",
    supportDef: {
      kind: "attack",
      name: "哈尼突击队",
      element: "earth",
      power: 0.5,
      hits: 2,
      procRate: 0.65,
      roleText: "65% 概率回合初 2 连击 +2 Combo",
    },
    desc: "在右侧支援栏部署【哈尼突击队】，回合初发动 2 段支援连击快速垫高 Combo · 疲惫",
  }),
  summoner_ward: S({
    id: "summoner_ward",
    name: "荆棘结界",
    element: "wood",
    ap: 1,
    mp: 2,
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
    name: "召唤共鸣",
    element: "dark",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：我方所有攻击型侧面支援发动率 +15%，伤害提升",
  }),

  /* ==================== 辅助：舞者 (dancer) ==================== */
  dancer_step: S({
    id: "dancer_step",
    name: "无偿之舞",
    element: "light",
    ap: 0,
    kind: "ap",
    costTag: "fatigue",
    amount: 1,
    target: "team",
    desc: "【无偿】：0 AP 换 +1 AP（前 3 回合锁定，第 4 回合起可用；连用触发疲惫变 1 换 1）",
  }),
  dancer_frenzy: S({
    id: "dancer_frenzy",
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
    name: "舞者增幅",
    element: "light",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动形态：该卡存活在场时，我方每回合基础 AP 恢复由 +2 提升至 +3",
  }),

  /* ==================== 辅助：治疗师 (healer) ==================== */
  healer_heal: S({
    id: "healer_heal",
    name: "圣光治愈",
    element: "light",
    ap: 1,
    kind: "heal",
    costTag: "normal",
    power: 1.25,
    target: "team",
    desc: "1 AP 为队伍总血条回复 1.25× INT 生命值",
  }),
  healer_cleanse: S({
    id: "healer_cleanse",
    name: "净化之泉",
    element: "light",
    ap: 1,
    kind: "heal",
    costTag: "normal",
    power: 0.7,
    target: "team",
    desc: "回复队伍生命，并净化全队与卡片身上的负面异常状态，同时为法系队友补 3 MP",
  }),
  healer_revive: S({
    id: "healer_revive",
    name: "奇迹抬人",
    element: "light",
    ap: 2,
    kind: "heal",
    costTag: "fatigue",
    power: 1.5,
    target: "team",
    desc: "救醒场上所有被 Down 的卡片，并回复 1.5× INT 队伍生命 · 疲惫",
  }),
  healer_plus: S({
    id: "healer_plus",
    name: "医者仁心",
    element: "wood",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：全队治疗量 +20%",
  }),

  /* ==================== 辅助：吟游诗人 (bard) ==================== */
  bard_inspire: S({
    id: "bard_inspire",
    name: "全军军师阵",
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
    name: "专拐激昂曲",
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
    name: "破魔回响",
    element: "metal",
    ap: 1,
    kind: "damage",
    costTag: "normal",
    power: 0.9,
    hits: 1,
    clearEnemySupports: 2,
    target: "enemy",
    desc: "0.9× 音波伤害，一次性驱散/拆毁敌方左侧最多 2 个非锁定支援",
  }),
  bard_aura: S({
    id: "bard_aura",
    name: "余音绕梁",
    element: "light",
    ap: 0,
    kind: "passive",
    passive: true,
    desc: "被动：全队每回合开始触发 Boost / 必杀 / 连击的概率提升 +10%",
  }),
}

export const SUBJOBS: Record<SubJobId, SubJob> = {
  bulwark: {
    id: "bulwark",
    label: "肉坦",
    archetype: "tank",
    hp: 1.5,
    atk: 0.55,
    def: 1.4,
    int: 0.55,
    tags: ["tank", "taunt", "thorns"],
    skills: ["bulwark_taunt", "bulwark_guard", "bulwark_quake", "bulwark_thorns"],
  },
  warden: {
    id: "warden",
    label: "战坦",
    archetype: "tank",
    hp: 1.2,
    atk: 0.95,
    def: 1.25,
    int: 0.6,
    tags: ["tank", "taunt", "control"],
    skills: ["warden_bash", "warden_armor", "warden_stun", "warden_hold"],
  },
  berserker: {
    id: "berserker",
    label: "狂战士",
    archetype: "warrior",
    hp: 1.05,
    atk: 1.55,
    def: 0.75,
    int: 0.65,
    tags: ["lowhp", "lifesteal"],
    skills: ["berserker_zero", "berserker_cleave", "berserker_wind", "berserker_blood"],
  },
  paladin: {
    id: "paladin",
    label: "圣骑士",
    archetype: "warrior",
    hp: 1.25,
    atk: 1.0,
    def: 1.15,
    int: 0.6,
    tags: ["tank", "protect", "magic_user"],
    skills: ["paladin_smite", "paladin_protect", "paladin_judgment", "paladin_aura"],
  },
  spellbreaker: {
    id: "spellbreaker",
    label: "破法者",
    archetype: "warrior",
    hp: 0.95,
    atk: 1.15,
    def: 0.85,
    int: 1.05,
    tags: ["swift", "break"],
    skills: ["breaker_break", "breaker_rift", "breaker_counter", "breaker_swift"],
  },
  ranger: {
    id: "ranger",
    label: "游侠",
    archetype: "warrior",
    hp: 0.7,
    atk: 1.5,
    def: 0.7,
    int: 1.1,
    tags: ["swift", "pierce", "execute"],
    skills: ["ranger_zero", "ranger_volley", "ranger_pierce", "ranger_harvest", "ranger_swift"],
  },
  assassin: {
    id: "assassin",
    label: "刺客",
    archetype: "warrior",
    hp: 0.75,
    atk: 1.2,
    def: 0.7,
    int: 1.35,
    tags: ["swift", "interrupt", "execute"],
    skills: ["assassin_zero", "assassin_interrupt", "assassin_backstab", "assassin_execute", "assassin_swift"],
  },
  warlock: {
    id: "warlock",
    label: "咒术师",
    archetype: "mage",
    hp: 0.75,
    atk: 0.7,
    def: 0.7,
    int: 1.85,
    tags: ["lowhp", "magic_user"],
    skills: ["warlock_frost", "warlock_starfire", "warlock_meteor", "warlock_lowhp"],
  },
  lifebringer: {
    id: "lifebringer",
    label: "生术师",
    archetype: "mage",
    hp: 0.95,
    atk: 0.55,
    def: 0.8,
    int: 1.7,
    tags: ["heal", "regen", "magic_user"],
    skills: ["life_renew", "life_mass", "life_revive", "life_regen"],
  },
  binder: {
    id: "binder",
    label: "缚术师",
    archetype: "mage",
    hp: 0.85,
    atk: 0.65,
    def: 0.8,
    int: 1.7,
    tags: ["control", "magic_user"],
    skills: ["binder_sleep", "binder_charm", "binder_bind", "binder_focus"],
  },
  summoner: {
    id: "summoner",
    label: "召唤师",
    archetype: "mage",
    hp: 0.9,
    atk: 0.6,
    def: 0.85,
    int: 1.65,
    tags: ["summon", "magic_user"],
    skills: ["summoner_call", "summoner_poison", "summoner_ward", "summoner_aura"],
  },
  dancer: {
    id: "dancer",
    label: "舞者",
    archetype: "support",
    hp: 1.0,
    atk: 0.55,
    def: 0.9,
    int: 1.55,
    tags: ["ap"],
    skills: ["dancer_step", "dancer_frenzy", "dancer_veil", "dancer_grace"],
  },
  healer: {
    id: "healer",
    label: "治疗师",
    archetype: "support",
    hp: 1.05,
    atk: 0.5,
    def: 0.9,
    int: 1.55,
    tags: ["heal", "cleanse"],
    skills: ["healer_heal", "healer_cleanse", "healer_revive", "healer_plus"],
  },
  bard: {
    id: "bard",
    label: "吟游诗人",
    archetype: "support",
    hp: 0.95,
    atk: 0.6,
    def: 0.95,
    int: 1.5,
    tags: ["buff", "boost_giver"],
    skills: ["bard_inspire", "bard_ward", "bard_anthem", "bard_aura"],
  },
}

export const SUBJOBS_BY_ARCHETYPE: Record<Job, SubJobId[]> = {
  tank: ["bulwark", "warden"],
  warrior: ["berserker", "paladin", "spellbreaker", "ranger", "assassin"],
  mage: ["warlock", "lifebringer", "binder", "summoner"],
  support: ["dancer", "healer", "bard"],
}

export function hashOf(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return h
}

export function subjobFor(seed: string, job: Job): SubJob {
  const pool = SUBJOBS_BY_ARCHETYPE[job]
  return SUBJOBS[pool[hashOf(`${seed}|subjob`) % pool.length]]
}

/** 池卡/本体卡/镜像卡的技能种子 */
export function skillSeed(cardId: string): string {
  return cardId.replace(/^(pool|hero|mirror)-/, "")
}

/**
 * 卡面与战斗共用的技能池（严格遵循 §4.1 槽位规则）：
 * - C / UC / R / E / L：固定 2 个技能槽（1 主动 + 1 被动，或 L 的 2 槽）
 * - Radiant / Prismatic / 本体卡：3 个技能槽（2 主动 + 1 被动）
 * 绝不额外硬塞第 4、第 5 个技能。
 */
export function skillDefsFor(seed: string, job: Job, rarity: Rarity, wantThree = false): SkillDef[] {
  const subjob = subjobFor(seed, job)
  const pool = subjob.skills.map((id) => SKILLS[id]).filter(Boolean)
  const actives = pool.filter((skill) => !skill.passive)
  const passives = pool.filter((skill) => skill.passive)
  const count = wantThree || rarity === "Radiant" || rarity === "Prismatic" ? 3 : 2
  const activeCount = Math.min(actives.length, Math.max(1, count - 1))
  const h = hashOf(`${seed}|skillpick`)
  const pickedActives: SkillDef[] = []
  for (let i = 0; i < activeCount && i < actives.length; i += 1) {
    pickedActives.push(actives[(h + i) % actives.length]!)
  }
  const pickedPassives = passives.slice(0, Math.max(1, count - pickedActives.length))
  return [...pickedActives, ...pickedPassives].slice(0, count)
}

/**
 * 旧版技能名（数据库里存量卡面 / 早期池卡）→ 现行技能定义 ID。
 * 战斗读取的是卡面自己 `skills` 字段，靠这张表把老名字映射到现行机制，
 * 从而保证「卡面印的技能」和「战斗中能点的技能」永远一一对应。
 */
const SKILL_NAME_ALIAS: Record<string, string> = {
  铁壁: "bulwark_guard",
  反震: "bulwark_thorns",
  震地: "bulwark_quake",
  嘲讽: "bulwark_taunt",
  盾击: "warden_bash",
  重装甲: "warden_armor",
  击晕: "warden_stun",
  坚守: "warden_hold",
  裂空斩: "berserker_cleave",
  追风: "berserker_wind",
  血怒: "berserker_blood",
  吸血: "berserker_blood",
  圣光斩: "paladin_smite",
  庇护: "paladin_protect",
  审判: "paladin_judgment",
  守护光环: "paladin_aura",
  破盾: "breaker_break",
  法术反制: "breaker_rift",
  裂法: "breaker_rift",
  穿甲箭: "ranger_pierce",
  连射: "ranger_volley",
  收割: "ranger_harvest",
  背刺: "assassin_backstab",
  打断: "assassin_interrupt",
  暗杀: "assassin_execute",
  星火: "warlock_starfire",
  霜缚: "warlock_frost",
  陨石: "warlock_meteor",
  残血增幅: "warlock_lowhp",
  回春: "life_renew",
  群体治疗: "life_mass",
  复苏: "life_revive",
  生生不息: "life_regen",
  眠咒: "binder_sleep",
  魅惑: "binder_charm",
  束缚: "binder_bind",
  专注: "binder_focus",
  召唤: "summoner_call",
  毒藤: "summoner_poison",
  守护召唤: "summoner_ward",
  召唤共鸣: "summoner_aura",
  舞步: "dancer_step",
  狂热之舞: "dancer_frenzy",
  舞者增幅: "dancer_grace",
  回旋: "dancer_veil",
  治疗: "healer_heal",
  净化: "healer_cleanse",
  抬人: "healer_revive",
  医者仁心: "healer_plus",
  鼓舞: "bard_inspire",
  战歌: "bard_ward",
  英勇颂: "bard_anthem",
  余音: "bard_aura",
  回响: "bard_ward",
  共鸣: "summoner_aura",
  静默: "binder_charm",
}

const SWIFT_BY_JOB: Record<Job, string> = {
  tank: "warden_hold",
  warrior: "ranger_swift",
  mage: "binder_focus",
  support: "bard_aura",
}

const SKILL_BY_NAME: Record<string, SkillDef> = Object.fromEntries(
  Object.values(SKILLS).map((def) => [def.name, def]),
)

/** 解析卡面技能名 → 现行技能定义（先按名字，再按别名，最后按职业补迅捷） */
function resolveSkillDef(skill: CardSkill, job: Job): SkillDef | undefined {
  const direct = SKILL_BY_NAME[skill.name]
  if (direct) return direct
  if (skill.name === "迅捷") return SKILLS[SWIFT_BY_JOB[job]]
  const aliasId = SKILL_NAME_ALIAS[skill.name]
  return aliasId ? SKILLS[aliasId] : undefined
}

/** 技能名 → 技能 id（用于把老卡数据迁移到 skillRefs） */
export function skillIdForName(name: string, job: Job): string | null {
  const direct = SKILL_BY_NAME[name]
  if (direct) return direct.id
  if (name === "迅捷") return SWIFT_BY_JOB[job]
  return SKILL_NAME_ALIAS[name] ?? null
}

export function skillById(id: string): SkillDef | undefined {
  return SKILLS[id]
}

/**
 * 把技能引用还原成卡面技能。
 * 优先保留 ref.name（老卡显示名不变），行为与费用一律取注册表。
 */
// 参数仅为兼容 src/card/def.ts 的调用而保留
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function cardSkillsFromRefs(refs: CardSkillRef[], _job?: Job): CardSkill[] {
  const out: CardSkill[] = []
  for (const ref of refs) {
    const def = SKILLS[ref.skillId]
    if (!def) continue
    out.push({
      name: ref.name ?? def.name,
      element: def.element,
      ap: def.passive ? 0 : def.ap,
      mp: def.passive ? undefined : def.mp,
      passive: def.passive || undefined,
    })
  }
  if (out.length === 0) return []
  return out
}

/** 把卡面技能转换成技能引用（新卡导入时使用） */
export function refsFromCardSkills(skills: CardSkill[], job: Job): CardSkillRef[] {
  const refs: CardSkillRef[] = []
  for (const skill of skills) {
    const id = skillIdForName(skill.name, job)
    if (!id) continue
    refs.push({ skillId: id, name: skill.name })
  }
  return refs
}

/**
 * 把卡面技能规范化成现行技能的费用/属性。
 * 卡面展示与战斗共用同一份结果，避免「卡上写 1 AP、实战扣 2 AP」这类不一致。
 */
export function normalizeCardSkill(skill: CardSkill, job: Job): CardSkill {
  const def = resolveSkillDef(skill, job)
  if (!def) return skill
  const passive = Boolean(skill.passive || def.passive)
  return {
    name: skill.name,
    element: def.element,
    ap: passive ? 0 : def.ap,
    mp: passive ? undefined : def.mp,
    passive: passive || undefined,
  }
}

/**
 * 把卡面上的一条 `CardSkill` 解析成战斗内可执行的 `SkillDef`。
 * - 费用 / 属性 / 被动与否与卡面完全一致（卡面已由 `normalizeCardSkill` 规范化）；
 * - 技能行为（倍率 / 段数 / 附加状态）从现行技能表按名字或别名取。
 */
export function skillDefFromCardSkill(skill: CardSkill, job: Job): SkillDef {
  const base = resolveSkillDef(skill, job)

  if (!base) {
    if (skill.passive) {
      return {
        id: `card-passive-${skill.name}`,
        name: skill.name,
        element: skill.element,
        ap: 0,
        kind: "passive",
        passive: true,
        desc: "被动技能：常驻自动生效。",
      }
    }
    return {
      id: `card-skill-${skill.name}`,
      name: skill.name,
      element: skill.element,
      ap: skill.ap,
      mp: skill.mp,
      kind: "damage",
      costTag: "normal",
      power: 0.55 + skill.ap * 0.4,
      hits: 1,
      target: "enemy",
      desc: `${skill.ap} AP 单体攻击技能。`,
    }
  }

  if (skill.passive) {
    return {
      ...base,
      name: skill.name,
      element: skill.element,
      ap: 0,
      mp: undefined,
      passive: true,
      kind: "passive",
    }
  }

  // 费用与属性一律以现行技能定义为准：卡面已由 normalizeCardSkill 同步成同一份数值
  return {
    ...base,
    name: skill.name,
    passive: false,
  }
}

export function cardSkillsFor(seed: string, job: Job, rarity: Rarity, wantThree = false): CardSkill[] {
  return skillDefsFor(seed, job, rarity, wantThree).map((skill) => ({
    name: skill.name,
    element: skill.element,
    ap: skill.ap,
    mp: skill.mp,
    passive: skill.passive,
  }))
}

export const JOB_ORDER: Job[] = ["tank", "warrior", "mage", "support"]

export const SKILL_SETS: Record<Job, CardSkill[]> = {
  tank: [
    { name: "铁壁", element: "earth", ap: 1 },
    { name: "反震", element: "metal", ap: 0, passive: true },
    { name: "震地", element: "earth", ap: 2 },
  ],
  warrior: [
    { name: "裂空斩", element: "physical", ap: 2 },
    { name: "追风", element: "thunder", ap: 1 },
    { name: "血怒", element: "dark", ap: 0, passive: true },
  ],
  mage: [
    { name: "霜缚", element: "ice", ap: 1, mp: 3 },
    { name: "星火", element: "fire", ap: 2, mp: 5 },
    { name: "静默", element: "light", ap: 2, mp: 4 },
  ],
  support: [
    { name: "回响", element: "light", ap: 1 },
    { name: "庇护", element: "wood", ap: 1, mp: 2 },
    { name: "共鸣", element: "light", ap: 0, passive: true },
  ],
}

/** 按职业/子职业 + 稀有度取技能；seed 相同则结果恒定 */
export function skillsFor(job: Job, rarity: Rarity, wantThree = false, seed?: string): CardSkill[] {
  if (seed) return cardSkillsFor(seed, job, rarity, wantThree)

  const pool = SKILL_SETS[job]
  const count = rarity === "Radiant" || rarity === "Prismatic" || wantThree ? 3 : 2
  return pool.slice(0, count)
}
