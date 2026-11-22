import { deriveStream, nextRandom } from "../rng"
import type { NumericEffectKey, SkillDef } from "../skills"
import type { CardFaceData, Element } from "../types"
import { ELEMENT_LABEL } from "../types"

import {
  MAX_SUPPORT_SLOTS,
  calcTeamHpMax,
  createBattleCard,
  type BattleCard,
  type BattleEvent,
  type BattleState,
  type CardTrigger,
  type Enemy,
  type EnemyIntent,
  type SideSupportUnit,
  type StatusEffect,
  type StatusId,
  type RngStream,
} from "./types"

import {
  PREEMPTIVE_RATE,
  SUPPORT_PROC_RATE,
} from "./config"
import {
  comboMultiplier,
  defenseReductionOf,
  elementMultiplier,
  mitigation,
} from "./rules"
import { evalCondition, intentsFor } from "./ai"
import type { EncounterSpec } from "./content"

export { ROMAN_TIER } from "./config"
export { evaluateStars } from "./stars"
export {
  comboMultiplier,
  defenseReductionOf,
  elementMultiplier,
  enemyDamageTier,
  mitigation,
} from "./rules"

/** 从指定随机流取一个 [0, 1) 的数，并推进流的状态 */
function roll(state: BattleState, stream: RngStream): number {
  const [next, value] = nextRandom(state.rng[stream])
  state.rng[stream] = next
  return value
}

function random(state: BattleState, stream: RngStream, min: number, max: number): number {
  return min + roll(state, stream) * (max - min)
}

function pickOne<T>(state: BattleState, stream: RngStream, list: T[]): T {
  return list[Math.floor(roll(state, stream) * list.length)]!
}

function beginAction(state: BattleState) {
  state.events = []
  state.actionSeq += 1
}

function emit(state: BattleState, event: BattleEvent) {
  state.events.push(event)
}

function log(state: BattleState, line: string) {
  state.log.unshift(line)
  state.log = state.log.slice(0, 32)
}

export function aliveCards(cards: BattleCard[]): BattleCard[] {
  return cards.filter((card) => !card.down)
}

export function hasTankAlive(cards: BattleCard[]): boolean {
  return aliveCards(cards).some((card) => card.job === "tank")
}

/** 一张卡带着的被动技能（被 Down 则全部失效） */
function passivesOf(card: BattleCard): SkillDef[] {
  return card.down ? [] : card.skills.filter((skill) => skill.passive)
}

function cardEffectSum(card: BattleCard, key: NumericEffectKey): number {
  return passivesOf(card).reduce((sum, skill) => sum + (skill[key] ?? 0), 0)
}

/** 全队存活卡的某个数值效果之和 */
function teamEffectSum(cards: BattleCard[], key: NumericEffectKey): number {
  return cards.reduce((sum, card) => sum + cardEffectSum(card, key), 0)
}

function hasSwift(card: BattleCard): boolean {
  return passivesOf(card).some((skill) => skill.swift)
}

/**
 * 计算技能在当前回合的实际 AP 费用（§6.5 常态 / 疲惫 / 远征累积 / 单次）
 */
export function effectiveApCost(state: BattleState, card: BattleCard, skill: SkillDef): number {
  let cost = skill.ap
  if (skill.costTag === "fatigue" && card.lastTurnSkills.includes(skill.id)) {
    cost += 1
  }
  if (skill.costTag === "accumulate") {
    cost += card.accumulatedUses[skill.id] ?? 0
  }
  return Math.min(state.apMax, cost)
}

/**
 * 檢查技能当前是否可用；返回不可用原因或 null
 */
export function canUseSkillReason(state: BattleState, cardIndex: number, skillId: string): string | null {
  if (state.phase !== "player") return "战斗已结束"
  const card = state.cards[cardIndex]
  if (!card) return "无效卡槽"
  if (card.down) return "该卡处于 DOWN 状态"
  if (card.acted) return "该卡本回合已行动"
  if (card.statuses.some((s) => s.id === "stun")) return "该卡处于眩晕状态，本回合无法行动"

  const skill = card.skills.find((item) => item.id === skillId)
  if (!skill || skill.passive) return "被动技能自动生效"
  if ((skill.once || skill.costTag === "once") && card.usedOnce.includes(skill.id)) {
    return "单次技能本场已使用"
  }
  if (skill.unlockTurn && state.turn < skill.unlockTurn) {
    return `【${skill.name}】前 ${skill.unlockTurn - 1} 回合锁定（第 ${skill.unlockTurn} 回合解锁，当前 Round ${state.turn}）`
  }
  if (
    card.statuses.some((s) => s.id === "silence") &&
    (card.job === "mage" || card.job === "support")
  ) {
    return "处于【沉默】状态，无法使用法术/辅助主动技"
  }

  const apCost = effectiveApCost(state, card, skill)
  if (state.ap < apCost) return `AP 不足（需要 ${apCost} AP）`
  if (skill.kind === "interrupt" && state.interruptUsedThisTurn) {
    return "每回合最多尝试 1 次打断"
  }
  return null
}

function supportStatBonus(supports: SideSupportUnit[], stat: "atk" | "int" | "def"): number {
  return supports
    .filter((s) => s.kind === "aura" && !s.bannedTurns && (s.stat === stat || (s.stat === "atk" && stat === "int")))
    .reduce((sum, s) => sum + (s.amount ?? 0), 0)
}

function statusBonus(statuses: StatusEffect[], stat: "atk" | "int" | "def"): number {
  return statuses
    .filter((status) => status.stat === stat)
    .reduce((sum, status) => sum + status.amount, 0)
}

export function statOf(state: BattleState, card: BattleCard, stat: "atk" | "int" | "def"): number {
  let value = card.stats[stat]
  const lowHp = state.teamHp / Math.max(1, state.teamHpMax) < 0.3
  if (stat !== "def" && lowHp) {
    for (const skill of passivesOf(card)) if (skill.lowHpMul) value *= skill.lowHpMul
  }
  if (stat === "def") {
    for (const skill of passivesOf(card)) if (skill.defMul) value *= skill.defMul
  }
  const cardMod = statusBonus(card.statuses, stat)
  const teamMod = statusBonus(state.teamStatuses, stat)
  const supMod = supportStatBonus(state.playerSupports, stat)
  const weakenMod =
    stat !== "def" && (card.statuses.some((s) => s.id === "weaken") || state.teamStatuses.some((s) => s.id === "weaken"))
      ? -0.2
      : 0
  return Math.max(1, Math.round(value * Math.max(0.2, 1 + cardMod + teamMod + supMod + weakenMod)))
}

/** 计算我方当前生效的防御档位（取主动防御指令与右侧重装甲支援的最高档，再扣除破防层数） */
export function effectivePlayerDefenseTier(state: BattleState): number {
  const supportArmor = state.playerSupports
    .filter((s) => (s.kind === "defense" || s.kind === "armor") && !s.bannedTurns)
    .reduce((max, s) => Math.max(max, s.defenseTier ?? 0), 0)
  const rawTier = Math.max(state.defenseTier, supportArmor)
  const breakStacks = state.teamStatuses.find((s) => s.id === "armor_break")?.stacks ?? 0
  return Math.max(0, rawTier - breakStacks)
}

/** 计算敌方当前生效的防御档位（来自左侧敌方装甲支援，扣除我方施加的破防层数） */
export function effectiveEnemyDefenseTier(state: BattleState): number {
  const enemyArmor = state.enemySupports
    .filter((s) => s.kind === "armor" && !s.bannedTurns)
    .reduce((max, s) => Math.max(max, s.defenseTier ?? 0), 0)
  const breakStacks = state.enemy.statuses.find((s) => s.id === "armor_break")?.stacks ?? 0
  return Math.max(0, enemyArmor - breakStacks)
}

