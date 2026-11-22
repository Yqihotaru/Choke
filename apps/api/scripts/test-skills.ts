// pnpm test:skills —— 技能效果测试。
// 每个被动 / 效果字段：带了生效、没带不生效、卡被 Down 失效。
import { withAction, type BattleAction } from "@choke/shared/battle/actions"
import { resolveEncounter } from "@choke/shared/battle/content"
import { createBattle, statOf } from "@choke/shared/battle/engine"
import type { BattleState } from "@choke/shared/battle/types"
import { SKILLS } from "@choke/shared/skills"
import type { Job } from "@choke/shared/types"

import { BATTLE_CONTENT } from "../src/content"
import { face, inputs } from "./lib/battle-bot"

const spec = resolveEncounter(BATTLE_CONTENT, "tutorial-ghost")!
const failures: string[] = []
let count = 0
function check(name: string, ok: boolean, detail = "") {
  count += 1
  if (!ok) failures.push(`${name}${detail ? `：${detail}` : ""}`)
  console.log(`${ok ? "✔" : "✘"} ${name}${!ok && detail ? ` → ${detail}` : ""}`)
}

/** 一张被测卡 + 一张不带技能的陪衬卡（保证队里始终有人） */
function start(job: Job, skillIds: string[], seed = "skills-1"): BattleState {
  const cards = inputs([face("under-test", job, "L", 40, 0, skillIds), face("filler", "tank", "L", 40, 0, ["bulwark_quake"])], 10)
  return createBattle(spec, cards, { seed })
}
const apply = (state: BattleState, action: BattleAction) => {
  const result = withAction(state, action)
  if (result.error) throw new Error(`操作不合法：${result.error}`)
  return result.state
}
const lowHp = (state: BattleState) => {
  state.teamHp = Math.round(state.teamHpMax * 0.2)
  return state
}
const down = (state: BattleState) => {
  state.cards[0]!.down = true
  state.cards[0]!.downTurns = 3
  return state
}

// ---------- 0. 数据 ----------
{
  const all = Object.values(SKILLS)
  check("每个技能都有大职业", all.every((s) => s.job))
  const effectKeys = [
    "openingStatus", "defMul", "lowHpMul", "lifesteal", "spellCrit", "swift", "critVsVulnerable", "regenPct",
    "controlBonus", "supportProcBonus", "apRegenBonus", "healBonus", "triggerBonus", "supportShield",
  ] as const
  const bare = all.filter((s) => s.passive && !effectKeys.some((k) => s[k] !== undefined))
  check("每个被动都声明了效果字段", bare.length === 0, bare.map((s) => s.id).join(","))
}

// ---------- 1. 开局荆棘 ----------
{
  const withIt = start("tank", ["bulwark_thorns"]).cards[0]!
  const without = start("tank", ["bulwark_quake"]).cards[0]!
  check("荆棘重甲：带了开局有荆棘", withIt.statuses.some((s) => s.id === "thorns" && s.amount === 0.35))
  check("荆棘重甲：没带没有荆棘", !without.statuses.some((s) => s.id === "thorns"))
}

// ---------- 2. 不动如山 ----------
{
  const base = statOf(start("tank", ["bulwark_quake"]), start("tank", ["bulwark_quake"]).cards[0]!, "def")
  const s = start("tank", ["warden_hold"])
  const withIt = statOf(s, s.cards[0]!, "def")
  check("不动如山：带了 DEF ×1.1", Math.abs(withIt / base - 1.1) < 0.02, `${withIt}/${base}`)
  const d = down(start("tank", ["warden_hold"]))
  check("不动如山：被 Down 失效", statOf(d, d.cards[0]!, "def") === base)
}

