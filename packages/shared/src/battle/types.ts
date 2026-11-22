import { CONSTELLATION_BONUS, RARITY_BASE } from "../config"
import {
  ARCHETYPE_COEF,
  MP_MAX_BY_RARITY,
  MP_REGEN_BY_RARITY,
  skillDefFromCardSkill,
  skillSeed,
  subjobFor,
  type SkillDef,
  type SubJob,
} from "../skills"
import type { CardFaceData, Element, Job, Rarity } from "../types"
import type { EnemyAi, StarCondition } from "./content"

export const MAX_SUPPORT_SLOTS = 7

export type CardTrigger = "boost" | "critical_art" | "double_cast"

export interface BattleStats {
  /** 该卡对队伍总血条的 HP 贡献值 */
  hpContribution: number
  atk: number
  def: number
  int: number
  hit: number
  crit: number
  mpMax: number
  mp: number
  mpRegen: number
}

export const STATUS_IDS = [
  "freeze",
  "shock",
  "burn",
  "poison",
  "fear",
  "charm",
  "bleed",
  "confuse",
  "curse",
  "silence",
  "armor_break",
  "stun",
  "sleep",
  "heal_block",
  "weaken",
  "slow",
  "support_ban",
  "thorns",
  "vigilant",
  "vulnerable",
  "enrage",
  "buff_atk",
  "buff_def",
  "buff_int",
] as const
export type StatusId = (typeof STATUS_IDS)[number]

export interface StatusEffect {
  id: StatusId | string
  name: string
  stat?: "atk" | "int" | "def"
  amount: number
  turns: number
  stacks?: number
  isDebuff?: boolean
}

export interface BattleCard {
  uid: number
  cardId: string
  name: string
  job: Job
  subjob: SubJob
  rarity: Rarity
  level: number
  constellation: number
  art?: string
  face: CardFaceData
  stats: BattleStats
  skills: SkillDef[]
  /** 本回合是否已行动（回合结束自动恢复，无跨回合 CD） */
  acted: boolean
  /** 被敌方 Down 技能击倒状态 */
  down: boolean
  /** 被击倒后自然苏醒剩余回合数（无替补时 3 回合自动清醒） */
  downTurns: number
  /** 已用过的单次技能 ID */
  usedOnce: string[]
  /** 上一回合使用过的技能 ID（用于判定疲惫 +1 AP） */
  lastTurnSkills: string[]
  /** 本回合使用过的技能 ID（回合切换时转入 lastTurnSkills） */
  thisTurnSkills: string[]
  /** 远征累积型技能已使用次数（每次 +1 AP） */
  accumulatedUses: Record<string, number>
  /** 单卡附着状态（荆棘 / 沉默 / 眩晕 / 混乱 / 魅惑 / 迟缓） */
  statuses: StatusEffect[]
  /** 本回合是否开启嘲讽 */
  taunt: boolean
  /** 本回合初掷出的特殊触发（Boost 1.5× / 必杀 3.0× / 连击 ×2） */
  trigger: CardTrigger | null
}

/** 敌方行动模板（对应战斗机制 v0.1 §12 的 8 类模板） */
export const INTENT_KINDS = [
  "attack",
  "magic",
  "buff",
  "debuff",
  "heavy_phys",
  "heavy_magic",
  "add_support",
  "break_support",
] as const
export type IntentKind = (typeof INTENT_KINDS)[number]

export interface EnemyIntent {
  id: string
  kind: IntentKind
  label: string
  element: Element
  power: number
  hits: number
  desc: string
  /** 是否附带 Down 威胁 */
  causesDown?: boolean
  /** 标红「无法打断」（约 1/3 的招牌技） */
  uninterruptible?: boolean
  /** 是否已被刺客打断取消 */
  interrupted?: boolean
  /** 是否为蓄力满槽释放的大招 */
  isChargedUltimate?: boolean
  /** 附加的负面状态 ID */
  statusId?: StatusId
}

/** 侧面支援栏单位（敌方在左侧 7 格，我方在右侧 7 格） */
export const SUPPORT_KINDS = ["attack", "defense", "armor", "aura", "thorns", "charge"] as const