function enemyDefence(state: BattleState, magic: boolean): number {
  const base = magic ? state.enemy.int : state.enemy.def
  const bonus = statusBonus(state.enemy.statuses, magic ? "int" : "def")
  const enragePenalty = !magic && state.enemy.statuses.some((s) => s.id === "enrage") ? -0.3 : 0
  // 敌方防御档位已经为 0 时，破防层数改为削减 DEF（-20%/-40%/-70%/-90%）
  const enemyArmor = state.enemySupports.some((s) => s.kind === "armor" && !s.bannedTurns)
  const breakStacks = state.enemy.statuses.find((s) => s.id === "armor_break")?.stacks ?? 0
  const defBreakPenalty =
    !magic && !enemyArmor && breakStacks > 0
      ? -([0, 0.2, 0.4, 0.7, 0.9][Math.min(breakStacks, 4)] ?? 0)
      : 0
  return Math.max(1, Math.round(base * Math.max(0.1, 1 + bonus + enragePenalty + defBreakPenalty)))
}

/** 由遭遇数据生成敌人与敌方支援；意图在战斗状态建好后由脚本生成 */
function makeEnemyAndSupports(spec: EncounterSpec): { enemy: Enemy; enemySupports: SideSupportUnit[] } {
  const def = spec.enemy
  const enemy: Enemy = {
    id: def.id,
    name: def.name,
    title: def.title,
    tier: def.tier,
    element: def.element,
    weaknesses: [...def.weaknesses],
    hiddenWeaknesses: [...def.hiddenWeaknesses],
    weaknessWindows: structuredClone(def.weaknessWindows),
    exposed: [],
    traits: [...def.traits],
    hp: def.stats.hp,
    hpMax: def.stats.hp,
    atk: def.stats.atk,
    int: def.stats.int,
    def: def.stats.def,
    ai: structuredClone(def.ai),
    intents: [],
    statuses: [],
    hardControl: null,
    hardControlCount: 0,
    buff: 0,
  }
  if (def.damageThreshold !== undefined) enemy.damageThreshold = def.damageThreshold
  if (def.enrageOnInterrupt !== undefined) enemy.enrageOnInterrupt = def.enrageOnInterrupt
  const enemySupports = spec.supports.map((unit): SideSupportUnit => ({ ...unit }))
  return { enemy, enemySupports }
}

/** 回合开始时算一次：本回合的意图和露出的窗口弱点（回合中途不再变） */
function refreshEnemyIntents(state: BattleState) {
  state.enemy.intents = intentsFor(state.enemy.ai, state)
  const open = new Set<Element>()
  for (const window of state.enemy.weaknessWindows) {
    if (evalCondition(window.when, state)) for (const el of window.elements) open.add(el)
  }
  state.enemy.exposed = [...open]
}

/** 此刻实际生效的弱点：公开 + 隐藏 + 本回合露出的窗口 */
function activeWeaknesses(enemy: Enemy): Element[] {
  return [...enemy.weaknesses, ...enemy.hiddenWeaknesses, ...enemy.exposed]
}

/** 打中隐藏弱点属性：第一次记入 hiddenFound 并通知界面；只看属性是否在隐藏列表里，不看倍率 */
function noteWeaknessHit(state: BattleState, element: Element) {
  if (!state.enemy.hiddenWeaknesses.includes(element) || state.hiddenFound.includes(element)) return
  state.hiddenFound.push(element)
  emit(state, { type: "weakness_found", element })
  log(state, `发现隐藏弱点：${ELEMENT_LABEL[element]}属性！`)
}

export interface BattleInputCard {
  uid: number
  cardId: string
  face: CardFaceData
}

/**
 * 每回合开始时为存活卡片掷 Boost(1.5×) / 必杀(3.0×) / 连击(×2)（§10.1）
 * 同一张卡最多获得 1 种，不叠加，回合末未消耗则作废
 */
function rollCardTriggers(state: BattleState) {
  const bardBonus = teamEffectSum(state.cards, "triggerBonus")
  for (const card of state.cards) {
    card.trigger = null
    if (card.down) continue
    const modBonus = card.face.mods.length * 0.03
    const r = roll(state, "player")
    const critArtChance = 0.04 + modBonus * 0.5 + bardBonus * 0.3
    const doubleChance = critArtChance + 0.05 + modBonus * 0.5 + bardBonus * 0.3
    const boostChance = doubleChance + 0.12 + modBonus + bardBonus
    if (r < critArtChance) {
      card.trigger = "critical_art"
    } else if (r < doubleChance) {
      card.trigger = "double_cast"
    } else if (r < boostChance) {
      card.trigger = "boost"
    }
  }
}

/** 同步更新右侧支援栏中的「防御」侧面支援占格（§6.7 & §8.1 我方防御占用右侧支援 1 格，分四级） */
function syncDefenseSupportSlot(state: BattleState) {
  const idx = state.playerSupports.findIndex((s) => s.id === "party-defense-slot")
  if (state.defenseTier <= 0) {
    if (idx >= 0) state.playerSupports.splice(idx, 1)
    return
  }
  const tankPresent = hasTankAlive(state.cards)
  const redPct = Math.round(defenseReductionOf(state.defenseTier, tankPresent) * 100)
  const unit: SideSupportUnit = {
    id: "party-defense-slot",
    name: `防御 Lv${state.defenseTier}`,
    kind: "defense",
    element: "earth",
    job: "tank",
    defenseTier: state.defenseTier,
    temporary: true,
    triggered: true,
    roleText: `本回合减伤 −${redPct}%`,
  }
  if (idx >= 0) {
    state.playerSupports[idx] = unit
  } else if (state.playerSupports.length < MAX_SUPPORT_SLOTS) {
    state.playerSupports.unshift(unit)
  } else {
    state.playerSupports[state.playerSupports.length - 1] = unit
  }
}

export function createBattle(
  encounter: EncounterSpec,
  inputs: BattleInputCard[],
  options: { seed: string; bench?: BattleInputCard[] },
): BattleState {
  const cards = inputs.map((input) => createBattleCard(input.face, input.uid, input.cardId))
  const bench = (options.bench ?? []).map((input) => createBattleCard(input.face, input.uid, input.cardId))

  const { enemy, enemySupports } = makeEnemyAndSupports(encounter)

  // 若队伍里有高阶卡（Radiant / Prismatic / 本体卡），解锁部队加成 AP 上限 7 → 10（§6.2）
  const hasHighTier = cards.some(
    (c) => c.face.isHero || c.rarity === "Radiant" || c.rarity === "Prismatic",
  )
  const apMax = hasHighTier ? 10 : 7
  const teamHpMax = calcTeamHpMax(cards)

  // 开局被动侧面支援（如圣骑士在场自动带 1 格初阶圣印）
  const playerSupports: SideSupportUnit[] = []

  const state: BattleState = {
    encounterId: encounter.id,
    starConditions: structuredClone(encounter.stars),
    seed: options.seed,
    rng: {
      player: deriveStream(options.seed, "player"),
      enemy: deriveStream(options.seed, "enemy"),
    },
    idSeq: 0,
    turn: 1,
    phase: "player",
    ap: 2,
    apMax,
    combo: 0,
    maxCombo: 0,
    apSpentTotal: 0,
    downCount: 0,
    defenseTier: 0,
    interruptUsedThisTurn: false,
    hasActedThisTurn: false,
    swapCooldown: 0,
    teamHp: teamHpMax,
    teamHpMax,
    teamStatuses: [],
    cards,
    bench,
    enemySupports,
    playerSupports,
    enemy,
    hiddenFound: [],
    log: [
      encounter.intro ?? `讨伐开始：遭遇【${enemy.name}】！`,
      "提示：开局 2 AP 可继承，0 费技能可无消耗叠高 Combo！",
    ],
    selectedCard: null,
    events: [],
    actionSeq: 0,
  }

  refreshEnemyIntents(state)
  rollCardTriggers(state)
  runPlayerTurnStartSequence(state)
  return state
}