// ---------- 3. 残血加成 ----------
for (const [id, job, stat] of [
  ["berserker_blood", "warrior", "atk"],
  ["warlock_lowhp", "mage", "int"],
] as const) {
  const plain = lowHp(start(job, [job === "warrior" ? "berserker_cleave" : "warlock_frost"]))
  const base = statOf(plain, plain.cards[0]!, stat)
  const s = lowHp(start(job, [id]))
  check(`${id}：队伍低血时 ×1.25`, Math.abs(statOf(s, s.cards[0]!, stat) / base - 1.25) < 0.02)
  const healthy = start(job, [id])
  const healthyBase = start(job, [job === "warrior" ? "berserker_cleave" : "warlock_frost"])
  check(`${id}：血量正常不加成`, statOf(healthy, healthy.cards[0]!, stat) === statOf(healthyBase, healthyBase.cards[0]!, stat))
  const d = down(lowHp(start(job, [id])))
  check(`${id}：被 Down 失效`, statOf(d, d.cards[0]!, stat) === base)
}

// ---------- 4. 迅捷 ----------
for (const [id, job] of [
  ["breaker_swift", "warrior"],
  ["ranger_swift", "warrior"],
  ["assassin_swift", "warrior"],
] as const) {
  const withIt = start(job, [id]).cards[0]!.stats.hit
  const without = start(job, ["berserker_cleave"]).cards[0]!.stats.hit
  check(`${id}：带了命中 +5`, withIt === without + 5)
}

// ---------- 5. 每回合 AP 恢复 ----------
{
  const nextAp = (s: BattleState) => apply(s, { type: "endTurn" }).ap
  const withIt = nextAp(start("support", ["dancer_grace"]))
  const without = nextAp(start("support", ["healer_heal"]))
  const downed = nextAp(down(start("support", ["dancer_grace"])))
  check("舞者增幅：带了每回合 AP 多 1", withIt === without + 1, `${withIt} vs ${without}`)
  check("舞者增幅：被 Down 失效", downed === without, `${downed} vs ${without}`)
}

// ---------- 6. 每回合回血 ----------
{
  const hpAfter = (s: BattleState) => apply(lowHp(s), { type: "endTurn" }).teamHp
  const withIt = hpAfter(start("mage", ["life_regen"]))
  const without = hpAfter(start("mage", ["warlock_frost"]))
  const s0 = start("mage", ["life_regen"])
  check("生生不息：带了每回合多回血", withIt > without, `${withIt} vs ${without}`)
  check("生生不息：多回约 4% 最大生命", Math.abs(withIt - without - s0.teamHpMax * 0.04) <= 2)
  check("生生不息：被 Down 失效", hpAfter(down(start("mage", ["life_regen"]))) === without)
}

// ---------- 7. 治疗量 ----------
{
  const run = (ids: string[], downIt: boolean) => {
    const cards = inputs(
      [
        face("under-test", "support", "L", 40, 0, ids),
        face("healer", "support", "L", 40, 0, ["healer_heal"]),
        face("big1", "tank", "L", 80, 6, ["bulwark_quake"]),
        face("big2", "tank", "L", 80, 6, ["bulwark_quake"]),
      ],
      10,
    )
    const s = createBattle(spec, cards, { seed: "heal-1" })
    s.teamHp = 1
    if (downIt) s.cards[0]!.down = true
    const before = s.teamHp
    return apply(s, { type: "skill", card: 1, skill: "healer_heal" }).teamHp - before
  }
  const plain = run(["bard_inspire"], false)
  const boosted = run(["healer_plus"], false)
  check("医者仁心：带了治疗量 +20%", Math.abs(boosted / plain - 1.2) < 0.03, `${boosted}/${plain}`)
  check("医者仁心：被 Down 失效", run(["healer_plus"], true) === plain)
}

