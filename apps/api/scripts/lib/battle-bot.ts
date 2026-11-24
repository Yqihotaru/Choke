// 战斗测试公用：两套卡组、一队替补，和一个固定策略的机器人。
// test-battle.ts 和 test-weakness.ts 都用它；改这里的策略会让所有基准变化。
import { withAction, type BattleAction } from "@choke/shared/battle/actions"
import type { EncounterSpec } from "@choke/shared/battle/content"
import { createBattle, type BattleInputCard } from "@choke/shared/battle/engine"
import type { BattleState } from "@choke/shared/battle/types"
import { makeCard } from "@choke/shared/card-def"
import { cardSkillsFromRefs, type SkillDef } from "@choke/shared/skills"
import type { Job, Mod, Rarity } from "@choke/shared/types"

export const MAX_TURNS = 100

// 一套中等（打得过幽灵、打不过精英），一套满配（能打进终曲的蓄力阶段）
// 技能直接写 id，不走发牌算法：基准只跟引擎和技能数值有关

export function face(
  id: string,
  job: Job,
  rarity: Rarity,
  level: number,
  constellation: number,
  skillIds: string[],
  mods: Mod[] = [],
) {
  const skills = cardSkillsFromRefs(skillIds.map((skillId) => ({ skillId })))
  return makeCard({ id, name: id, rarity, job, level, constellation, mods, skills })
}
export function inputs(faces: ReturnType<typeof face>[], uidBase: number): BattleInputCard[] {
  return faces.map((f, i) => ({ uid: uidBase + i, cardId: f.id, face: f }))
}

export const DECKS: Record<string, BattleInputCard[]> = {
  normal: inputs(
    [
      face("t-tank", "tank", "R", 20, 1, ["bulwark_quake_mid", "bulwark_taunt_mid", "bulwark_thorns_mid"]),
      face("t-war", "warrior", "E", 25, 0, ["paladin_judgment_mid", "paladin_smite_mid", "paladin_aura_mid"], ["HR"]),
      face("t-mage", "mage", "L", 18, 2, ["binder_charm", "binder_bind", "binder_focus"], ["DT", "HD"]),
      face("t-sup", "support", "UC", 30, 3, ["healer_heal_low", "healer_cleanse_low", "healer_plus_low"]),
    ],
    100,
  ),
  mid: inputs(
    [
      face("m-tank", "tank", "R", 40, 3, ["warden_armor", "bulwark_taunt_mid", "bulwark_thorns_mid"]),
      face("m-war", "warrior", "E", 45, 2, ["breaker_rift_mid", "breaker_counter", "breaker_swift_mid"], ["HR"]),
      face("m-mage", "mage", "E", 45, 2, ["warlock_meteor", "warlock_frost_mid", "binder_focus_mid"], ["DT"]),
      face("m-sup", "support", "L", 30, 1, ["healer_heal", "healer_cleanse", "healer_plus"]),
    ],
    400,
  ),
  strong: inputs(
    [
      face("s-tank", "tank", "Mythic", 80, 6, ["warden_stun", "warden_bash", "warden_hold"], ["HR"]),
      face("s-war", "warrior", "L", 80, 6, ["breaker_rift", "breaker_counter", "breaker_swift"], ["DT"]),
      face("s-mage", "mage", "Prismatic", 80, 6, ["life_mass", "life_revive", "life_regen"], ["HD", "DT"]),
      face("s-sup", "support", "L", 80, 6, ["bard_anthem", "bard_inspire", "bard_aura"]),
    ],
    300,
  ),
}
export const BENCH = inputs(
  [
    face("b-war", "warrior", "R", 15, 0, ["berserker_zero_mid", "berserker_cleave_mid", "berserker_blood_mid"]),
    face("b-mage", "mage", "UC", 22, 1, ["warlock_meteor", "warlock_frost_low", "warlock_lowhp_low"]),
  ],
  200,
)

// 倒下的卡换替补；3 的倍数回合升 1 档防御；每张卡放第一个能放的技能；结束回合