function addOrStackStatus(list: StatusEffect[], incoming: StatusEffect, maxStacks = 5) {
  const existing = list.find((item) => item.id === incoming.id)
  if (existing) {
    existing.turns = Math.max(existing.turns, incoming.turns)
    if (incoming.id === "bleed" || incoming.id === "armor_break") {
      existing.stacks = Math.min(maxStacks, (existing.stacks ?? 1) + (incoming.stacks ?? 1))
    } else {
      existing.amount = Math.max(existing.amount, incoming.amount)
    }
  } else {
    list.push({ ...incoming, stacks: incoming.stacks ?? 1 })
  }
}

function applyEnemyStatusById(state: BattleState, statusId: StatusId, turns = 2) {
  const map: Record<string, StatusEffect> = {
    freeze: { id: "freeze", name: "冻结", amount: 0.2, turns: 2, isDebuff: true },
    shock: { id: "shock", name: "触电", amount: 0.3, turns: 3, isDebuff: true },
    burn: { id: "burn", name: "燃烧", amount: 0.03, turns: 3, isDebuff: true },
    poison: { id: "poison", name: "中毒", amount: 0.03, turns: 4, isDebuff: true },
    fear: { id: "fear", name: "恐惧", amount: 1, turns: 3, isDebuff: true },
    charm: { id: "charm", name: "魅惑", amount: 0.5, turns: 2, isDebuff: true },
    bleed: { id: "bleed", name: "流血", amount: 0.01, turns: 3, stacks: 1, isDebuff: true },
    confuse: { id: "confuse", name: "混乱", amount: 0.3, turns: 2, isDebuff: true },
    curse: { id: "curse", name: "诅咒", amount: 0.15, turns: 3, isDebuff: true },
    silence: { id: "silence", name: "沉默", amount: 1, turns: 2, isDebuff: true },
    armor_break: { id: "armor_break", name: "破防", stat: "def", amount: -0.2, turns: 3, stacks: 1, isDebuff: true },
    weaken: { id: "weaken", name: "衰弱", stat: "atk", amount: -0.2, turns: turns, isDebuff: true },
    vulnerable: { id: "vulnerable", name: "脆弱", amount: 0.3, turns: 2, isDebuff: true },
    enrage: { id: "enrage", name: "狂暴", stat: "atk", amount: 0.4, turns: 99, isDebuff: false },
    vigilant: { id: "vigilant", name: "警觉", amount: 1, turns: 3, isDebuff: false },
  }
  const template = map[statusId]
  if (!template) return
  addOrStackStatus(state.enemy.statuses, { ...template, turns: turns || template.turns })
}

function checkEnemyWakeUp(state: BattleState) {
  if (state.enemy.hardControl) {
    const prev = state.enemy.hardControl === "sleep" ? "眠咒" : "击晕"
    state.enemy.hardControl = null
    emit(state, { type: "wake_up", enemyName: state.enemy.name })
    log(state, `⚠️ ${state.enemy.name} 受到攻击被【打醒】，解除了${prev}状态！`)
  }
}

function applyDamageToEnemy(
  state: BattleState,
  card: BattleCard,
  skill: SkillDef,
  triggerUsed: CardTrigger | null,
) {
  const element = skill.element
  const magic = element !== "physical"
  const attack = statOf(state, card, magic ? "int" : "atk")
  const rawEnemyDef = enemyDefence(state, magic)
  const effectiveDef = skill.piercePct ? Math.round(rawEnemyDef * (1 - skill.piercePct)) : rawEnemyDef
  const enemyArmorTier = effectiveEnemyDefenseTier(state)
  const enemyArmorRed = [0, 0.2, 0.4, 0.7, 0.9][Math.min(enemyArmorTier, 4)] ?? 0

  const hits = skill.hits ?? 1
  const skillPower = skill.power ?? 1
  const triggerMult =
    triggerUsed === "critical_art" ? 3.0 : triggerUsed === "boost" ? 1.5 : 1.0

  // 元素易伤状态加成（冻结冰+20%，触电雷+30%，燃烧火+20%，脆弱全伤+30%）
  let statusVuln = 1.0
  if (element === "ice" && state.enemy.statuses.some((s) => s.id === "freeze")) statusVuln += 0.2
  if (element === "thunder" && state.enemy.statuses.some((s) => s.id === "shock")) statusVuln += 0.3
  if (element === "fire" && state.enemy.statuses.some((s) => s.id === "burn")) statusVuln += 0.2
  if (state.enemy.statuses.some((s) => s.id === "vulnerable")) statusVuln += 0.3

  // 游侠/刺客/狂战士的虚弱/残血收割加成
  let execMult = 1.0
  if (
    skill.executeBonus &&
    (state.enemy.hp / state.enemy.hpMax < 0.4 ||
      state.enemy.statuses.some((s) => s.id === "vulnerable" || s.isDebuff))
  ) {
    execMult += skill.executeBonus
  }

  let total = 0
  let thornsReflectedCount = 0
  const enemyThorns = state.enemySupports.find((s) => s.kind === "thorns" && !s.bannedTurns)

  for (let i = 0; i < hits; i += 1) {
    const confusePenalty = card.statuses.some((s) => s.id === "confuse") ? 20 : 0
    const hitChance = card.stats.hit - confusePenalty
    if (roll(state, "player") * 100 > hitChance) {
      state.combo = Math.floor(state.combo / 2)
      emit(state, {
        type: "miss",
        cardIndex: state.cards.indexOf(card),
        actorName: card.name,
      })
      log(state, `${card.name} 未命中！Combo 腰斩至 ${state.combo}`)
      continue
    }

    // 命中敌方时：若敌方处于硬控（眠咒/击晕），立刻打醒！（§11.1 硬控打醒冲突）
    checkEnemyWakeUp(state)

    state.combo += 1
    state.maxCombo = Math.max(state.maxCombo, state.combo)

    const bonusCrit =
      (state.enemy.statuses.some((s) => s.id === "vulnerable")
        ? passivesOf(card).reduce((sum, s) => sum + (s.critVsVulnerable ?? 0), 0)
        : 0) +
      (element !== "physical" && state.teamHp / state.teamHpMax < 0.3
        ? passivesOf(card).reduce((sum, s) => sum + (s.spellCrit ?? 0), 0)
        : 0)
    const crit = roll(state, "player") * 100 < card.stats.crit + bonusCrit
    const weak = activeWeaknesses(state.enemy)
    const elMult = elementMultiplier(element, state.enemy.element, state.enemy.traits, weak)
    const isWeak = elMult >= 1.2 || weak.includes(element)

    let damage = Math.round(
      attack *
        skillPower *
        triggerMult *
        execMult *
        statusVuln *
        comboMultiplier(state.combo) *
        elMult *
        (1 - mitigation(effectiveDef)) *
        (1 - enemyArmorRed) *
        random(state, "player", 0.95, 1.05) *
        (crit ? 1.5 : 1),
    )

    if (state.enemy.damageThreshold && damage < state.enemy.damageThreshold) {
      damage = 100
    }

    total += damage
    state.enemy.hp = Math.max(0, state.enemy.hp - damage)
    emit(state, {
      type: "damage",
      target: "enemy",
      amount: damage,
      cardIndex: state.cards.indexOf(card),
      element,
      crit,
      isWeak,
      combo: state.combo,
      source: card.name,
      enemyHpAfter: state.enemy.hp,
    })
    log(
      state,
      `${card.name}「${skill.name}」${crit ? "暴击 " : ""}${damage.toLocaleString("en-US")}（Combo ${state.combo}）`,
    )
    noteWeaknessHit(state, element)

    // 敌方侧面支援【荆棘栅栏】逐段固定反伤（每行动最多反 3 段，按攻击卡 INT 减伤 §11.1）
    if (enemyThorns && thornsReflectedCount < 3 && state.teamHp > 0) {
      thornsReflectedCount += 1
      const cardInt = statOf(state, card, "int")
      const thornDmg = Math.max(
        25,
        Math.round((enemyThorns.atk ?? 250) * (1 - mitigation(cardInt))),
      )
      state.teamHp = Math.max(0, state.teamHp - thornDmg)
      emit(state, {
        type: "damage",
        target: "party",
        amount: thornDmg,
        cardIndex: state.cards.indexOf(card),
        element: "wood",
        source: enemyThorns.name,
        hpAfter: state.teamHp,
      })
      log(state, `敌方【${enemyThorns.name}】反弹 ${thornDmg} 魔法伤害！`)
      if (state.teamHp <= 0) {
        state.phase = "lost"
        emit(state, { type: "lost" })
        log(state, "队伍生命归零，讨伐失败")
        return
      }
    }

    if (state.enemy.hp <= 0) break
  }

  const lifesteal = passivesOf(card).reduce((sum, s) => sum + (s.lifesteal ?? 0), 0)
  if (total > 0 && lifesteal > 0) {
    healParty(state, Math.round(total * lifesteal), `${card.name} 吸血`)
  }

  if (state.enemy.hp <= 0) {
    state.phase = "won"
    emit(state, { type: "won" })
    log(state, `讨伐成功！击败了 ${state.enemy.name}！`)
  }
}

