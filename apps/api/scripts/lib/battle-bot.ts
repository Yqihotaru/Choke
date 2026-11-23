// 战斗测试公用：两套卡组、一队替补，和一个固定策略的机器人。
// test-battle.ts 和 test-weakness.ts 都用它；改这里的策略会让所有基准变化。
import { withAction, type BattleAction } from "@choke/shared/battle/actions"
import type { EncounterSpec } from "@choke/shared/battle/content"
import { createBattle, type BattleInputCard } from "@choke/shared/battle/engine"
import { makeCard } from "@choke/shared/card-def"
import { cardSkillsFromRefs } from "@choke/shared/skills"
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
      face("t-tank", "tank", "R", 20, 1, ["bulwark_quake", "bulwark_taunt", "bulwark_thorns"]),
      face("t-war", "warrior", "E", 25, 0, ["paladin_judgment", "paladin_smite", "paladin_aura"], ["HR"]),
      face("t-mage", "mage", "L", 18, 2, ["binder_charm", "binder_bind", "binder_focus"], ["DT", "HD"]),
      face("t-sup", "support", "UC", 30, 3, ["healer_heal", "healer_cleanse", "healer_plus"]),
    ],
    100,
  ),
  mid: inputs(
    [
      face("m-tank", "tank", "R", 40, 3, ["warden_armor", "bulwark_taunt", "bulwark_thorns"]),
      face("m-war", "warrior", "E", 45, 2, ["breaker_rift", "breaker_counter", "breaker_swift"], ["HR"]),
      face("m-mage", "mage", "E", 45, 2, ["warlock_meteor", "warlock_frost", "binder_focus"], ["DT"]),
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
    face("b-war", "warrior", "R", 15, 0, ["berserker_zero", "berserker_cleave", "berserker_blood"]),
    face("b-mage", "mage", "UC", 22, 1, ["warlock_meteor", "warlock_frost", "warlock_lowhp"]),
  ],
  200,
)

// 倒下的卡换替补；3 的倍数回合升 1 档防御；每张卡放第一个能放的技能；结束回合

// 测试用的 AP 上限：沿用引擎改造前的规则（队里有 Mythic / Prismatic / 本体卡为 10，否则 7），
// 这样老基准不变。真实游戏里 AP 上限来自远征点数分配，见 expedition-points。
export function testApMax(deck: BattleInputCard[]): number {
  return deck.some((c) => c.face.isHero || c.face.rarity === "Mythic" || c.face.rarity === "Prismatic") ? 10 : 7
}

export function playBot(encounter: EncounterSpec, deck: BattleInputCard[], seed: string, bench: BattleInputCard[] = BENCH) {
  let state = createBattle(encounter, deck, { seed, bench, apMax: testApMax(deck) })
  const actions: BattleAction[] = []
  const act = (action: BattleAction) => {
    const result = withAction(state, action)
    if (result.error) return false
    state = result.state
    actions.push(action)
    return true
  }
  for (let guard = 0; guard < MAX_TURNS && state.phase === "player"; guard += 1) {
    state.cards.forEach((card, slot) => {
      if (!card.down) return
      const sub = state.bench.find((b) => !b.down)
      if (sub) act({ type: "swap", slot, benchUid: sub.uid })
    })
    if (state.turn % 3 === 0) act({ type: "defend" })
    for (let i = 0; i < state.cards.length && state.phase === "player"; i += 1) {
      for (const skill of state.cards[i]!.skills) {
        if (skill.passive) continue
        if (act({ type: "skill", card: i, skill: skill.id })) break
      }
    }
    if (state.phase === "player") act({ type: "endTurn" })
  }
  return { state, actions }
}