// 测试用的 AP 上限：沿用引擎改造前的规则（队里有 Mythic / Prismatic / 本体卡为 10，否则 7），
// 这样老基准不变。真实游戏里 AP 上限来自远征点数分配，见 expedition-points。
export function testApMax(deck: BattleInputCard[]): number {
  return deck.some((c) => c.face.isHero || c.face.rarity === "Mythic" || c.face.rarity === "Prismatic") ? 10 : 7
}

export function playBot(
  encounter: EncounterSpec,
  deck: BattleInputCard[],
  seed: string,
  bench: BattleInputCard[] = BENCH,
  extra: {
    apMax?: number
    hpRatio?: number
    /** 每个成功的操作之后调用一次（只读统计用，不要改 state） */
    onAction?: (state: BattleState, action: BattleAction) => void
    /**
     * firstFit（默认，所有基准用它）：每张卡从左到右放第一个能放的主动技能。
     * burst（流派分析用）：按 AP 从高到低放；队里有 3 AP 以上的大招而当前 AP 不够时，本回合只放 0 AP 技能，把 AP 攒下来。
     * smart（流派分析用）：看意图防御/打断、按血线治疗、优先拆支援、不重复空放控制、先垫 0 AP Combo 再打弱点大招。
     */
    policy?: "firstFit" | "burst" | "smart"
  } = {},
) {
  let state = createBattle(encounter, deck, {
    seed,
    bench,
    apMax: extra.apMax ?? testApMax(deck),
    ...(extra.hpRatio === undefined ? {} : { hpRatio: extra.hpRatio }),
  })
  const actions: BattleAction[] = []
  const act = (action: BattleAction) => {
    const result = withAction(state, action)
    if (result.error) return false
    state = result.state
    actions.push(action)
    extra.onAction?.(state, action)
    return true
  }
  for (let guard = 0; guard < MAX_TURNS && state.phase === "player"; guard += 1) {
    state.cards.forEach((card, slot) => {
      if (!card.down) return
      const sub = state.bench.find((b) => !b.down)
      if (sub) act({ type: "swap", slot, benchUid: sub.uid })
    })
    if (extra.policy === "smart") {
      runSmartTurn(() => state, act)
    } else if (extra.policy === "burst") {
      if (state.turn % 3 === 0) act({ type: "defend" })
      const pairs = state.cards.flatMap((card, i) => (card.down ? [] : card.skills.filter((s) => !s.passive).map((s) => ({ i, s }))))
      pairs.sort((a, b) => b.s.ap - a.s.ap || a.i - b.i)
      const bigCosts = pairs.map((p) => p.s.ap).filter((ap) => ap >= 3)
      const hold = bigCosts.length > 0 && state.ap < Math.min(...bigCosts)
      const acted = new Set<number>()
      for (const { i, s } of pairs) {
        if (state.phase !== "player") break
        if (acted.has(i) || (hold && s.ap > 0)) continue
        if (act({ type: "skill", card: i, skill: s.id })) acted.add(i)
      }
    } else {
      if (state.turn % 3 === 0) act({ type: "defend" })
      for (let i = 0; i < state.cards.length && state.phase === "player"; i += 1) {
        for (const skill of state.cards[i]!.skills) {
          if (skill.passive) continue
          if (act({ type: "skill", card: i, skill: skill.id })) break
        }
      }
    }
    if (state.phase === "player") act({ type: "endTurn" })
  }
  return { state, actions }
}

function effectiveAp(card: BattleState["cards"][number], s: SkillDef): number {
  const fatigued = card.lastTurnSkills.includes(s.id) ? 1 : 0
  const acc = card.accumulatedUses[s.id] ?? 0
  return s.ap + fatigued + acc
}

function isUsableSkill(state: BattleState, card: BattleState["cards"][number], s: SkillDef): boolean {
  if (s.passive || card.acted || card.down) return false
  if (s.once && card.usedOnce.includes(s.id)) return false
  if (card.statuses.some((st) => st.id === "stun" || st.id === "sleep")) return false
  if (card.statuses.some((st) => st.id === "silence") && s.ap > 0) return false
  if (s.selfHpCostPct && state.teamHp / state.teamHpMax <= s.selfHpCostPct + 0.05) return false
  return state.ap >= effectiveAp(card, s)
}