// ---------- 8. 触发概率 ----------
{
  const triggers = (ids: string[], downIt: boolean) => {
    let n = 0
    for (let i = 0; i < 400; i += 1) {
      const s = start("support", ids, `trig-${i}`)
      if (downIt) s.cards[0]!.down = true
      n += s.cards[1]!.trigger ? 1 : 0
    }
    return n
  }
  const without = triggers(["healer_heal"], false)
  const withIt = triggers(["bard_aura"], false)
  check("余音绕梁：带了触发更多", withIt > without + 20, `${withIt} vs ${without}`)
  const downed = (() => {
    let n = 0
    for (let i = 0; i < 400; i += 1) {
      const s = start("support", ["bard_aura"], `trig-${i}`)
      s.cards[0]!.down = true; s.cards[0]!.downTurns = 3
      // 被 Down 后再掷一次触发（与回合开始同一套逻辑）：用下一回合开始来触发
      const next = apply(s, { type: "endTurn" })
      n += next.cards[1]!.trigger ? 1 : 0
    }
    return n
  })()
  const downedControl = (() => {
    let n = 0
    for (let i = 0; i < 400; i += 1) {
      const s = start("support", ["healer_heal"], `trig-${i}`)
      s.cards[0]!.down = true; s.cards[0]!.downTurns = 3
      const next = apply(s, { type: "endTurn" })
      n += next.cards[1]!.trigger ? 1 : 0
    }
    return n
  })()
  check("余音绕梁：被 Down 失效", Math.abs(downed - downedControl) < 25, `${downed} vs ${downedControl}`)
}

// ---------- 9. 主动技能的效果字段 ----------
{
  const s = start("support", ["dancer_step"])
  check("无偿之舞：第 1 回合锁定", withAction(s, { type: "skill", card: 0, skill: "dancer_step" }).error !== null)
  s.turn = 4
  check("无偿之舞：第 4 回合解锁", withAction(s, { type: "skill", card: 0, skill: "dancer_step" }).error === null)
}
{
  const s = start("support", ["healer_cleanse"])
  s.teamStatuses.push({ id: "weaken", name: "衰弱", stat: "atk", amount: -0.2, turns: 2, isDebuff: true })
  const after = apply(s, { type: "skill", card: 0, skill: "healer_cleanse" })
  check("净化之泉：清掉队伍负面状态", !after.teamStatuses.some((st) => st.isDebuff))
}
{
  const s = start("support", ["healer_revive"])
  s.cards[1]!.down = true
  const after = apply(s, { type: "skill", card: 0, skill: "healer_revive" })
  check("奇迹抬人：救醒倒下的队友", !after.cards[1]!.down)
}
{
  const cards = inputs(
    [
      face("bard", "support", "L", 40, 0, ["bard_ward"]),
      face("a", "tank", "L", 40, 0, ["bulwark_quake"]),
      face("b", "tank", "L", 40, 0, ["bulwark_quake"]),
      face("c", "tank", "L", 40, 0, ["bulwark_quake"]),
    ],
    10,
  )
  const s = createBattle(spec, cards, { seed: "boost-1" })
  for (const c of s.cards) c.trigger = null
  const after = apply(s, { type: "skill", card: 0, skill: "bard_ward" })
  const boosted = after.cards.filter((c, i) => i > 0 && c.trigger === "boost").length
  check("专拐激昂曲：点亮 2 张队友的 BOOST", boosted === 2, `${boosted}`)
}
{
  const s = start("tank", ["bulwark_taunt"])
  const after = apply(s, { type: "skill", card: 0, skill: "bulwark_taunt" })
  check("嘲讽咆哮：自己获得荆棘", after.cards[0]!.statuses.some((st) => st.id === "thorns" && st.amount === 0.4))
}

// ---------- 10. 坦克只看大职业 ----------
{
  const tankDeck = start("tank", ["bulwark_quake"])
  const warriorDeck = createBattle(spec, inputs([face("w", "warrior", "L", 40, 0, ["paladin_smite"])], 10), { seed: "t" })
  check("四维权重：坦克 DEF 高于战士", tankDeck.cards[0]!.stats.def > warriorDeck.cards[0]!.stats.def)
}

console.log(`\n${count} 项检查，未通过 ${failures.length}`)
if (failures.length > 0) {
  console.log(failures.map((f) => `  - ${f}`).join("\n"))
  process.exit(1)
}