function healParty(state: BattleState, rawAmount: number, label = "治疗") {
  if (state.teamHp <= 0) return
  const healBonus = teamEffectSum(state.cards, "healBonus")
  const healBlock = state.teamStatuses.some((s) => s.id === "heal_block") ? 0.5 : 1.0
  const amount = Math.round(rawAmount * (1 + healBonus) * healBlock)
  const before = state.teamHp
  state.teamHp = Math.min(state.teamHpMax, state.teamHp + amount)
  const actual = state.teamHp - before
  if (actual > 0) {
    emit(state, { type: "heal", amount: actual, source: label, hpAfter: state.teamHp })
    log(state, `${label} 为队伍恢复 ${actual.toLocaleString("en-US")} HP`)
  }
}

/** 拆毁敌方左侧非锁定侧面支援 */
function removeEnemySupports(state: BattleState, count: number, actorName: string) {
  let removed = 0
  for (let i = state.enemySupports.length - 1; i >= 0 && removed < count; i -= 1) {
    if (!state.enemySupports[i].locked) {
      const [del] = state.enemySupports.splice(i, 1)
      removed += 1
      log(state, `${actorName} 拆毁了敌方侧面支援【${del.name}】！`)
    }
  }
}

/** 打断敌方侧面蓄力槽（转化为脆弱或狂暴 §6.9） */
function breakEnemyChargeIfPresent(state: BattleState, actorName: string) {
  const chargeUnit = state.enemySupports.find((s) => s.kind === "charge")
  if (chargeUnit && (chargeUnit.stacks ?? 0) > 0) {
    chargeUnit.stacks = 0
    chargeUnit.roleText = "蓄力已打断 (0/" + (chargeUnit.maxStacks ?? 3) + ")"
    if (state.enemy.enrageOnInterrupt) {
      applyEnemyStatusById(state, "enrage", 99)
      log(state, `⚡ ${actorName} 打断了蓄力！${state.enemy.name} 进入【狂暴】（ATK+40% / DEF-30%）！`)
    } else {
      applyEnemyStatusById(state, "vulnerable", 2)
      log(state, `⚡ ${actorName} 打断了蓄力！${state.enemy.name} 进入 2 回合【脆弱】（受到伤害 +30%）！`)
    }
  }
}