function scoreSmartSkill(state: BattleState, card: BattleState["cards"][number], s: SkillDef, holdForBigSkill: boolean): number {
  const hpRatio = state.teamHp / state.teamHpMax
  const enemyHpRatio = state.enemy.hp / state.enemy.hpMax
  const cost = effectiveAp(card, s)
  const activeIntents = state.enemy.intents.filter((it) => !it.interrupted)
  const hasHeavyThreat = activeIntents.some(
    (it) => it.kind === "heavy_phys" || it.kind === "heavy_magic" || it.causesDown || it.power * it.hits >= 1.5,
  )
  const hasWeak =
    state.enemy.weaknesses.includes(s.element) ||
    state.enemy.hiddenWeaknesses.includes(s.element) ||
    state.enemy.exposed.includes(s.element)
  const isHardControl = s.kind === "control" && (s.statusId === "sleep" || s.statusId === "stun")

  // 若敌人已被硬控，绝不放任何会打醒敌人的伤害技能
  if (state.enemy.hardControl && (s.kind === "damage" || (s.power ?? 0) > 0)) return -1000

  // 若处于“攒大招”窗口（有 3+ AP 核心大招待放且血线安全），跳过 1-2 AP 的低收益辅助/小技能，只放 0 AP、救命治疗、打断和关键拆迁
  if (holdForBigSkill && cost > 0) {
    const emergencyHeal = s.kind === "heal" && hpRatio < 0.45
    const criticalBreak = (s.clearEnemySupports ?? 0) > 0 && state.enemySupports.some((sup) => sup.kind !== "shell" && (sup.tier ?? 1) <= (s.breakTier ?? 1))
    const criticalInterrupt = s.kind === "interrupt" && hasHeavyThreat && !state.interruptUsedThisTurn
    if (!emergencyHeal && !criticalBreak && !criticalInterrupt) return -1000
  }

  // 治疗：只在血线低于 70% 时释放；残血抢杀敌人时不奶
  if (s.kind === "heal") {
    if (hpRatio >= 0.7 || (enemyHpRatio < 0.18 && hpRatio > 0.35)) return -1000
    return hpRatio < 0.45 ? 140 : 65
  }

  // 打断：敌人有高威胁意图且本回合未尝试打断时优先
  if (s.kind === "interrupt") {
    if (!hasHeavyThreat || state.interruptUsedThisTurn) return -100
    return 135
  }

  // 拆支援：场上存在可拆除的非硬壳敌方支援时最高进攻优先（优先拆护甲/荆棘/蓄力）
  if ((s.clearEnemySupports ?? 0) > 0) {
    const breakTier = s.breakTier ?? 1
    const removable = state.enemySupports.filter((sup) => sup.kind !== "shell" && (sup.tier ?? 1) <= breakTier)
    if (removable.length > 0) {
      const highValue = removable.some((sup) => sup.kind === "armor" || sup.kind === "thorns" || sup.kind === "charge")
      return (highValue ? 145 : 125) + (hasWeak ? 10 : 0)
    }
  }

  // 控制 / 软控：已有相同状态或已硬控/警觉时不空放
  if (s.kind === "control") {
    if (state.enemy.hardControl) return -1000
    if (isHardControl) {
      const vigilant = state.enemy.statuses.some((st) => st.id === "vigilant")
      if (vigilant || (!hasHeavyThreat && hpRatio > 0.55)) return -1000
      return 110
    }
    if (s.statusId && state.enemy.statuses.some((st) => st.id === s.statusId)) return -1000
    return 35
  }

  // 0 AP 垫刀/功能技能：永远优先用来垫高 Combo，不抢大招 AP
  if (cost === 0 && (s.kind === "damage" || s.kind === "debuff" || (s.power ?? 0) > 0)) {
    return 118 + (hasWeak ? 12 : 0)
  }

  // 增益 / 召唤 / 嘲讽：Buff 先于大招释放
  if (s.kind === "buff") {
    if (s.stat && state.teamStatuses.some((st) => st.id === `buff_${s.stat}`)) return -1000
    return 112
  }
  if (s.kind === "summon") {
    return state.playerSupports.length < 6 ? 78 : -1000
  }
  if (s.kind === "taunt") {
    return !card.taunt && activeIntents.length > 0 && hpRatio < 0.7 ? 45 : -1000
  }

  // 伤害/减益输出：结合 trigger（必杀 3.0x / 连击 x2 / Boost 1.5x）、弱点、斩杀条件与倍率
  const rawPower = (s.power ?? 0.5) * (s.hits ?? 1)
  const triggerBonus =
    card.trigger === "critical_art" ? 45 : card.trigger === "double_cast" ? 30 : card.trigger === "boost" ? 20 : 0
  const execReady =
    s.executeBonus &&
    s.executeWhen?.some(
      (cond) =>
        (cond === "lowHp" && enemyHpRatio < 0.4) ||
        (cond === "vulnerable" && state.enemy.statuses.some((st) => st.id === "vulnerable")),
    )
      ? 25
      : 0

  let score = 45 + rawPower * 18 + triggerBonus + execReady
  if (hasWeak) score += 22
  if (s.ap >= 3) score += 18
  if (card.lastTurnSkills.includes(s.id)) score -= 10
  return score
}

