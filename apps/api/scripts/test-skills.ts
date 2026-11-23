// pnpm test:skills —— 技能效果测试。
// 每个被动 / 效果字段：带了生效、没带不生效、卡被 Down 失效。
import { EXECUTE_LOW_HP_RATIO } from "@choke/shared/battle/config"
import { withAction, type BattleAction } from "@choke/shared/battle/actions"
import { resolveEncounter } from "@choke/shared/battle/content"
import { createBattle, effectiveApCost, statOf } from "@choke/shared/battle/engine"
import { comboMultiplier } from "@choke/shared/battle/rules"
import type { BattleState } from "@choke/shared/battle/types"
import { autoDescribeSkill, checkSkill, checkSkillTable, describeSkill } from "@choke/shared/skill-check"
import { SKILLS, requireSkill, rollSkillRefs, seededRandom } from "@choke/shared/skills"
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
function start(job: Job, skillIds: string[], seed = "skills-1", encounter = spec): BattleState {
  const cards = inputs([face("under-test", job, "L", 40, 0, skillIds), face("filler", "tank", "L", 40, 0, ["bulwark_quake"])], 10)
  return createBattle(encounter, cards, { seed })
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
  const problems = checkSkillTable()
  check("技能表校验：字段组合、id、名字都合法", problems.length === 0, problems.slice(0, 5).join(" / "))
  const bad = checkSkill({ ...SKILLS.warden_hold!, kind: "damage" })
  check("技能校验：能抓出 kind 与字段不符", bad.length > 0)
  check("技能校验：能抓出多余字段", checkSkill({ ...SKILLS.warden_hold!, mystery: 1 }).length > 0)
  check("技能校验：缺少必填字段会报错", checkSkill({ ...SKILLS.berserker_cleave!, hits: undefined }).length > 0)
  check("自动描述：每个技能都能生成非空文案", all.every((s) => autoDescribeSkill(s).length > 0))
  check("describeSkill：没有手写文案时用自动生成", describeSkill({ ...SKILLS.berserker_cleave!, desc: undefined }) === autoDescribeSkill(SKILLS.berserker_cleave!))
  check("技能名没有旧 demo 名字", !all.some((s) => /六色破坏光线|毗沙门天剑|哈尼军团|专拐激昂曲|全军军师阵/.test(s.name)))
  if (process.argv.includes("--descs")) {
    for (const s of all) console.log(`  ${s.id}\n    手写：${s.desc ?? "（无）"}\n    自动：${autoDescribeSkill(s)}`)
  }
  const handwritten = all.filter((s) => s.desc).map((s) => s.id)
  console.log(`  ℹ 带手写文案的技能 ${handwritten.length}/${all.length} 个（加 --descs 可逐个对照复查）`)
}

