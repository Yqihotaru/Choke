// 流派探针队的积木：前排 + 输出包（2 张）+ 辅助，拼成 4 张卡的队伍。
// test-battle.ts 固定带 6 支搭好的队（PROBES）；probe-matrix.ts 把所有积木全排列。
// 新增玩法流派 = 在 DAMAGE 里加一个包；新增技能后想看它在各流派里表现 = 把它放进某张卡。
// 队伍统一为 L 品质、60 级、3 命座：比的是流派差别，不是卡的强度。
import type { BattleInputCard } from "@choke/shared/battle/engine"

import { face, inputs } from "./battle-bot"

type Face = ReturnType<typeof face>

const LEVEL = 60
const CONSTELLATION = 3
const card = (id: string, job: Parameters<typeof face>[1], skills: string[]): Face =>
  face(`p-${id}`, job, "L", LEVEL, CONSTELLATION, skills)

export const FRONT: Record<string, Face> = {
  taunt: card("taunt", "tank", ["bulwark_taunt", "bulwark_thorns"]),
  spike: card("spike", "tank", ["warden_spike", "warden_hold"]),
  bash: card("bash", "tank", ["warden_bash", "warden_double"]),
}

export const DAMAGE: Record<string, [Face, Face]> = {
  blade: [card("blade-a", "warrior", ["ranger_volley", "berserker_blood"]), card("blade-b", "warrior", ["berserker_zero", "assassin_zero"])],
  arcane: [card("arcane-a", "mage", ["warlock_starfire", "warlock_overclock"]), card("arcane-b", "mage", ["warlock_collapse", "warlock_lowhp"])],
  dot: [card("dot-a", "warrior", ["assassin_backstab", "berserker_blood"]), card("dot-b", "mage", ["life_mass", "warlock_collapse"])],
  swift: [card("swift-a", "warrior", ["breaker_rift", "breaker_swift"]), card("swift-b", "warrior", ["ranger_volley", "ranger_swift"])],
  combo: [card("combo-a", "warrior", ["ranger_zero", "ranger_volley"]), card("combo-b", "mage", ["warlock_cadence", "warlock_overclock"])],
  control: [card("control-a", "mage", ["binder_charm", "binder_focus"]), card("control-b", "mage", ["warlock_starfire", "binder_bind"])],
  holy: [card("holy-a", "warrior", ["paladin_judgment", "paladin_aura"]), card("holy-b", "mage", ["life_renew", "life_regen"])],
}

export const SUPPORT: Record<string, Face> = {
  heal: card("heal", "support", ["healer_heal", "healer_plus"]),
  buff: card("buff", "support", ["bard_ward", "bard_aura"]),
  crescendo: card("crescendo", "support", ["bard_crescendo", "bard_tempo"]),
}

export interface TeamSpec {
  front: string
  damage: string
  support: string
}

/** 每次测试固定带上的 6 支流派队 */
export const PROBES: Record<string, TeamSpec> = {
  blade: { front: "bash", damage: "blade", support: "buff" },
  arcane: { front: "taunt", damage: "arcane", support: "buff" },
  dot: { front: "spike", damage: "dot", support: "heal" },
  swift: { front: "bash", damage: "swift", support: "buff" },
  combo: { front: "bash", damage: "combo", support: "crescendo" },
  sustain: { front: "taunt", damage: "holy", support: "heal" },
}

export const PROBE_LABEL: Record<string, string> = {
  blade: "平刀",
  arcane: "法爆",
  dot: "持续伤害",
  swift: "迅捷",
  combo: "连击",
  control: "控制",
  holy: "圣光",
  sustain: "续航反伤",
}

export function buildTeam(spec: TeamSpec, uidBase: number): BattleInputCard[] {
  const [a, b] = DAMAGE[spec.damage]!
  return inputs([FRONT[spec.front]!, a, b, SUPPORT[spec.support]!], uidBase)
}

export const PROBE_DECKS: Record<string, BattleInputCard[]> = Object.fromEntries(
  Object.entries(PROBES).map(([name, spec], i) => [name, buildTeam(spec, 1000 + i * 10)]),
)