function runSmartTurn(getState: () => BattleState, act: (action: BattleAction) => boolean) {
  const s0 = getState()
  const hpRatio = s0.teamHp / s0.teamHpMax
  const enemyHpRatio = s0.enemy.hp / s0.enemy.hpMax
  const activeIntents = s0.enemy.intents.filter((it) => !it.interrupted)
  const hasHeavyThreat = activeIntents.some(
    (it) => it.kind === "heavy_phys" || it.kind === "heavy_magic" || it.causesDown || it.power * it.hits >= 1.5,
  )

  // 仅在血线偏低或有高威胁大招、且敌方未残血时开防（避免无脑防御抢占爆发 AP）
  if (!s0.enemy.hardControl && enemyHpRatio > 0.2 && ((hasHeavyThreat && hpRatio < 0.72) || hpRatio < 0.42)) {
    const defendGoal = hasHeavyThreat && hpRatio < 0.35 ? 2 : 1
    for (let d = 0; d < defendGoal && getState().phase === "player"; d += 1) {
      if (!act({ type: "defend" })) break
    }
  }

  for (let step = 0; step < getState().cards.length + 2; step += 1) {
    const cur = getState()
    if (cur.phase !== "player") break

    // 判断场上“单发总倍率最高”的可用输出技能是否是 3+ AP 大招；
    // 只有主力输出是 3+ AP 大招、且 1 回合内能攒出来时才留 AP（绝不为替补低效 3-4 AP 技能卡死 1-2 AP 主力）
    let bestDmgPower = 0
    let bestDmgCost = 0
    for (const c of cur.cards) {
      if (c.down || c.acted) continue
      for (const s of c.skills) {
        if (s.passive || (s.kind !== "damage" && s.kind !== "debuff")) continue
        if (s.once && c.usedOnce.includes(s.id)) continue
        const p = (s.power ?? 0.5) * (s.hits ?? 1)
        const cAp = effectiveAp(c, s)
        if (p > bestDmgPower) {
          bestDmgPower = p
          bestDmgCost = cAp
        }
      }
    }
    const holdForBigSkill =
      bestDmgCost >= 3 &&
      cur.ap < bestDmgCost &&
      bestDmgCost - cur.ap <= 2 &&
      cur.teamHp / cur.teamHpMax > 0.45

    let best: { card: number; skill: string; score: number } | null = null
    for (let i = 0; i < cur.cards.length; i += 1) {
      const card = cur.cards[i]!
      for (const s of card.skills) {
        if (!isUsableSkill(cur, card, s)) continue
        const score = scoreSmartSkill(cur, card, s, holdForBigSkill)
        if (score <= 0) continue
        if (!best || score > best.score) best = { card: i, skill: s.id, score }
      }
    }
    if (!best) break
    if (!act({ type: "skill", card: best.card, skill: best.skill })) break
  }
}