// ---------- 0b. 发牌：每张卡各掷各的，主动 / 被动配比 ----------
{
  const N = 20000
  const jobs: Job[] = ["tank", "warrior", "mage", "support"]
  const random = seededRandom("deal-test")
  const tally = (rarity: "C" | "E" | "L") => {
    const t = { two: 0, one: 0, zero: 0, badSlots: 0, dup: 0 }
    for (let i = 0; i < N; i += 1) {
      const defs = rollSkillRefs(jobs[i % 4]!, rarity, random).map((ref) => requireSkill(ref.skillId))
      const actives = defs.filter((d) => !d.passive).length
      if (defs.length !== 2) t.badSlots += 1
      if (new Set(defs.map((d) => d.id)).size !== defs.length) t.dup += 1
      if (defs.some((d) => d.job !== jobs[i % 4])) t.badSlots += 1
      if (actives === 2) t.two += 1
      else if (actives === 1) t.one += 1
      else t.zero += 1
    }
    return t
  }
  const near = (n: number, pct: number) => Math.abs(n / N - pct) < 0.02
  const common = tally("C")
  check("发牌：C 到 E 两个槽，没有重复技能，都属于本大职业", common.badSlots === 0 && common.dup === 0)
  check("发牌：C 到 E 约 60% 为 2/0，30% 为 1/1，10% 为 0/2", near(common.two, 0.6) && near(common.one, 0.3) && near(common.zero, 0.1), JSON.stringify(common))
  const legend = tally("L")
  check("发牌：L 两个槽，没有重复技能，都属于本大职业", legend.badSlots === 0 && legend.dup === 0)
  check("发牌：L 约 55% 为 2/0，35% 为 1/1，10% 为 0/2", near(legend.two, 0.55) && near(legend.one, 0.35) && near(legend.zero, 0.1), JSON.stringify(legend))
  const sameCard = new Set(Array.from({ length: 40 }, () => rollSkillRefs("mage", "R", random).map((r) => r.skillId).join()))
  check("发牌：同名卡每张各掷各的，不会全是同一套技能", sameCard.size > 5, `只有 ${sameCard.size} 种`)
  const seeded = (seed: string) => rollSkillRefs("warrior", "E", seededRandom(seed)).map((r) => r.skillId).join()
  check("发牌：同一个种子重放得到同一套（测试 / 预览可复现）", seeded("x") === seeded("x"))
  const three = rollSkillRefs("warrior", "Mythic", random).map((ref) => requireSkill(ref.skillId))
  check("发牌：Mythic 三个槽，2 主动 + 1 被动（暂定）", three.length === 3 && three.filter((d) => d.passive).length === 1)
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
  check("生生不息：多回约 1.5% 最大生命", Math.abs(withIt - without - s0.teamHpMax * 0.015) <= 2)
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

// ---------- 7b. 治疗预算 ----------
{
  const make = (encounter: typeof spec) => {
    const cards = inputs(
      [
        face("big", "tank", "L", 80, 6, ["bulwark_quake"]),
        face("healer-a", "support", "L", 40, 0, ["healer_heal"]),
        face("healer-b", "support", "L", 40, 0, ["healer_heal"]),
      ],
      10,
    )
    const s = createBattle(encounter, cards, { seed: "budget-1" })
    s.teamHp = 1
    return s
  }
  const heal = (s: BattleState, card: number) => apply(s, { type: "skill", card, skill: "healer_heal" })

  const normal = make(spec)
  check("治疗预算：默认是最大生命的一半", spec.healBudget === 0.5 && normal.healLeft === Math.round(normal.teamHpMax * 0.5))
  const oneHeal = heal(make(spec), 1)
  const onePct = (oneHeal.teamHp - 1) / oneHeal.teamHpMax
  check("治疗预算：1 AP 治疗约 6%–10% 最大生命（15% 才算大恢复）", onePct > 0.06 && onePct < 0.1, `${(onePct * 100).toFixed(1)}%`)
  check("治疗预算：治疗后预算按实际回血扣除", oneHeal.healLeft === normal.healLeft! - (oneHeal.teamHp - 1))

  const tight = make({ ...spec, healBudget: 0.05 })
  const cap = tight.healLeft!
  const first = heal(tight, 1)
  check("治疗预算：一次治疗最多回到预算上限", first.teamHp - 1 === cap && first.healLeft === 0, `${first.teamHp - 1} / ${cap}`)
  const hpBefore = first.teamHp
  const second = heal(first, 2)
  check("治疗预算：预算用完后不能再靠治疗回血", second.teamHp === hpBefore)
  check("治疗预算：用完时日志有提示", second.log.some((line) => line.includes("治疗预算已用尽")))

  const endless = make({ ...spec, healBudget: "unlimited" })
  check("治疗预算：unlimited 时不限（永动机 BOSS）", endless.healLeft === null)
  const e1 = heal(endless, 1)
  const e2 = heal(e1, 2)
  check("治疗预算：不限时可以一直回", e2.teamHp > e1.teamHp && e2.healLeft === null)
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
  check("激昂乐章：点亮 2 张队友的 BOOST", boosted === 2, `${boosted}`)
}
{
  const s = start("tank", ["bulwark_taunt"])
  const after = apply(s, { type: "skill", card: 0, skill: "bulwark_taunt" })
  check("嘲讽咆哮：自己获得荆棘", after.cards[0]!.statuses.some((st) => st.id === "thorns" && st.amount === 0.4))
}

// ---------- 9b. 概率与吸血类被动（按种子统计；自身攻击类被动被 Down 后卡不能行动，不用测） ----------
const SEEDS = 600
const seedsOf = (tag: string) => Array.from({ length: SEEDS }, (_, i) => `${tag}-${i}`)
const logHas = (state: BattleState, text: string) => state.log.some((line) => line.includes(text))
{
  // 血怒狂躯：吸血 20%
  const healed = (ids: string[]) => {
    const s = start("warrior", ids, "steal-1")
    s.teamHp = Math.round(s.teamHpMax * 0.5)
    s.ap = 6
    const before = s.teamHp
    return apply(s, { type: "skill", card: 0, skill: "berserker_cleave" }).teamHp - before
  }
  const withIt = healed(["berserker_cleave", "berserker_blood"])
  const without = healed(["berserker_cleave"])
  check("血怒狂躯：带了造成伤害后回血", withIt > without, `${withIt} vs ${without}`)
  check("血怒狂躯：没带不回血", without <= 0, `${without}`)
}
{
  // 魔力暴走：队伍低血时法术暴击 +10
  const crits = (ids: string[], low: boolean) => {
    let n = 0
    for (const seed of seedsOf("spell")) {
      const s = start("mage", ids, seed)
      if (low) s.teamHp = Math.round(s.teamHpMax * 0.2)
      s.enemy.hp = s.enemy.hpMax = 1e9
      n += logHas(apply(s, { type: "skill", card: 0, skill: "warlock_frost" }), "暴击") ? 1 : 0
    }
    return n
  }
  const lowWith = crits(["warlock_frost", "warlock_lowhp"], true)
  const lowWithout = crits(["warlock_frost"], true)
  check("魔力暴走：低血时法术暴击更多", lowWith > lowWithout + 20, `${lowWith} vs ${lowWithout}`)
  check("魔力暴走：血量正常时不加暴击", crits(["warlock_frost", "warlock_lowhp"], false) === crits(["warlock_frost"], false))
}
{
  // 鹰眼迅捷：对脆弱目标暴击 +15（对照卡带的是不含暴击的另一个迅捷，命中一致）
  const crits = (swiftId: string, vulnerable: boolean) => {
    let n = 0
    for (const seed of seedsOf("eagle")) {
      // 迅捷会在开局抢攻，tutorial-ghost 血太少会被抢攻直接打死，所以换 ghost
      const s = start("warrior", ["berserker_cleave", swiftId], seed, resolveEncounter(BATTLE_CONTENT, "ghost")!)
      s.ap = 6
      s.enemy.hp = s.enemy.hpMax = 1e9
      if (vulnerable) s.enemy.statuses.push({ id: "vulnerable", name: "脆弱", amount: 0.2, turns: 3, isDebuff: true })
      n += logHas(apply(s, { type: "skill", card: 0, skill: "berserker_cleave" }), "暴击") ? 1 : 0
    }
    return n
  }
  const withIt = crits("ranger_swift", true)
  const without = crits("breaker_swift", true)
  check("鹰眼迅捷：目标脆弱时暴击更多", withIt > without + 30, `${withIt} vs ${without}`)
  check("鹰眼迅捷：目标不脆弱时不加暴击", crits("ranger_swift", false) === crits("breaker_swift", false))
}
{
  // 精神专注：硬控成功率 +15%
  const successes = (ids: string[]) => {
    let n = 0
    for (const seed of seedsOf("focus")) {
      const s = start("mage", ids, seed)
      s.ap = 6
      n += apply(s, { type: "skill", card: 0, skill: "binder_sleep" }).enemy.hardControl ? 1 : 0
    }
    return n
  }
  const withIt = successes(["binder_sleep", "binder_focus"])
  const without = successes(["binder_sleep"])
  check("精神专注：带了硬控成功更多", withIt > without + 30, `${withIt}/${SEEDS} vs ${without}/${SEEDS}`)
}
{
  // 召唤共鸣：攻击型支援发动率 +15%（全队被动，携带者被 Down 失效）
  const procs = (ids: string[], downIt: boolean) => {
    let n = 0
    for (const seed of seedsOf("proc")) {
      const s = start("mage", ids, seed)
      if (downIt) {
        s.cards[0]!.down = true
        s.cards[0]!.downTurns = 3
      }
      s.playerSupports.push({ id: "sup-t", name: "测试使魔", kind: "attack", element: "physical", power: 0.5, hits: 1, atk: 100, roleText: "测试" })
      const next = apply(s, { type: "endTurn" })
      n += next.playerSupports.find((x) => x.id === "sup-t")?.triggered ? 1 : 0
    }
    return n
  }
  const withIt = procs(["summoner_aura"], false)
  const without = procs(["warlock_frost"], false)
  check("召唤共鸣：带了支援更常发动", withIt > without + 30, `${withIt} vs ${without}`)
  const downed = procs(["summoner_aura"], true)
  check("召唤共鸣：被 Down 失效", Math.abs(downed - without) < 40, `${downed} vs ${without}`)
}
{
  // 守护光环：敌方拆支援时每个目标 30% 概率免拆
  const left = (ids: string[], downIt: boolean) => {
    let n = 0
    for (const seed of seedsOf("shield")) {
      const s = start("warrior", ids, seed)
      if (downIt) {
        s.cards[0]!.down = true
        s.cards[0]!.downTurns = 3
      }
      for (const id of ["sup-a", "sup-b"]) {
        s.playerSupports.push({ id, name: id, kind: "aura", element: "light", stat: "def", amount: 0.1, roleText: "测试" })
      }
      s.enemy.intents = [{ id: "brk", kind: "break_support", label: "拆除", element: "physical", power: 0, hits: 1, desc: "" }]
      n += apply(s, { type: "endTurn" }).playerSupports.filter((x) => x.id.startsWith("sup-")).length
    }
    return n / SEEDS
  }
  const withIt = left(["paladin_aura"], false)
  const without = left(["paladin_smite"], false)
  check("守护光环：没带时 2 个支援全被拆", without === 0, `${without}`)
  check("守护光环：带了平均每次保住约 0.6 个", Math.abs(withIt - 0.6) < 0.12, `${withIt}`)
  check("守护光环：被 Down 失效", left(["paladin_aura"], true) === 0)
}

// ---------- 9b2. 支援强度 ----------
{
  const aura = (id: string, tier?: number) => ({ id, name: id, kind: "aura" as const, element: "light" as const, stat: "def" as const, amount: 0.1, tier, roleText: "测试" })
  const breakWith = (breakTier: number) => {
    const def = SKILLS.breaker_break!
    const old = def.breakTier
    def.breakTier = breakTier
    try {
      const s = start("warrior", ["breaker_break"], "tier-1")
      s.enemy.hp = s.enemy.hpMax = 1e9
      s.ap = 6
      s.enemySupports = [aura("t1"), aura("t2", 2), aura("t3", 3)]
      return apply(s, { type: "skill", card: 0, skill: "breaker_break" }).enemySupports.map((x) => x.id).join(",")
    } finally {
      def.breakTier = old
    }
  }
  check("支援强度：拆除强度 1 只拆得动强度 1", breakWith(1) === "t2,t3", breakWith(1))
  check("支援强度：拆除强度 2 拆得动强度 2", breakWith(2) === "t1,t3", breakWith(2))
  check("支援强度：拆除强度 3 拆得动强度 3", breakWith(3) === "t1,t2", breakWith(3))

  const enemyBreak = (breakTier?: number) => {
    const s = start("warrior", ["paladin_smite"], "tier-2")
    s.playerSupports = [aura("p1"), aura("p2", 2)]
    s.enemy.intents = [{ id: "brk", kind: "break_support", label: "拆除", element: "physical", power: 0, hits: 1, desc: "", breakTier }]
    return apply(s, { type: "endTurn" }).playerSupports.filter((x) => x.id.startsWith("p")).map((x) => x.id).join(",")
  }
  check("支援强度：敌方拆除默认强度 1，拆不动我方强度 2", enemyBreak() === "p2", enemyBreak())
  check("支援强度：敌方拆除强度 2 能拆强度 2", enemyBreak(2) === "", enemyBreak(2))

  const summon = (initialTiers: number[]) => {
    const def = SKILLS.summoner_call!
    const s = start(def.job, ["summoner_call"], "tier-3")
    s.playerSupports = initialTiers.map((t, i) => aura(`q${i}`, t))
    s.ap = 6
    return apply(s, { type: "skill", card: 0, skill: "summoner_call" }).playerSupports.map((x) => x.id).join(",")
  }
  const replaced = summon([2, 1, 1, 1, 1, 1, 1]).split(",")
  check("支援强度：满格时替换强度最低的支援，不动强度高的", replaced.length === 7 && replaced.includes("q0") && !replaced.includes("q1") && replaced.some((x) => x.startsWith("sup-")), replaced.join(","))
  check("支援强度：满格且全是更高强度时不替换", !summon([2, 2, 2, 2, 2, 2, 2]).includes("sup-"), summon([2, 2, 2, 2, 2, 2, 2]))

  check("支援强度：重装甲和守护圣印是强度 2", SKILLS.warden_armor!.supportDef!.tier === 2 && SKILLS.paladin_protect!.supportDef!.tier === 2)
  check("支援强度：敌方终曲蓄力是强度 2", BATTLE_CONTENT.supports["enemy-sup-conductor-charge"]!.tier === 2)
  check("支援强度：不再有 locked 字段", !JSON.stringify(SKILLS).includes('"locked"') && !JSON.stringify(BATTLE_CONTENT.supports).includes('"locked"'))
  check("支援强度：拆支援技能都写了 breakTier", Object.values(SKILLS).filter((k) => k.clearEnemySupports).every((k) => k.breakTier !== undefined))
  check("支援强度校验：写了 clearEnemySupports 不写 breakTier 会报错", checkSkill({ ...SKILLS.breaker_break!, breakTier: undefined }).length > 0)
  check("支援强度校验：breakTier 超出 1–3 会报错", checkSkill({ ...SKILLS.breaker_break!, breakTier: 4 }).length > 0)
  check("支援强度校验：没有拆除却写 breakTier 会报错", checkSkill({ ...SKILLS.warlock_frost!, breakTier: 1 }).length > 0)
  check("支援强度校验：支援强度超出 1–3 会报错", checkSkill({ ...SKILLS.warden_armor!, supportDef: { ...SKILLS.warden_armor!.supportDef!, tier: 4 } }).length > 0)
  check("支援强度：自动描述写出强度", autoDescribeSkill(SKILLS.warden_armor!).includes("强度 2") && autoDescribeSkill(SKILLS.breaker_break!).includes("≤1"))
}

// ---------- 9c. 疲惫：所有主动技能通用 ----------
{
  const ghost = resolveEncounter(BATTLE_CONTENT, "ghost")!
  const costOf = (s: BattleState, id: string) => effectiveApCost(s, s.cards[0]!, s.cards[0]!.skills.find((k) => k.id === id)!)
  const bigEnemy = (s: BattleState) => {
    s.enemy.hp = s.enemy.hpMax = 1e9
    s.ap = s.apMax
    return s
  }
  const tagless = Object.values(SKILLS).filter((k) => !k.passive && k.costTag !== "accumulate" && k.costTag !== "once")
  check("技能上不再有 fatigue 标签", !Object.values(SKILLS).some((k) => (k.costTag as string) === "fatigue"))
  for (const id of ["berserker_zero", "healer_heal", "bard_inspire", "warden_bash", "ranger_zero", "assassin_zero"]) {
    const def = SKILLS[id]!
    const base = def.ap
    let s = bigEnemy(start(def.job, [id], "fatigue-1", ghost))
    const first = costOf(s, id)
    s = apply(s, { type: "skill", card: 0, skill: id })
    s = bigEnemy(apply(s, { type: "endTurn" }))
    const second = costOf(s, id)
    s = bigEnemy(apply(s, { type: "endTurn" }))
    const third = costOf(s, id)
    check(`疲惫：${def.name} 首次 ${base} AP，连用下一回合 +1，隔一回合恢复`, first === base && second === base + 1 && third === base, `${first}/${second}/${third}`)
  }
  check("疲惫：0 费攻击（盾击平推、牵制速射、瞬影刺）都在上面的循环里变成 0、1 交替", ["warden_bash", "ranger_zero", "assassin_zero"].every((id) => SKILLS[id]!.ap === 0))
  check("疲惫：覆盖到所有主动技能", tagless.length > 30, `${tagless.length}`)
}

// ---------- 9d. Combo 曲线 ----------
{
  const expected = [1, 1, 1, 1.03, 1.08, 1.14, 1.22, 1.3, 1.4, 1.5]
  check("Combo 曲线：每一层的倍率与设计一致", expected.every((v, i) => comboMultiplier(i) === v), expected.map((_, i) => comboMultiplier(i)).join(","))
  check("Combo 曲线：9 层及以上封顶 1.50", comboMultiplier(9) === 1.5 && comboMultiplier(30) === 1.5)
  check("Combo 曲线：负数按 0 层算", comboMultiplier(-3) === 1)
  check("Combo 曲线：单调不降且凸", expected.every((v, i) => i < 4 || expected[i]! - expected[i - 1]! >= expected[i - 1]! - expected[i - 2]! - 1e-9))
}

// ---------- 9e. 斩杀条件 ----------
{
  const ghost = resolveEncounter(BATTLE_CONTENT, "ghost")!
  const VULN = { id: "vulnerable", name: "脆弱", amount: 0.3, turns: 2, isDebuff: true } as const
  const WEAK = { id: "weaken", name: "衰弱", stat: "atk", amount: -0.2, turns: 2, isDebuff: true } as const
  type Setup = (s: BattleState) => void
  const dealt = (job: Job, id: string, setup?: Setup) => {
    const s = start(job, [id], "execute-1", ghost)
    s.enemy.hp = s.enemy.hpMax = 1e9
    s.ap = 6
    setup?.(s)
    const before = s.enemy.hp
    const next = apply(s, { type: "skill", card: 0, skill: id })
    return before - next.enemy.hp
  }
  const lowHp: Setup = (s) => { s.enemy.hp = Math.round(s.enemy.hpMax * (EXECUTE_LOW_HP_RATIO - 0.05)) }
  const justAbove: Setup = (s) => { s.enemy.hp = Math.round(s.enemy.hpMax * (EXECUTE_LOW_HP_RATIO + 0.05)) }
  const vuln: Setup = (s) => { s.enemy.statuses.push({ ...VULN }) }
  const weak: Setup = (s) => { s.enemy.statuses.push({ ...WEAK }) }

  // 裂空断头台：只看低血
  const wind = SKILLS.berserker_wind!
  const windBase = dealt("warrior", "berserker_wind")
  check("斩杀：裂空断头台只声明低血条件", wind.executeWhen?.join() === "lowHp")
  const windLow = dealt("warrior", "berserker_wind", lowHp)
  check("斩杀：裂空断头台血量低于 40% 时加成", Math.abs(windLow / windBase - (1 + wind.executeBonus!)) < 0.01, `${windLow}/${windBase}`)
  check("斩杀：裂空断头台血量刚高于 40% 不加成", dealt("warrior", "berserker_wind", justAbove) === windBase)
  check("斩杀：裂空断头台对脆弱不触发斩杀（只吃通用脆弱易伤）", Math.abs(dealt("warrior", "berserker_wind", vuln) / windBase - 1.3) < 0.01)

  // 虚弱收割：只看脆弱
  const harvest = SKILLS.ranger_harvest!
  const harvestBase = dealt("warrior", "ranger_harvest")
  check("斩杀：虚弱收割只声明脆弱条件", harvest.executeWhen?.join() === "vulnerable")
  check("斩杀：虚弱收割对其他负面状态不再触发", dealt("warrior", "ranger_harvest", weak) === harvestBase)
  check("斩杀：虚弱收割对低血不触发", dealt("warrior", "ranger_harvest", lowHp) === harvestBase)
  const harvestVuln = dealt("warrior", "ranger_harvest", vuln)
  check("斩杀：虚弱收割对脆弱目标触发（比单纯脆弱易伤 ×1.3 高得多）", harvestVuln / harvestBase > 1.3 * 1.2, `${harvestVuln}/${harvestBase}`)

  // 暗杀奥义：脆弱或低血任一
  const exec = SKILLS.assassin_execute!
  const execBase = dealt("warrior", "assassin_execute")
  check("斩杀：暗杀奥义声明脆弱与低血", exec.executeWhen?.slice().sort().join() === "lowHp,vulnerable")
  const execLow = dealt("warrior", "assassin_execute", lowHp)
  check("斩杀：暗杀奥义低血触发", Math.abs(execLow / execBase - (1 + exec.executeBonus!)) < 0.01, `${execLow}/${execBase}`)
  check("斩杀：暗杀奥义对脆弱触发", dealt("warrior", "assassin_execute", vuln) > execBase * 1.3 * 1.01)
  check("斩杀：暗杀奥义对其他负面状态不触发", dealt("warrior", "assassin_execute", weak) === execBase)

  // 校验
  check("斩杀校验：写 executeBonus 不写条件会报错", checkSkill({ ...SKILLS.berserker_wind!, executeWhen: undefined }).length > 0)
  check("斩杀校验：写条件不写加成会报错", checkSkill({ ...SKILLS.berserker_wind!, executeBonus: undefined }).length > 0)
  check("斩杀校验：未知条件会报错", checkSkill({ ...SKILLS.berserker_wind!, executeWhen: ["anything"] }).length > 0)
  check("斩杀描述：自动文案写出具体条件", autoDescribeSkill(SKILLS.assassin_execute!).includes("脆弱") && autoDescribeSkill(SKILLS.assassin_execute!).includes("血量低于 40%") && !autoDescribeSkill(SKILLS.ranger_harvest!).includes("血量低于"))
}

// ---------- 9f. 支援 combo 字段 ----------
{
  const ghost = resolveEncounter(BATTLE_CONTENT, "ghost")!
  const maxComboWith = (combo: number | undefined, hits: number, seed: string) => {
    const s = start("mage", ["warlock_frost"], seed, ghost)
    s.enemy.hp = s.enemy.hpMax = 1e9
    s.playerSupports.push({ id: "sup-c", name: "测试支援", kind: "attack", element: "physical", power: 0.5, hits, combo, procRate: 0.95, atk: 100, roleText: "测试" })
    const next = apply(s, { type: "endTurn" })
    return next.playerSupports.find((x) => x.id === "sup-c")?.triggered ? next.maxCombo : null
  }
  const firstHit = (combo: number | undefined, hits: number) => {
    for (const seed of seedsOf("support-combo")) {
      const v = maxComboWith(combo, hits, seed)
      if (v !== null) return v
    }
    return null
  }
  check("支援 combo：没写默认 0，命中不加 Combo", firstHit(undefined, 2) === 0)
  check("支援 combo：写 0 命中不加 Combo", firstHit(0, 2) === 0)
  check("支援 combo：写 1，2 段命中加 2 层", firstHit(1, 2) === 2)
  check("支援 combo：写 2，2 段命中加 4 层", firstHit(2, 2) === 4)
  const summons = ["breaker_counter", "summoner_call", "summoner_poison"].map((id) => SKILLS[id]!.supportDef!)
  check("支援 combo：现有使魔、突击队、破法剑卫都显式写 combo: 1", summons.every((d) => d.combo === 1))
  const s = start("mage", ["summoner_call"], "summon-combo", ghost)
  s.ap = 6
  const summoned = apply(s, { type: "skill", card: 0, skill: "summoner_call" })
  check("支援 combo：召唤出的支援带上 combo 字段", summoned.playerSupports.some((x) => x.combo === 1))
  check("支援 combo：校验拒绝负数与过大的值", checkSkill({ ...SKILLS.summoner_call!, supportDef: { ...SKILLS.summoner_call!.supportDef!, combo: -1 } }).length > 0 && checkSkill({ ...SKILLS.summoner_call!, supportDef: { ...SKILLS.summoner_call!.supportDef!, combo: 9 } }).length > 0)
}

// ---------- 9g. 状态几率 ----------
{
  const rate = (id: string, enemyId: string, statusId: string) => {
    const spec2 = resolveEncounter(BATTLE_CONTENT, enemyId)!
    let hit = 0
    let resisted = 0
    for (const seed of seedsOf(`chance-${id}`)) {
      const s = start(SKILLS[id]!.job, [id], seed, spec2)
      s.enemy.hp = s.enemy.hpMax = 1e9
      s.ap = 6
      const next = apply(s, { type: "skill", card: 0, skill: id })
      if (next.enemy.statuses.some((x) => x.id === statusId)) hit += 1
      if (next.log.some((l) => l.includes("被敌方抵抗"))) resisted += 1
    }
    return { hit: hit / SEEDS, resisted: resisted / SEEDS }
  }
  const near = (value: number, target: number) => Math.abs(value - target) < 0.07
  const frost = rate("warlock_frost", "ghost", "freeze")
  check("状态几率：中等状态（冻结）对普通敌人约 65%", near(frost.hit, 0.65), `${frost.hit}`)
  check("状态几率：每次施放要么生效要么有“被抵抗”日志（二连发会两者兼有）", frost.hit + frost.resisted >= 1 - 1e-9 && frost.resisted > 0.25, `${frost.hit}+${frost.resisted}`)
  const frostElite = rate("warlock_frost", "vanguard", "freeze")
  check("状态几率：精英 ×0.8（约 52%）", near(frostElite.hit, 0.52), `${frostElite.hit}`)
  const frostBoss = rate("warlock_frost", "conductor", "freeze")
  check("状态几率：BOSS ×0.65（约 42%）", near(frostBoss.hit, 0.4225), `${frostBoss.hit}`)
  const charm = rate("binder_charm", "ghost", "charm")
  check("状态几率：强状态（魅惑）对普通敌人约 45%", near(charm.hit, 0.45), `${charm.hit}`)
  const bleed = rate("berserker_cleave", "ghost", "bleed")
  check("状态几率：弱状态（流血）对普通敌人约 80%", near(bleed.hit, 0.8), `${bleed.hit}`)
  const noChance = Object.values(SKILLS).filter((k) => k.statusId && k.kind !== "control" && k.statusChance === undefined)
  check("状态几率：除硬控外每个带状态的技能都写了几率", noChance.length === 0, noChance.map((k) => k.id).join(","))
  check("状态几率：硬控技能不写 statusChance", Object.values(SKILLS).filter((k) => k.kind === "control").every((k) => k.statusChance === undefined))
  check("状态几率校验：带状态不写几率会报错", checkSkill({ ...SKILLS.warlock_frost!, statusChance: undefined }).length > 0)
  check("状态几率校验：硬控写几率会报错", checkSkill({ ...SKILLS.warden_stun!, statusChance: 0.5 }).length > 0)
  check("状态几率校验：几率超过 1 会报错", checkSkill({ ...SKILLS.warlock_frost!, statusChance: 1.5 }).length > 0)
  check("状态几率：说明文案写出几率（手写与自动都有）", describeSkill(SKILLS.warlock_frost!).includes("65%") && autoDescribeSkill(SKILLS.warlock_frost!).includes("65%"))
}

// ---------- 9h. 打断 ----------
{
  const id = "assassin_interrupt"
  const job = SKILLS[id]!.job
  const run = (opts: { rarity: "C" | "R" | "L" | "Prismatic"; enemyId: string; hard: boolean[]; tag: string }) => {
    const enc = resolveEncounter(BATTLE_CONTENT, opts.enemyId)!
    let success = 0
    let pickedHard = 0
    let failedWithDamage = 0
    let failedComboKept = 0
    for (const seed of seedsOf(opts.tag)) {
      const cards = inputs([face("under-test", job, opts.rarity, 40, 0, [id]), face("filler", "tank", "L", 40, 0, ["bulwark_quake"])], 10)
      const s = createBattle(enc, cards, { seed })
      s.enemy.hp = s.enemy.hpMax = 1e9
      const base = s.enemy.intents[0]!
      s.enemy.intents = opts.hard.map((h, i) => ({ ...base, id: `t-${i}`, hardToInterrupt: h || undefined, interrupted: false }))
      s.ap = 6
      s.combo = 6
      const next = apply(s, { type: "skill", card: 0, skill: id })
      const ev = next.events.find((e) => e.type === "interrupt_roll")
      if (!ev || ev.type !== "interrupt_roll") continue
      const hitDamage = next.events.filter((e) => e.type === "damage" && e.target === "enemy").length === 1
      const single = next.events.filter((e) => e.type === "interrupt_roll").length === 1
      if (!ev.success && hitDamage && single) {
        failedWithDamage += 1
        if (next.combo === 7) failedComboKept += 1
      }
      if (ev.success) success += 1
      if (opts.hard[ev.targetIntentIndex]) pickedHard += 1
    }
    return { success: success / SEEDS, pickedHard: pickedHard / SEEDS, failedWithDamage, failedComboKept }
  }
  const near = (value: number, target: number) => Math.abs(value - target) < 0.07
  const r = run({ rarity: "R", enemyId: "ghost", hard: [false], tag: "int-r" })
  check("打断：普通敌人、R 卡成功率约 65%", near(r.success, 0.65), `${r.success}`)
  const c = run({ rarity: "C", enemyId: "ghost", hard: [false], tag: "int-c" })
  check("打断：C 卡 ×0.90（约 58.5%）", near(c.success, 0.585), `${c.success}`)
  const p = run({ rarity: "Prismatic", enemyId: "ghost", hard: [false], tag: "int-p" })
  check("打断：Prismatic ×1.20（约 78%）", near(p.success, 0.78), `${p.success}`)
  check("打断：稀有度越高成功率越高", c.success < r.success && r.success < p.success, `${c.success}<${r.success}<${p.success}`)
  const bossHard = run({ rarity: "R", enemyId: "conductor", hard: [true], tag: "int-bh" })
  check("打断：BOSS 的难以打断招式约 18%（45%×0.4）", near(bossHard.success, 0.18), `${bossHard.success}`)
  const lHard = run({ rarity: "L", enemyId: "ghost", hard: [true], tag: "int-lh" })
  check("打断：难以打断仍有机会成功，L 卡约 28.6%", lHard.success > 0.15 && near(lHard.success, 0.286), `${lHard.success}`)
  const mixed = run({ rarity: "R", enemyId: "ghost", hard: [false, true], tag: "int-mix" })
  check("打断：盲抽权重，难以打断的招式被抽中约 28.6%（0.4/1.4）", near(mixed.pickedHard, 0.4 / 1.4), `${mixed.pickedHard}`)
  check(
    "打断：判定失败时攻击照常打出伤害，Combo 不减半",
    lHard.failedWithDamage > 100 && lHard.failedComboKept === lHard.failedWithDamage,
    `${lHard.failedComboKept}/${lHard.failedWithDamage}`,
  )
}

// ---------- 9i. 硬控 ----------
{
  const rate = (id: string, enemyId: string, hard: boolean, tag: string) => {
    const enc = resolveEncounter(BATTLE_CONTENT, enemyId)!
    let ok = 0
    for (const seed of seedsOf(tag)) {
      const s = start(SKILLS[id]!.job, [id], seed, enc)
      s.enemy.hp = s.enemy.hpMax = 1e9
      const base = s.enemy.intents[0]!
      s.enemy.intents = [{ ...base, hardToInterrupt: hard || undefined, interrupted: false }]
      s.ap = 6
      if (apply(s, { type: "skill", card: 0, skill: id }).enemy.hardControl) ok += 1
    }
    return ok / SEEDS
  }
  const near = (value: number, target: number) => Math.abs(value - target) < 0.07
  const normal = rate("warden_stun", "ghost", false, "hc-n")
  check("硬控：普通敌人没有难以打断招式时约 80%", near(normal, 0.8), `${normal}`)
  const normalHard = rate("warden_stun", "ghost", true, "hc-nh")
  check("硬控：普通敌人有难以打断招式时约 32%（80%×0.4）", near(normalHard, 0.32), `${normalHard}`)
  const elite = rate("binder_sleep", "vanguard", false, "hc-e")
  check("硬控：精英约 65%", near(elite, 0.65), `${elite}`)
  const eliteHard = rate("binder_sleep", "vanguard", true, "hc-eh")
  check("硬控：精英有难以打断招式时约 26%", near(eliteHard, 0.26), `${eliteHard}`)
  const boss = rate("warden_stun", "conductor", false, "hc-b")
  check("硬控：BOSS 约 50%", near(boss, 0.5), `${boss}`)
  const bossHard = rate("warden_stun", "conductor", true, "hc-bh")
  check("硬控：BOSS 有难以打断招式时约 20%", near(bossHard, 0.2), `${bossHard}`)
  check("硬控：说明文案写出难以打断的修正", describeSkill(SKILLS.warden_stun!).includes("×0.4") && describeSkill(SKILLS.binder_sleep!).includes("×0.4"))
}

// ---------- 9j. 硬壳支援 ----------
{
  const ghost = resolveEncounter(BATTLE_CONTENT, "ghost")!
  const shell = (threshold: number) => ({
    id: "t-shell",
    name: "测试硬壳",
    kind: "shell" as const,
    element: "earth" as const,
    threshold,
    roleText: "硬壳",
  })
  const armor = { id: "t-armor", name: "测试装甲", kind: "armor" as const, element: "metal" as const, defenseTier: 1, roleText: "装甲" }
  const hitAmounts = (supports: (typeof ghost)["supports"], hidden: boolean) => {
    const enc = { ...ghost, enemy: { ...ghost.enemy, hiddenWeaknesses: hidden ? ["physical" as const] : [] }, supports }
    const s = start("warrior", ["berserker_zero"], "shell-1", enc)
    s.enemy.hp = s.enemy.hpMax = 1e9
    s.ap = 6
    const next = apply(s, { type: "skill", card: 0, skill: "berserker_zero" })
    return { amounts: next.events.filter((e) => e.type === "damage" && e.target === "enemy").map((e) => (e.type === "damage" ? e.amount : 0)), found: next.hiddenFound }
  }
  const none = hitAmounts([], false)
  const high = hitAmounts([shell(1e9)], false)
  const low = hitAmounts([shell(1)], false)
  check("硬壳：没有硬壳时伤害正常", none.amounts.length > 0 && none.amounts.every((a) => a > 100), none.amounts.join(","))
  check("硬壳：单段伤害低于门槛只算 100", high.amounts.length === none.amounts.length && high.amounts.every((a) => a === 100), high.amounts.join(","))
  check("硬壳：门槛很低时不影响伤害", low.amounts.join(",") === none.amounts.join(","))
  check("硬壳：伤害被压成 100 也记隐藏弱点", hitAmounts([shell(1e9)], true).found.includes("physical"))

  const breakWith = (supports: (typeof ghost)["supports"]) => {
    const s = start(SKILLS.breaker_break!.job, ["breaker_break"], "shell-2", { ...ghost, supports })
    s.enemy.hp = s.enemy.hpMax = 1e9
    s.ap = 6
    return apply(s, { type: "skill", card: 0, skill: "breaker_break" }).enemySupports.map((u) => u.id)
  }
  const afterBreak = breakWith([armor, shell(5000)])
  check("硬壳：拆支援拆得掉别的，拆不掉硬壳", afterBreak.length === 1 && afterBreak[0] === "t-shell", afterBreak.join(","))
  check("硬壳：只有硬壳时拆支援无效", breakWith([shell(5000)]).join(",") === "t-shell")

  const baseSupport = BATTLE_CONTENT.supports
  check("硬壳校验：内容里的硬壳都写了 threshold", Object.values(baseSupport).filter((u) => u.kind === "shell").every((u) => u.threshold !== undefined))
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