export function playSkill(state: BattleState, cardIndex: number, skillId: string): string | null {
  const err = canUseSkillReason(state, cardIndex, skillId)
  if (err) return err

  const card = state.cards[cardIndex]!
  const skill = card.skills.find((item) => item.id === skillId)!
  const apCost = effectiveApCost(state, card, skill)

  beginAction(state)
  state.hasActedThisTurn = true
  state.ap -= apCost
  state.apSpentTotal += apCost
  card.acted = true
  card.thisTurnSkills.push(skill.id)

  if (skill.once || skill.costTag === "once") {
    card.usedOnce.push(skill.id)
  }
  if (skill.costTag === "accumulate") {
    card.accumulatedUses[skill.id] = (card.accumulatedUses[skill.id] ?? 0) + 1
  }

  // 狂战士等卖血换输出技能（§6.5 扣除队伍 HP，最低保留 1 HP）
  if (skill.selfHpCostPct && state.teamHp > 1) {
    const hpCost = Math.min(state.teamHp - 1, Math.round(state.teamHpMax * skill.selfHpCostPct))
    if (hpCost > 0) {
      state.teamHp -= hpCost
      log(state, `${card.name} 献祭 ${hpCost.toLocaleString("en-US")} 队伍生命激活狂血！`)
    }
  }

  // 混乱状态 30% 行动失败；冻结状态 25% 行动失败（§11.1）
  const failByConfuse = card.statuses.some((s) => s.id === "confuse") && roll(state, "player") < 0.3
  const failByFreeze = state.teamStatuses.some((s) => s.id === "freeze") && roll(state, "player") < 0.25
  if (failByConfuse || failByFreeze) {
    card.trigger = null
    emit(state, {
      type: "miss",
      cardIndex,
      actorName: card.name,
    })
    log(state, `${card.name} 受${failByConfuse ? "【混乱】" : "【冻结】"}影响，行动失败！`)
    return null
  }

  // 消耗本回合特殊触发（Boost / 必杀 / 连击 §10.1）
  const consumedTrigger = card.trigger
  card.trigger = null
  const execTimes = consumedTrigger === "double_cast" ? 2 : 1

  emit(state, {
    type: "cutin",
    actor: "card",
    cardIndex,
    title: card.name,
    subtitle: `${skill.name}${consumedTrigger === "critical_art" ? " · 必杀 3.0×" : consumedTrigger === "boost" ? " · BOOST 1.5×" : consumedTrigger === "double_cast" ? " · 二连发动" : ""}`,
    element: skill.element,
    trigger: consumedTrigger,
  })

  const magic = skill.element !== "physical"
  const attack = statOf(state, card, magic ? "int" : "atk")

  for (let castIdx = 0; castIdx < execTimes; castIdx += 1) {
    if (state.phase !== "player") break

    switch (skill.kind) {
      case "damage": {
        applyDamageToEnemy(state, card, skill, consumedTrigger)
        if (skill.statusId && state.phase === "player") {
          applyEnemyStatusById(state, skill.statusId, skill.turns ?? 2)
          log(state, `敌方陷入【${state.enemy.statuses.find((s) => s.id === skill.statusId)?.name ?? skill.statusId}】`)
        }
        if (skill.clearEnemySupports) {
          removeEnemySupports(state, skill.clearEnemySupports, card.name)
        }
        break
      }

      case "interrupt": {
        // 刺客专属盲抽打断（§10.4）
        state.interruptUsedThisTurn = true
        const candidates = state.enemy.intents
          .map((intent, idx) => ({ intent, idx }))
          .filter((item) => !item.intent.interrupted)
        if (candidates.length === 0) {
          log(state, `${card.name} 发动打断，但敌方本回合已无剩余行动`)
          break
        }
        const picked = pickOne(state, "player", candidates)
        const baseRate =
          state.enemy.tier === "boss" ? 0.45 : state.enemy.tier === "elite" ? 0.55 : 0.65
        if (picked.intent.uninterruptible) {
          state.combo = Math.floor(state.combo / 2)
          emit(state, {
            type: "interrupt_roll",
            targetIntentIndex: picked.idx,
            intentLabel: picked.intent.label,
            success: false,
            reason: "无法打断",
          })
          log(
            state,
            `🎲 ${card.name} 抽中了敌方【${picked.intent.label}】，但该招牌技标红【无法打断】！Combo 减半！`,
          )
        } else if (roll(state, "player") > baseRate) {
          state.combo = Math.floor(state.combo / 2)
          emit(state, {
            type: "interrupt_roll",
            targetIntentIndex: picked.idx,
            intentLabel: picked.intent.label,
            success: false,
            reason: "判定未过",
          })
          log(
            state,
            `🎲 ${card.name} 抽中【${picked.intent.label}】但打断判定失败！Combo 减半！`,
          )
        } else {
          picked.intent.interrupted = true
          emit(state, {
            type: "interrupt_roll",
            targetIntentIndex: picked.idx,
            intentLabel: picked.intent.label,
            success: true,
          })
          log(
            state,
            `🎯 打断成功！${card.name} 抽中并取消了敌方行动【${picked.intent.label}】！`,
          )
          breakEnemyChargeIfPresent(state, card.name)
          applyDamageToEnemy(state, card, skill, consumedTrigger)
        }
        break
      }

      case "control": {
        // 硬控：眠咒 / 击晕（§11.1）
        if (state.enemy.statuses.some((s) => s.id === "vigilant")) {
          log(state, `敌方处于【警觉】免疫窗口，硬控无效！`)
          break
        }
        if (state.enemy.tier !== "normal" && state.enemy.hardControlCount >= 2) {
          log(state, `精英/BOSS 本场已被硬控满 2 次，无法再次硬控！`)
          break
        }
        const focusBonus = cardEffectSum(card, "controlBonus")
        const rate =
          (state.enemy.tier === "boss" ? 0.5 : state.enemy.tier === "elite" ? 0.65 : 0.8) +
          focusBonus
        if (roll(state, "player") <= rate) {
          const ctrlType = skill.statusId === "sleep" ? "sleep" : "stun"
          state.enemy.hardControl = ctrlType
          state.enemy.hardControlCount += 1
          if (state.enemy.tier !== "normal") {
            applyEnemyStatusById(state, "vigilant", 3)
          }
          breakEnemyChargeIfPresent(state, card.name)
          log(
            state,
            `💤 ${card.name} 施放【${skill.name}】成功！敌方本回合全部行动被封印（注意：后续攻击命中会将其打醒！）`,
          )
        } else {
          log(state, `${card.name} 施放【${skill.name}】被敌方抵抗！`)
        }
        break
      }

      case "heal": {
        if (skill.revive) {
          const downedCards = state.cards.filter((item) => item.down)
          const reviveCount = skill.revive === "all" ? downedCards.length : skill.revive
          for (const d of downedCards.slice(0, reviveCount)) {
            d.down = false
            d.downTurns = 0
            emit(state, {
              type: "revive",
              cardIndex: state.cards.indexOf(d),
              cardName: d.name,
            })
            log(state, `✨ ${card.name} 救醒了倒下的【${d.name}】！`)
          }
        }
        if (skill.cleanse) {
          state.teamStatuses = state.teamStatuses.filter((s) => !s.isDebuff)
          for (const c of state.cards) {
            c.statuses = c.statuses.filter((s) => !s.isDebuff)
          }
          log(state, `✨ ${card.name} 净化了全队负面状态！`)
        }
        const amount = Math.round(attack * (skill.power ?? 0.8))
        healParty(state, amount, `${card.name}「${skill.name}」`)
        break
      }

      case "guard": {
        const tankPresent = hasTankAlive(state.cards)
        const maxTier = tankPresent ? 4 : 2
        const nextTier = Math.min(maxTier, state.defenseTier + (skill.power ?? 1))
        state.defenseTier = nextTier
        syncDefenseSupportSlot(state)
        const redPct = Math.round(defenseReductionOf(nextTier, tankPresent) * 100)
        emit(state, { type: "guard", tier: nextTier, reductionPct: redPct })
        log(state, `${card.name} 追加侧面支援【防御 Lv${nextTier}】（−${redPct}%）`)
        break
      }

      case "taunt": {
        for (const c of state.cards) c.taunt = false
        card.taunt = true
        if (skill.selfStatus) addOrStackStatus(card.statuses, { ...skill.selfStatus })
        log(state, `🛡️ ${card.name} 开启嘲讽（吸引敌方单体攻击与 Down 判定，并附带荆棘反伤）`)
        break
      }

      case "buff": {
        addOrStackStatus(state.teamStatuses, {
          id: `buff_${skill.stat ?? "atk"}`,
          name: skill.name,
          stat: skill.stat ?? "atk",
          amount: skill.amount ?? 0.2,
          turns: skill.turns ?? 2,
        })
        // 吟游诗人专拐技能：直接为未行动队友点亮 BOOST
        if (skill.boostAllies) {
          const candidates = state.cards.filter((c, idx) => idx !== cardIndex && !c.down && !c.acted && !c.trigger)
          for (const target of candidates.slice(0, skill.boostAllies)) {
            target.trigger = "boost"
          }
          log(state, `🎵 ${card.name} 奏响专拐战歌，全队攻击提升并为队友点亮【BOOST 1.5×】！`)
        } else {
          log(state, `${card.name} 施放群体增益【${skill.name}】`)
        }
        break
      }

      case "debuff": {
        if (skill.power && skill.power > 0) {
          applyDamageToEnemy(state, card, skill, consumedTrigger)
        }
        if (skill.clearEnemySupports) {
          removeEnemySupports(state, skill.clearEnemySupports, card.name)
        }
        if (skill.statusId && state.phase === "player") {
          applyEnemyStatusById(state, skill.statusId, skill.turns ?? 2)
          log(state, `${card.name} 对敌方施加【${skill.name}】`)
        }
        break
      }

      case "ap": {
        const gain = skill.amount ?? 1
        state.ap = Math.min(state.apMax, state.ap + gain)
        emit(state, { type: "ap", value: state.ap })
        log(state, `⚡ ${card.name} 发动「${skill.name}」，回复 ${gain} AP（当前 ${state.ap} AP）`)
        break
      }

      case "summon": {
        const def = skill.supportDef
        if (def) {
          const unit: SideSupportUnit = {
            id: `sup-${(state.idSeq += 1)}`,
            name: def.name,
            kind: def.kind,
            element: def.element,
            job: card.job,
            atk: attack,
            power: def.power ?? 0.5,
            hits: def.hits ?? 1,
            procRate: def.procRate ?? SUPPORT_PROC_RATE,
            defenseTier: def.armorTier,
            stat: def.stat,
            amount: def.amount,
            locked: def.locked,
            roleText: def.roleText,
          }
          if (state.playerSupports.length < MAX_SUPPORT_SLOTS) {
            state.playerSupports.push(unit)
          } else {
            // 若满 7 格，替换第一个非锁定非防御支援
            const repIdx = state.playerSupports.findIndex((s) => !s.locked && s.kind !== "defense")
            if (repIdx >= 0) state.playerSupports[repIdx] = unit
          }
          log(state, `✨ ${card.name} 在右侧支援栏部署了【${unit.name}】（${unit.roleText}）`)
        }
        break
      }

      case "passive":
        break
    }
  }

  return null
}

/**
 * 右翼【防御】按钮：点一次消耗 1 AP 升 1 档（I → II → III → IV），
 * 同时将防御效果作为侧面支援写入右侧支援栏（占用 1 格，§6.7 & §8.1）
 */