export interface SideSupportUnit {
  id: string
  name: string
  kind: (typeof SUPPORT_KINDS)[number]
  element: Element
  job?: Job
  atk?: number
  power?: number
  hits?: number
  /** 攻击型支援发动率（默认 0.60） */
  procRate?: number
  /** 防御/装甲档位 1~4 */
  defenseTier?: number
  stat?: "atk" | "int" | "def"
  amount?: number
  stacks?: number
  maxStacks?: number
  /** 锁定支援不可被拆毁 */
  locked?: boolean
  /** 仅本回合生效（如我方主动防御指令） */
  temporary?: boolean
  /** 被【支援排除】封印的剩余回合数 */
  bannedTurns?: number
  /** 本回合刚触发过动画高亮 */
  triggered?: boolean
  roleText: string
}

export const ENEMY_TIERS = ["normal", "elite", "boss"] as const
export type EnemyTier = (typeof ENEMY_TIERS)[number]

/** 敌人特性：引擎据此套用规则（如灵体受物理 +20%），不再按敌人 id 判断 */
export const ENEMY_TRAITS = ["spirit"] as const
export type EnemyTrait = (typeof ENEMY_TRAITS)[number]

export interface Enemy {
  id: string
  name: string
  title: string
  tier: EnemyTier
  element: Element
  weaknesses: Element[]
  traits: EnemyTrait[]
  hp: number
  hpMax: number
  atk: number
  int: number
  def: number
  /** 特殊关卡机制：伤害门槛（低于此值只结算 100 点固定伤害，0 为无门槛） */
  damageThreshold?: number
  /** 被打断蓄力后是否进入狂暴（而非脆弱） */
  enrageOnInterrupt?: boolean
  /** 招式表 + 行为脚本；放在状态里，战斗自带全部规则，重放不依赖外部内容 */
  ai: EnemyAi
  intents: EnemyIntent[]
  statuses: StatusEffect[]
  /** 硬控状态：sleep / stun（受到任何命中立即打醒解除！） */
  hardControl: "sleep" | "stun" | null
  /** 本场已被硬控次数（精英/BOSS 上限 2 次） */
  hardControlCount: number
  buff: number
}

export type BattlePhase = "player" | "won" | "lost"

export interface StarResult {
  condition: StarCondition
  met: boolean
}

export interface BattleStarRating {
  stars: StarResult[]
  count: number
}

/** 结构化战斗事件，前端时间轴序列器用它驱动兰斯10演出与音效 */
export type BattleEvent =
  | {
      type: "cutin"
      actor: "card" | "support" | "preemptive" | "enemy"
      cardIndex?: number
      supportId?: string
      title: string
      subtitle: string
      element: Element
      trigger?: CardTrigger | null
    }
  | {
      type: "damage"
      target: "enemy" | "party"
      amount: number
      cardIndex?: number
      element: Element
      crit?: boolean
      isWeak?: boolean
      blocked?: boolean
      combo?: number
      source?: string
      /** 这一击结算后队伍总血量的快照，用于让血条跟着演出逐段下降 */
      hpAfter?: number
      /** 这一击结算后敌方血量的快照 */
      enemyHpAfter?: number
    }
  | {
      type: "heal"
      amount: number
      source?: string
      hpAfter?: number
    }
  | {
      type: "miss"
      cardIndex?: number
      actorName: string
    }
  | {
      type: "down"
      cardIndex: number
      cardName: string
    }
  | {
      type: "revive"
      cardIndex: number
      cardName: string
    }
  | {
      type: "guard"
      tier: number
      reductionPct: number
    }
  | {
      type: "interrupt_roll"
      targetIntentIndex: number
      intentLabel: string
      success: boolean
      reason?: string
    }
  | {
      type: "wake_up"
      enemyName: string
    }
  | {
      type: "laser"
      targetSlots: number[]
      guardedSlot?: number
    }
  | {
      type: "ap"
      value: number
    }
  | {
      type: "turn"
      owner: "player" | "enemy"
      round: number
    }
  | {
      type: "won" | "lost"
    }

/** 两条独立随机流：我方行动（命中、暴击、触发、支援…）和敌方行动（选目标、击倒判定…） */
export type RngStream = "player" | "enemy"