export function raiseDefense(state: BattleState, targetTier?: number): string | null {
  if (state.phase !== "player") return "战斗已经结束"
  const tankPresent = hasTankAlive(state.cards)
  const maxTier = tankPresent ? 4 : 2
  const nextTier = targetTier ?? state.defenseTier + 1
  if (nextTier <= state.defenseTier) return "本回合防御档位不可降档"
  if (nextTier > maxTier) {
    return tankPresent
      ? "防御支援已达最高 Lv4（−90%）"
      : "队伍无坦克在场，防御支援最高只能升至 Lv2（−35%）"
  }
  const cost = nextTier - state.defenseTier
  if (state.ap < cost) return `AP 不足（需要 ${cost} AP）`

  beginAction(state)
  state.hasActedThisTurn = true
  state.ap -= cost
  state.apSpentTotal += cost
  state.defenseTier = nextTier
  syncDefenseSupportSlot(state)

  const redPct = Math.round(defenseReductionOf(nextTier, tankPresent) * 100)
  emit(state, { type: "guard", tier: nextTier, reductionPct: redPct })
  log(state, `🛡️ 追加侧面支援【防御 Lv${nextTier}】！本回合承受伤害 −${redPct}%`)
  return null
}

/**
 * 战中替补席换人（§7.3）：
 * - 若被替换卡处于 DOWN 状态，可随时换上替补救援
 * - 否则须在本回合尚未出牌且换人冷却为 0 时更换
 */
export function swapBattleCard(
  state: BattleState,
  activeSlotIndex: number,
  benchUid: number,
): string | null {
  if (state.phase !== "player") return "战斗已结束"
  const outCard = state.cards[activeSlotIndex]
  const benchIndex = state.bench.findIndex((b) => b.uid === benchUid)
  if (!outCard || benchIndex < 0) return "找不到对应替补卡牌"
  const inCard = state.bench[benchIndex]!
  if (inCard.down) return "该替补卡已处于 DOWN 状态"
  if (state.swapCooldown > 0) return `换人冷却中（还需 ${state.swapCooldown} 回合）`
  if (state.hasActedThisTurn && !outCard.down) {
    return "本回合已开始行动，仅允许替换处于 DOWN 状态的卡片"
  }

  beginAction(state)
  const hpRatio = state.teamHp / Math.max(1, state.teamHpMax)
  inCard.acted = outCard.down ? false : true // 顶替 DOWN 卡可立即行动，常规换人本回合待机
  state.cards[activeSlotIndex] = inCard
  state.bench[benchIndex] = outCard
  state.swapCooldown = 1

  state.teamHpMax = calcTeamHpMax(state.cards)
  state.teamHp = Math.max(1, Math.min(state.teamHpMax, Math.round(state.teamHpMax * hpRatio)))
  syncDefenseSupportSlot(state)

  log(
    state,
    `🔄 部队换人：【${outCard.name}】退入替补席 → 【${inCard.name}】登场！`,
  )
  return null
}

/**
 * 我方回合开始自动序列（严格遵循 §6.1 & §8.1 顺序）：
 * 1. 侧面支援自动行动（攻击型 60% 发动率，50% 伤害，命中 +1 Combo）
 * 2. 迅捷卡抢攻判定（游侠/刺客/破法者，70% 伤害，命中 +1 Combo）
 * 3. 主队开始消费 AP
 */
function runPlayerTurnStartSequence(state: BattleState) {
  const summonerBonus = teamEffectSum(state.cards, "supportProcBonus")

  for (const support of state.playerSupports) {
    support.triggered = false
    if (support.bannedTurns && support.bannedTurns > 0) continue
    if (support.kind !== "attack") continue

    const procRate = Math.min(0.95, (support.procRate ?? SUPPORT_PROC_RATE) + summonerBonus)
    if (roll(state, "player") > procRate) continue

    support.triggered = true
    const hits = support.hits ?? 1
    const magic = support.element !== "physical"
    const enemyDef = enemyDefence(state, magic)

    emit(state, {
      type: "cutin",
      actor: "support",
      supportId: support.id,
      title: support.name,
      subtitle: "的侧面支援攻击！",
      element: support.element,
    })

    for (let h = 0; h < hits; h += 1) {
      checkEnemyWakeUp(state)
      state.combo += 1
      state.maxCombo = Math.max(state.maxCombo, state.combo)
      const elMult = elementMultiplier(
        support.element,
        state.enemy.element,
        state.enemy.traits,
        activeWeaknesses(state.enemy),
      )
      const damage = Math.max(
        1,
        Math.round(
          (support.atk ?? 1200) *
            (support.power ?? 0.5) *
            comboMultiplier(state.combo) *
            elMult *
            (1 - mitigation(enemyDef)) *
            random(state, "player", 0.95, 1.05),
        ),
      )
      state.enemy.hp = Math.max(0, state.enemy.hp - damage)
      emit(state, {
        type: "damage",
        target: "enemy",
        amount: damage,
        element: support.element,
        isWeak: elMult >= 1.2,
        combo: state.combo,
        source: support.name,
        enemyHpAfter: state.enemy.hp,
      })
      log(state, `【支援】${support.name} 命中 ${damage.toLocaleString("en-US")}（Combo ${state.combo}）`)
      noteWeaknessHit(state, support.element)
      if (state.enemy.hp <= 0) {
        state.phase = "won"
        emit(state, { type: "won" })
        return
      }
    }
  }

  // 2. 抢攻判定（§10.2：带 swift 迅捷标签，且未中冻结/迟缓）
  const teamFrozen = state.teamStatuses.some((s) => s.id === "freeze")
  if (!teamFrozen) {
    for (let idx = 0; idx < state.cards.length; idx += 1) {
      const card = state.cards[idx]!
      if (card.down || !hasSwift(card)) continue
      if (card.statuses.some((s) => s.id === "slow" || s.id === "stun")) continue
      // 游侠/刺客/破法者抢攻率（默认 12% 让战中能稳定体验到抢攻垫刀，文档基础 4%+迅捷专精）
      if (roll(state, "player") > PREEMPTIVE_RATE) continue

      checkEnemyWakeUp(state)
      state.combo += 1
      state.maxCombo = Math.max(state.maxCombo, state.combo)
      const damage = Math.max(
        1,
        Math.round(
          statOf(state, card, "atk") *
            0.7 *
            comboMultiplier(state.combo) *
            elementMultiplier("physical", state.enemy.element, state.enemy.traits, activeWeaknesses(state.enemy)) *
            (1 - mitigation(enemyDefence(state, false))) *
            random(state, "player", 0.95, 1.05),
        ),
      )
      state.enemy.hp = Math.max(0, state.enemy.hp - damage)
      emit(state, {
        type: "cutin",
        actor: "preemptive",
        cardIndex: idx,
        title: card.name,
        subtitle: "发动迅捷抢攻！（0 AP · 0.7×）",
        element: "physical",
      })
      emit(state, {
        type: "damage",
        target: "enemy",
        amount: damage,
        cardIndex: idx,
        element: "physical",
        combo: state.combo,
        source: `${card.name}·抢攻`,
        enemyHpAfter: state.enemy.hp,
      })
      log(state, `⚡【抢攻】${card.name} 先手突袭 ${damage.toLocaleString("en-US")}（Combo ${state.combo}）`)
      noteWeaknessHit(state, "physical")
      if (state.enemy.hp <= 0) {
        state.phase = "won"
        emit(state, { type: "won" })
        return
      }
    }
  }
}