export interface BattleState {
  /** content/encounters/ 里的遭遇 id */
  encounterId: string
  /** 这场遭遇的三星条件 */
  starConditions: StarCondition[]
  /** 这场战斗的种子；同样的种子 + 同样的操作 = 同样的结果 */
  seed: string
  /** 各随机流的当前状态（uint32） */
  rng: Record<RngStream, number>
  /** 战斗内动态生成对象（召唤物等）的自增 id */
  idSeq: number
  turn: number
  phase: BattlePhase
  ap: number
  apMax: number
  combo: number
  maxCombo: number
  apSpentTotal: number
  downCount: number
  /** 本回合主动防御档位 0–4 */
  defenseTier: number
  /** 本回合刺客是否已尝试过打断（每回合限 1 次） */
  interruptUsedThisTurn: boolean
  /** 本回合是否已在本回合行动过（一旦行动过，本回合不可再主动换人） */
  hasActedThisTurn: boolean
  /** 换人冷却回合数 */
  swapCooldown: number
  /** 队伍总血条（= 场上主队卡片 HP 贡献之和） */
  teamHp: number
  teamHpMax: number
  /** 我方队伍级状态（冻结/触电/燃烧/中毒/流血/恐惧/诅咒/破防/治疗阻断/衰弱） */
  teamStatuses: StatusEffect[]
  /** 场上 7 张主队卡 */
  cards: BattleCard[]
  /** 替补席备战卡 */
  bench: BattleCard[]
  /** 左侧：敌方侧面支援栏（上限 7 格） */
  enemySupports: SideSupportUnit[]
  /** 右侧：我方侧面支援栏（上限 7 格，含防御占 1 格） */
  playerSupports: SideSupportUnit[]
  enemy: Enemy
  log: string[]
  selectedCard: number | null
  events: BattleEvent[]
  actionSeq: number
}

function heroLevelFactor(level: number): number {
  const lv = Math.min(Math.max(level, 1), 12)
  if (lv <= 6) return 1 + 0.03 * (lv - 1)
  // 逐次相乘而不是 **：各家引擎的 pow 末位可能不同，复算必须逐位一致
  let factor = 1.18
  for (let i = 6; i < lv; i += 1) factor *= 1.2
  return factor
}

function basePower(face: CardFaceData): number {
  const roll = (face.rollBp ?? 1000) / 1000
  if (face.isHero) return 400 * heroLevelFactor(face.level) * roll
  const levelFactor = 1 + 0.06 * (Math.max(face.level, 1) - 1)
  const starFactor = 1 + CONSTELLATION_BONUS[face.rarity] * face.constellation
  return RARITY_BASE[face.rarity] * levelFactor * starFactor * roll
}

export function statsFor(face: CardFaceData, subjob: SubJob): BattleStats {
  const base = basePower(face)
  const scaled = base * ARCHETYPE_COEF[face.job]
  const hpContribution = Math.round(scaled * subjob.hp)
  const isMagicUser = subjob.tags.includes("magic_user")
  const mpMax = isMagicUser ? MP_MAX_BY_RARITY[face.rarity] : 0
  const mpRegen = isMagicUser ? MP_REGEN_BY_RARITY[face.rarity] : 0
  return {
    hpContribution,
    atk: Math.round(scaled * subjob.atk),
    def: Math.round(scaled * subjob.def),
    int: Math.round(scaled * subjob.int),
    hit: 95 + (subjob.tags.includes("swift") ? 5 : 0),
    crit: 5,
    mpMax,
    mp: Math.ceil(mpMax * 0.5),
    mpRegen,
  }
}

export function createBattleCard(face: CardFaceData, uid: number, cardId: string): BattleCard {
  const seed = skillSeed(face.id)
  const subjob = subjobFor(seed, face.job)
  // 战斗技能直接来自卡面自己的 skills 字段（名字、属性、AP、被动与否完全一致）。
  // 不做任何兜底补技能：卡面上没印的技能，战斗里就不存在。
  const skills: SkillDef[] = face.skills.map((skill) => skillDefFromCardSkill(skill, face.job))
  const initialStatuses: StatusEffect[] = []
  if (subjob.tags.includes("thorns")) {
    initialStatuses.push({
      id: "thorns",
      name: "荆棘",
      amount: 0.35,
      turns: 2,
    })
  }
  return {
    uid,
    cardId,
    name: face.name,
    job: face.job,
    subjob,
    rarity: face.rarity,
    level: face.level,
    constellation: face.constellation,
    art: face.art,
    face,
    stats: statsFor(face, subjob),
    skills,
    acted: false,
    down: false,
    downTurns: 0,
    usedOnce: [],
    lastTurnSkills: [],
    thisTurnSkills: [],
    accumulatedUses: {},
    statuses: initialStatuses,
    taunt: false,
    trigger: null,
  }
}

export function calcTeamHpMax(cards: BattleCard[]): number {
  return Math.max(
    1,
    cards.reduce((sum, card) => sum + card.stats.hpContribution, 0),
  )
}