function executeEnemyIntent(state: BattleState, intent: EnemyIntent) {
  if (intent.interrupted) {
    log(state, `敌方行动【${intent.label}】已被打断取消！`)
    return
  }

  // 敌方魅惑（50% 概率打错目标自残 §11.1）
  if (state.enemy.statuses.some((s) => s.id === "charm") && roll(state, "enemy") < 0.5) {
    const selfDmg = Math.round(state.enemy.atk * 1.2)
    state.enemy.hp = Math.max(1, state.enemy.hp - selfDmg)
    emit(state, {
      type: "damage",
      target: "enemy",
      amount: selfDmg,
      element: intent.element,
      source: "魅惑自残",
      enemyHpAfter: state.enemy.hp,
    })
    log(state, `💞 ${state.enemy.name} 受【魅惑】影响攻击失误，对自己造成 ${selfDmg.toLocaleString("en-US")} 伤害！`)
    return
  }

  if (intent.kind === "buff") {
    state.enemy.buff = Math.min(0.6, state.enemy.buff + 0.2)
    log(state, `敌方施放【${intent.label}】，攻击力提升！`)
    return
  }

  if (intent.kind === "add_support") {
    if (state.enemySupports.length < MAX_SUPPORT_SLOTS) {
      state.enemySupports.push({
        id: `enemy-add-${state.turn}-${state.enemySupports.length}`,
        name: "魔物援军",
        kind: "attack",
        element: intent.element,
        atk: Math.round(state.enemy.atk * 0.75),
        power: 0.5,
        hits: 1,
        procRate: 0.6,
        roleText: "敌方增援 · 协同攻击",
      })
      log(state, `敌方发动【${intent.label}】，左侧支援栏新增【魔物援军】！`)
    }
    return
  }

  if (intent.kind === "break_support") {
    // 削减/无力化玩家支援（§12 第 8 条：一次性拆毁 ≥2 个非锁定支援）
    let removed = 0
    let shielded = 0
    let targeted = 0
    const shield = Math.min(0.9, teamEffectSum(state.cards, "supportShield"))
    for (let i = state.playerSupports.length - 1; i >= 0 && targeted < 2; i -= 1) {
      const sup = state.playerSupports[i]!
      if (sup.locked || sup.kind === "defense") continue
      targeted += 1
      if (shield > 0 && roll(state, "enemy") < shield) {
        shielded += 1
        continue
      }
      state.playerSupports.splice(i, 1)
      removed += 1
    }
    log(
      state,
      removed > 0
        ? `💥 敌方发动【${intent.label}】，摧毁了我方右侧 ${removed} 个非锁定侧面支援！${shielded > 0 ? `（${shielded} 个被守护光环挡下）` : ""}`
        : shielded > 0
          ? `🛡️ 敌方发动【${intent.label}】，但守护光环挡下了所有拆毁！`
          : `🛡️ 敌方发动【${intent.label}】，但我方没有可被拆毁的侧面支援！`,
    )
    return
  }

  if (intent.kind === "debuff" && intent.power === 0) {
    const sid = intent.statusId ?? "weaken"
    addOrStackStatus(state.teamStatuses, {
      id: sid,
      name: sid === "fear" ? "恐惧" : sid === "armor_break" ? "破防" : "衰弱",
      stat: sid === "armor_break" ? "def" : "atk",
      amount: -0.2,
      turns: 2,
      isDebuff: true,
    })
    log(state, `敌方施放【${intent.label}】，我方全队陷入负面状态！`)
    return
  }

  const living = aliveCards(state.cards)
  if (living.length === 0) return

  // 选定受击目标：嘲讽者优先；带 Down 威胁的技能按 §6.8 优先落在坦克身上
  const taunter = living.find((c) => c.taunt)
  const tanks = living.filter((c) => c.job === "tank")
  const primaryTarget =
    taunter ??
    (intent.causesDown && tanks.length > 0
      ? pickOne(state, "enemy", tanks)
      : pickOne(state, "enemy", living))
  const targetSlotIdx = state.cards.indexOf(primaryTarget)

  const magic = intent.element !== "physical"
  const enemyWeaken = state.enemy.statuses.some((s) => s.id === "weaken") ? -0.2 : 0
  const enemyEnrage = state.enemy.statuses.some((s) => s.id === "enrage") ? 0.4 : 0
  const chargeUnit = state.enemySupports.find((s) => s.kind === "charge")
  const chargeBoost = (chargeUnit?.stacks ?? 0) * 0.18

  const rawEnemyAtk =
    (magic ? state.enemy.int : state.enemy.atk) *
    Math.max(0.3, 1 + state.enemy.buff + enemyWeaken + enemyEnrage + chargeBoost)

  const targetDef = statOf(state, primaryTarget, magic ? "int" : "def")
  const defTier = effectivePlayerDefenseTier(state)
  const tankPresent = hasTankAlive(state.cards)
  const tierRed = defenseReductionOf(defTier, tankPresent)

  emit(state, {
    type: "cutin",
    actor: "enemy",
    title: state.enemy.name,
    subtitle: `施放「${intent.label}」！`,
    element: intent.element,
  })
  emit(state, {
    type: "laser",
    targetSlots: [targetSlotIdx],
    guardedSlot: taunter ? targetSlotIdx : undefined,
  })

  let total = 0
  const hits = Math.max(1, intent.hits)
  const partyThornsSupport = state.playerSupports.find((s) => s.kind === "thorns" && !s.bannedTurns)
  const cardHasThorns = primaryTarget.statuses.some((s) => s.id === "thorns")
  let reflectedTimes = 0

  for (let i = 0; i < hits; i += 1) {
    const damage = Math.max(
      1,
      Math.round(
        rawEnemyAtk *
          intent.power *
          (1 - mitigation(targetDef)) *
          (1 - tierRed) *
          random(state, "enemy", 0.95, 1.05),
      ),
    )
    total += damage
    state.teamHp = Math.max(0, state.teamHp - damage)

    // 每一段单独结算并立刻发出事件：血条与数字按段推进，不再合成一个总数
    emit(state, {
      type: "damage",
      target: "party",
      amount: damage,
      cardIndex: targetSlotIdx,
      element: intent.element,
      source: intent.label,
      hpAfter: state.teamHp,
    })

    // 我方【荆棘】反伤（单卡荆棘或右侧支援栏荆棘藤阵 §11.1）
    if ((cardHasThorns || partyThornsSupport) && reflectedTimes < 3 && state.enemy.hp > 0) {
      reflectedTimes += 1
      const refInt = statOf(state, primaryTarget, "int")
      const reflectDmg = Math.max(
        50,
        Math.round(refInt * 0.45 * (1 - mitigation(state.enemy.int))),
      )
      state.enemy.hp = Math.max(0, state.enemy.hp - reflectDmg)
      emit(state, {
        type: "damage",
        target: "enemy",
        amount: reflectDmg,
        element: "wood",
        source: "荆棘反伤",
        enemyHpAfter: state.enemy.hp,
      })
      log(state, `🌿【荆棘】反击敌方 ${reflectDmg.toLocaleString("en-US")} 魔法伤害！`)
    }

    if (state.teamHp <= 0) break
  }

  log(
    state,
    `${state.enemy.name}「${intent.label}」命中 ${primaryTarget.name}，队伍承受 ${total.toLocaleString("en-US")} 伤害${tierRed > 0 ? `（防御减免 ${Math.round(tierRed * 100)}%）` : ""}`,
  )

  if (intent.statusId) {
    addOrStackStatus(state.teamStatuses, {
      id: intent.statusId,
      name: intent.statusId === "burn" ? "燃烧" : intent.statusId === "armor_break" ? "破防" : "负面",
      amount: 0.03,
      turns: 3,
      stacks: 1,
      isDebuff: true,
    })
  }

  // 高额攻击附带 Down 判定（§7.3 & §6.8：坦克开高档防御时可抵御 Down）
  if (intent.causesDown && state.teamHp > 0 && !primaryTarget.down) {
    const resistChance =
      primaryTarget.job === "tank" ? 0.45 + defTier * 0.15 : defTier * 0.12
    if (roll(state, "enemy") > resistChance) {
      primaryTarget.down = true
      primaryTarget.downTurns = 3
      primaryTarget.taunt = false
      state.downCount += 1
      emit(state, {
        type: "down",
        cardIndex: targetSlotIdx,
        cardName: primaryTarget.name,
      })
      log(
        state,
        `💀 【${primaryTarget.name}】被「${intent.label}」击倒（DOWN）！（3 回合后自动苏醒，或用治疗抬人/左翼更换替补）`,
      )
    } else {
      log(state, `🛡️ 【${primaryTarget.name}】凭借坚韧防御扛住了「${intent.label}」的击倒威胁！`)
    }
  }

  if (intent.isChargedUltimate && chargeUnit) {
    chargeUnit.stacks = 0
    chargeUnit.roleText = `蓄力已释放 (0/${chargeUnit.maxStacks ?? 3})`
  }
}

export function endTurn(state: BattleState): string | null {
  if (state.phase !== "player") return "战斗已经结束"

  beginAction(state)
  emit(state, { type: "turn", owner: "enemy", round: state.turn })
  state.combo = 0

  // 1. 敌方 Round 结算
  if (state.enemy.hardControl) {
    const label = state.enemy.hardControl === "sleep" ? "眠咒催眠" : "粉碎击晕"
    state.enemy.hardControl = null
    log(state, `💤 ${state.enemy.name} 处于【${label}】状态，本回合全部行动被作废！`)
  } else {
    for (const intent of state.enemy.intents) {
      if (state.teamHp <= 0 || state.enemy.hp <= 0) break
      executeEnemyIntent(state, intent)
    }

    // 敌方左侧攻击型侧面支援追击
    for (const esup of state.enemySupports) {
      if (state.teamHp <= 0 || state.enemy.hp <= 0) break
      if (esup.kind === "attack" && roll(state, "enemy") <= (esup.procRate ?? 0.5)) {
        const living = aliveCards(state.cards)
        if (living.length === 0) break
        const target = pickOne(state, "enemy", living)
        const defTier = effectivePlayerDefenseTier(state)
        const tierRed = defenseReductionOf(defTier, hasTankAlive(state.cards))
        const dmg = Math.max(
          1,
          Math.round(
            (esup.atk ?? 450) *
              (esup.power ?? 0.5) *
              (1 - mitigation(statOf(state, target, "def"))) *
              (1 - tierRed),
          ),
        )
        state.teamHp = Math.max(0, state.teamHp - dmg)
        emit(state, {
          type: "damage",
          target: "party",
          amount: dmg,
          cardIndex: state.cards.indexOf(target),
          element: esup.element,
          source: esup.name,
          hpAfter: state.teamHp,
        })
        log(state, `敌方支援【${esup.name}】追击造成 ${dmg.toLocaleString("en-US")} 伤害`)
      } else if (esup.kind === "charge") {
        const maxS = esup.maxStacks ?? 3
        esup.stacks = Math.min(maxS, (esup.stacks ?? 0) + 1)
        esup.roleText = `蓄力层数 (${esup.stacks}/${maxS}) · 可打断`
      }
    }
  }

  // 2. 清空本回合临时防御指令与右侧临时防御支援格（§6.7 防御仅持续本回合）
  state.defenseTier = 0
  syncDefenseSupportSlot(state)

  // 3. 结算敌方 DOT（燃烧 3% maxHp / 中毒 3% curHp / 流血 1%*stacks maxHp / 诅咒到期 15% curHp，§11.1 DOT不吃任何修正）
  for (const status of state.enemy.statuses) {
    if (state.enemy.hp <= 0) break
    let dot = 0
    if (status.id === "burn") dot = Math.round(state.enemy.hpMax * 0.03)
    else if (status.id === "poison") dot = Math.round(state.enemy.hp * 0.03)
    else if (status.id === "bleed") dot = Math.round(state.enemy.hpMax * 0.01 * (status.stacks ?? 1))
    else if (status.id === "curse" && status.turns === 1) dot = Math.round(state.enemy.hp * 0.15)

    if (dot > 0) {
      state.enemy.hp = Math.max(0, state.enemy.hp - dot)
      emit(state, {
        type: "damage",
        target: "enemy",
        amount: dot,
        element: "wood",
        source: status.name,
        enemyHpAfter: state.enemy.hp,
      })
      log(state, `敌方受到【${status.name}】${dot.toLocaleString("en-US")} 持续伤害`)
    }
    status.turns -= 1
  }
  state.enemy.statuses = state.enemy.statuses.filter((s) => s.turns > 0)

  if (state.enemy.hp <= 0) {
    state.phase = "won"
    emit(state, { type: "won" })
    log(state, `讨伐成功！击败了 ${state.enemy.name}！`)
    return null
  }

  // 4. 结算我方队伍 DOT 与生术师每回合回复
  for (const status of state.teamStatuses) {
    if (status.id === "burn" || status.id === "poison" || status.id === "bleed") {
      const loss = Math.round(state.teamHpMax * 0.03 * (status.stacks ?? 1))
      state.teamHp = Math.max(0, state.teamHp - loss)
      emit(state, {
        type: "damage",
        target: "party",
        amount: loss,
        element: "dark",
        source: status.name,
        hpAfter: state.teamHp,
      })
      log(state, `队伍受到【${status.name}】${loss.toLocaleString("en-US")} 持续伤害`)
    }
    status.turns -= 1
  }
  state.teamStatuses = state.teamStatuses.filter((s) => s.turns > 0)

  if (state.teamHp <= 0 || aliveCards(state.cards).length === 0) {
    state.phase = "lost"
    emit(state, { type: "lost" })
    log(state, "队伍全灭，讨伐失败")
    return null
  }

  const regenPct = teamEffectSum(state.cards, "regenPct")
  if (regenPct > 0) {
    healParty(state, Math.round(state.teamHpMax * regenPct), "生生不息")
  }

  // 5. 推进到下一回合（Round + 1）
  state.turn += 1
  state.interruptUsedThisTurn = false
  state.hasActedThisTurn = false
  state.swapCooldown = Math.max(0, state.swapCooldown - 1)

  // AP 恢复（§6.2：基础 +2，舞者在场 +1，恐惧 -1，空转 AP=0 额外 +1）
  const dancerBonus = Math.min(1, teamEffectSum(state.cards, "apRegenBonus"))
  const fearPenalty = state.teamStatuses.some((s) => s.id === "fear") ? -1 : 0
  const idleBonus = state.ap === 0 ? 1 : 0
  const apGain = Math.max(1, 2 + dancerBonus + fearPenalty + idleBonus)
  state.ap = Math.min(state.apMax, state.ap + apGain)

  // 卡片状态推进、疲惫记录交接、MP 回复（§2.6 被沉默不回蓝）、Down 3回合自动清醒（§7.3）
  for (const card of state.cards) {
    card.acted = false
    card.taunt = false
    card.lastTurnSkills = [...card.thisTurnSkills]
    card.thisTurnSkills = []

    if (card.down) {
      card.downTurns = Math.max(0, card.downTurns - 1)
      if (card.downTurns === 0) {
        card.down = false
        emit(state, {
          type: "revive",
          cardIndex: state.cards.indexOf(card),
          cardName: card.name,
        })
        log(state, `✨ 【${card.name}】从 DOWN 状态中恢复清醒！`)
      }
      continue
    }

    for (const st of card.statuses) st.turns -= 1
    card.statuses = card.statuses.filter((st) => st.turns > 0)
  }

  // 生成敌方新一轮意图预告
  refreshEnemyIntents(state)
  state.enemy.buff = Math.max(0, state.enemy.buff - 0.05)

  // 掷本回合 Boost / 必杀 / 连击
  rollCardTriggers(state)

  // 执行我方回合初：侧面支援自动行动 → 迅捷抢攻
  emit(state, { type: "turn", owner: "player", round: state.turn })
  emit(state, { type: "ap", value: state.ap })
  log(state, `—— Round ${state.turn} 开始（AP +${apGain} → ${state.ap}/${state.apMax}）——`)
  runPlayerTurnStartSequence(state)

  return null
}

export function cloneBattle(state: BattleState): BattleState {
  return structuredClone(state)
}

export function teamHpOf(state: BattleState): { hp: number; max: number } {
  return { hp: state.teamHp, max: state.teamHpMax }
}
