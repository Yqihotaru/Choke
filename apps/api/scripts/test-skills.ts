// pnpm test:skills —— 技能效果测试。
// 每个被动 / 效果字段：带了生效、没带不生效、卡被 Down 失效。
import { EXECUTE_LOW_HP_RATIO } from "@choke/shared/battle/config"
import { withAction, type BattleAction } from "@choke/shared/battle/actions"
import { resolveEncounter } from "@choke/shared/battle/content"
import {
  armorSupportTier,
  createBattle,
  effectiveApCost,
  healEfficiency,
  incomingDamageFactor,
  manualDefenseTier,
  playerResist,
  statOf,
} from "@choke/shared/battle/engine"
import { comboMultiplier, mitigation } from "@choke/shared/battle/rules"
import type { BattleState } from "@choke/shared/battle/types"
import { autoDescribeSkill, checkSkill, checkSkillTable, describeSkill, describeSkillEffects } from "@choke/shared/skill-check"
import { JOB_ORDER, SKILLS, requireSkill, rollSkillRefs, seededRandom, skillDealtTo } from "@choke/shared/skills"
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
  return createBattle(encounter, cards, { apMax: 7, seed })
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
    "controlBonus", "supportProcBonus", "apRegenBonus", "healBonus", "triggerBonus", "supportShield", "teamDamageReduce",
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
  check("守护圣印：效果独立归属名称", describeSkillEffects(SKILLS.paladin_protect!).map(effect => effect.name).join(",") === "守护圣印")
  check("多效果技能：群体增益与 BOOST 分开展示", describeSkillEffects(SKILLS.bard_ward!).map(effect => effect.name).join(",") === "群体增益,BOOST")
  check("技能名没有旧 demo 名字", !all.some((s) => /六色破坏光线|毗沙门天剑|哈尼军团|哈尼队|哈尼突击队|专拐激昂曲|全军军师阵/.test(s.name)))
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
  check("发牌：Mythic 三个槽，不重复", three.length === 3 && new Set(three.map((d) => d.id)).size === 3)

  // Mythic / Prismatic / 本体卡：前两槽 55/35/10，第 3 槽主动被动各 50% → 3/0、2/1、1/2、0/3
  const rollJobs: Job[] = ["tank", "warrior", "mage", "support"]
  for (const rarity of ["Mythic", "Prismatic"] as const) {
    const byActives = [0, 0, 0, 0]
    let bad = 0
    for (let i = 0; i < N; i += 1) {
      const job = rollJobs[i % 3]!
      const defs = rollSkillRefs(job, rarity, random).map((ref) => requireSkill(ref.skillId))
      if (defs.length !== 3 || new Set(defs.map((d) => d.id)).size !== 3 || defs.some((d) => d.job !== job)) bad += 1
      byActives[defs.filter((d) => !d.passive).length]! += 1
    }
    // 前两槽 2/0 .55、1/1 .35、0/2 .10；第 3 槽 50% 主动 → 3 主动 .275、2 主动 .5×(.55+.35)=.45、1 主动 .5×(.35+.10)=.225…
    const expected = [0.05, 0.225, 0.45, 0.275]
    check(`发牌：${rarity} 三个槽，不重复，都属于本大职业`, bad === 0, `bad=${bad}`)
    check(
      `发牌：${rarity} 主动数 0/1/2/3 约占 5% / 22.5% / 45% / 27.5%`,
      byActives.every((n, k) => Math.abs(n / N - expected[k]!) < 0.02),
      JSON.stringify(byActives),
    )
  }
  const heroLike = rollSkillRefs("mage", "R", random, true)
  check("发牌：本体卡（wantThree）三个槽", heroLike.length === 3)
}

// ---------- 0c. 发牌按稀有度范围过滤 ----------
{
  const random = seededRandom("range-test")
  const fake = (extra: Partial<(typeof SKILLS)[string]>) => ({ ...SKILLS.bulwark_guard!, ...extra })
  check("范围：不写范围的技能，所有稀有度都能抽", ["C", "UC", "R", "E", "L", "Mythic", "Prismatic"].every((r) => skillDealtTo(fake({}), r as never)))
  check("范围：minRarity=Mythic 的，C 到 L 抽不到", !skillDealtTo(fake({ minRarity: "Mythic" }), "L") && skillDealtTo(fake({ minRarity: "Mythic" }), "Mythic"))
  check("范围：maxRarity=E 的，L 起抽不到", skillDealtTo(fake({ maxRarity: "E" }), "E") && !skillDealtTo(fake({ maxRarity: "E" }), "L"))
  check("校验：min 高于 max 被拒", checkSkillTable({ x: fake({ id: "x", minRarity: "L", maxRarity: "R" }) }).some((p) => p.includes("minRarity")))
  const gated = Object.values(SKILLS).filter((s) => s.minRarity && s.minRarity !== "C")
  let leaked = 0
  for (const rarity of ["C", "UC", "R", "E", "L"] as const) {
    for (let i = 0; i < 3000; i += 1) {
      for (const ref of rollSkillRefs(JOB_ORDER[i % 4]!, rarity, random)) {
        if (!skillDealtTo(requireSkill(ref.skillId), rarity)) leaked += 1
      }
    }
  }
  check(`范围：有 ${gated.length} 个高级专属技能，C 到 L 的卡一个都抽不到`, leaked === 0, `漏出 ${leaked} 次`)
  check("范围：舞者增幅只有 Mythic 起", requireSkill("dancer_grace").minRarity === "Mythic")
  for (const job of JOB_ORDER) {
    for (const rarity of ["C", "UC", "R", "E", "L", "Mythic", "Prismatic"] as const) {
      const pool = Object.values(SKILLS).filter((s) => s.job === job && skillDealtTo(s, rarity))
      const passives = pool.filter((s) => s.passive).length
      const need = rarity === "Mythic" || rarity === "Prismatic" ? 3 : 2
      check(`池子：${job} ${rarity} 主动 ≥ 3、被动 ≥ ${need}`, pool.length - passives >= 3 && passives >= need, `主动 ${pool.length - passives} 被动 ${passives}`)
    }
  }
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
    const s = createBattle(spec, cards, { apMax: 7, seed: "heal-1" })
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

// ---------- 7a. 治疗量按最大生命百分比，不随卡牌等级变 ----------
{
  const healAt = (level: number, id: string, carrier: Job = "support") => {
    const s = createBattle(
      spec,
      inputs([face("h", carrier, "L", level, 0, [id]), face("t", "tank", "L", level, 0, ["bulwark_quake"])], 10),
      { apMax: 7, seed: "pct-1" },
    )
    s.teamHp = 1
    for (const c of s.cards) c.trigger = null
    const after = apply(s, { type: "skill", card: 0, skill: id })
    return { gain: after.teamHp - 1, max: s.teamHpMax }
  }
  const lowLevel = healAt(10, "healer_heal")
  const highLevel = healAt(80, "healer_heal")
  check("治疗按百分比：圣光治愈回 7% 最大生命", Math.abs(lowLevel.gain / lowLevel.max - 0.07) < 0.002 && Math.abs(highLevel.gain / highLevel.max - 0.07) < 0.002, `${lowLevel.gain}/${lowLevel.max}、${highLevel.gain}/${highLevel.max}`)
  const mageHeal = healAt(40, "life_renew", "mage")
  check("治疗按百分比：生机涌动回 6% 最大生命", Math.abs(mageHeal.gain / mageHeal.max - 0.06) < 0.002, `${mageHeal.gain}/${mageHeal.max}`)
  const sameCardInt = (level: number) => healAt(level, "healer_heal").gain / healAt(level, "healer_heal").max
  check("治疗按百分比：10 级和 80 级回血占比一样", Math.abs(sameCardInt(10) - sameCardInt(80)) < 0.002)
  check("技能表校验：heal 不写 healPct 被拒", checkSkillTable({ x: { ...SKILLS.healer_heal!, id: "x", healPct: undefined } }).length > 0)
  check("技能表校验：heal 写 power 被拒", checkSkillTable({ x: { ...SKILLS.healer_heal!, id: "x", power: 0.2 } }).length > 0)
  check("技能表校验：单次治疗超过 15% 被拒", checkSkillTable({ x: { ...SKILLS.healer_heal!, id: "x", healPct: 0.2 } }).length > 0)
  check("所有现有治疗都不超过 15%", Object.values(SKILLS).filter((d) => d.kind === "heal").every((d) => (d.healPct ?? 0) <= 0.15))
}

// ---------- 7b. 治疗软上限 ----------
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
    const s = createBattle(encounter, cards, { apMax: 7, seed: "budget-1" })
    s.teamHp = 1
    return s
  }
  const heal = (s: BattleState, card: number) => apply(s, { type: "skill", card, skill: "healer_heal" })

  const normal = make(spec)
  check("治疗软上限：默认是最大生命的一半", spec.healSoftCap === 0.5 && normal.healSoftCap === Math.round(normal.teamHpMax * 0.5))
  const oneHeal = heal(make(spec), 1)
  const onePct = (oneHeal.teamHp - 1) / oneHeal.teamHpMax
  check("治疗软上限：1 AP 治疗约 6%–10% 最大生命（15% 才算大恢复）", onePct > 0.06 && onePct < 0.1, `${(onePct * 100).toFixed(1)}%`)
  check("治疗软上限：回血量记入已治疗总量", oneHeal.healed === oneHeal.teamHp - 1)

  // 软上限很小时：第一次治疗正常，之后一次比一次弱，但仍然能回血
  const tight = make({ ...spec, healSoftCap: 0.05 })
  const first = heal(tight, 1)
  const second = heal(first, 2)
  const g1 = first.teamHp - 1
  const g2 = second.teamHp - first.teamHp
  check("治疗软上限：回得越多之后越弱", g1 > g2, `${g1} > ${g2}`)
  check("治疗软上限：不是硬墙，后面仍然能回血", g2 > 0)
  check("治疗软上限：效率随已治疗总量递减", healEfficiency(second) < healEfficiency(first) && healEfficiency(first) < 1)
  check("治疗软上限：回过软上限那么多血时效率约减半", Math.abs(healEfficiency({ healed: tight.healSoftCap!, healSoftCap: tight.healSoftCap }) - 0.5) < 1e-9)

  const endless = make({ ...spec, healSoftCap: "unlimited" })
  check("治疗软上限：unlimited 时不衰减（永动机 BOSS）", endless.healSoftCap === null)
  const e1 = heal(endless, 1)
  const e2 = heal(e1, 2)
  check("治疗软上限：不衰减时效率始终 100%", healEfficiency(e1) === 1 && healEfficiency(e2) === 1 && e2.healed > e1.healed)
}

// ---------- 7c. 防御：重装甲（DEF 乘区）与手动防御（绝对减免）叠加 ----------
{
  const withArmor = (tier: number) => {
    const s = start("tank", ["bulwark_taunt"])
    if (tier > 0) {
      s.playerSupports.push({ id: "t-armor", name: "测试装甲", kind: "armor", element: "metal", defenseTier: tier, tier, roleText: "装甲" })
    }
    return s
  }
  const factor = (s: BattleState) => incomingDamageFactor(s, playerResist(s, s.cards[0]!, false))
  const baseDef = statOf(withArmor(0), withArmor(0).cards[0]!, "def")

  const plain = withArmor(0)
  const armorOnly = withArmor(2)
  check("重装甲 II：全队 DEF +40%", playerResist(armorOnly, armorOnly.cards[0]!, false) === Math.round(baseDef * 1.4), `${playerResist(armorOnly, armorOnly.cards[0]!, false)} vs ${Math.round(baseDef * 1.4)}`)
  check("重装甲 II：魔法抗性也 +40%", playerResist(armorOnly, armorOnly.cards[0]!, true) === Math.round(statOf(plain, plain.cards[0]!, "int") * 1.4))
  check("重装甲 II：承受伤害变少", factor(armorOnly) < factor(plain))

  const manualOnly = withArmor(0)
  manualOnly.defenseTier = 1
  const both = withArmor(2)
  both.defenseTier = 1
  check("手动防御 Lv1：承受伤害变少", factor(manualOnly) < factor(plain))
  check("手动 Lv1 + 重装甲 II：比单用任何一个都更减伤（不再被装甲盖掉）", factor(both) < factor(manualOnly) && factor(both) < factor(armorOnly))
  const expectBoth = (1 - mitigation(playerResist(both, both.cards[0]!, false))) * (1 - 0.2)
  check("两个乘区相乘", Math.abs(factor(both) - expectBoth) < 1e-9, `${factor(both)} vs ${expectBoth}`)

  const maxed = withArmor(4)
  maxed.defenseTier = 4
  check("总减伤封顶 90%", Math.abs(factor(maxed) - 0.1) < 1e-9, `${factor(maxed)}`)

  const broken = withArmor(2)
  broken.defenseTier = 2
  broken.teamStatuses.push({ id: "armor_break", name: "破防", amount: 0, turns: 3, stacks: 1, isDebuff: true })
  check("破防每层同时扣手动档位与装甲档位", manualDefenseTier(broken) === 1 && armorSupportTier(broken) === 1)
  const noTank = withArmor(0)
  noTank.cards[1]!.down = true
  noTank.cards[0] = { ...noTank.cards[0]!, job: "warrior" }
  noTank.defenseTier = 4
  check("无坦克在场：手动防御最高只算 Lv2（−35%）", Math.abs(incomingDamageFactor(noTank, 0) - 0.65) < 1e-9)
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
  const s = createBattle(spec, cards, { apMax: 7, seed: "boost-1" })
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
      const s = createBattle(enc, cards, { apMax: 7, seed })
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

  // 侧面支援攻击也要过硬壳：回合开始自动打，每一下都是 100；没有硬壳时是正常伤害
  const supportHits = (supports: (typeof ghost)["supports"]) => {
    for (let n = 0; n < 30; n += 1) {
      const s = start("warrior", ["berserker_zero"], `shell-sup-${n}`, { ...ghost, supports })
      s.enemy.hp = s.enemy.hpMax = 1e9
      s.enemy.intents = []
      s.playerSupports.push({ id: "t-atk", name: "测试攻击支援", kind: "attack", element: "physical", atk: 5000, power: 1, hits: 2, procRate: 0.95, roleText: "攻击" })
      const amounts = apply(s, { type: "endTurn" }).events
        .filter((e) => e.type === "damage" && e.target === "enemy" && e.source === "测试攻击支援")
        .map((e) => (e.type === "damage" ? e.amount : 0))
      if (amounts.length > 0) return amounts
    }
    return []
  }
  const supNone = supportHits([])
  const supShell = supportHits([shell(1e9)])
  check("硬壳：没有硬壳时侧面支援伤害正常", supNone.length > 0 && supNone.every((a) => a > 100), supNone.join(","))
  check("硬壳：侧面支援单段低于门槛也只算 100", supShell.length === supNone.length && supShell.every((a) => a === 100), supShell.join(","))

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

// ---------- 9k. 技能池扩充第一批 ----------
{
  const ghost = resolveEncounter(BATTLE_CONTENT, "ghost")!

  // 全队被动回血合计封顶 4%（对照组换成不带回血的卡，扣掉敌人这回合打出的伤害）
  const hpGain = (decks: string[][]) => {
    const net = (ids: string[][]) => {
      const cards = inputs(ids.map((id, i) => face(`m${i}`, "mage", "L", 40, 0, id)), 10)
      const s = createBattle(spec, cards, { apMax: 7, seed: "regen-cap" })
      s.teamHp = Math.round(s.teamHpMax * 0.2)
      const before = s.teamHp
      return { gain: apply(s, { type: "endTurn" }).teamHp - before, max: s.teamHpMax }
    }
    const plain = net(decks.map(() => ["warlock_frost"]))
    const real = net(decks)
    return { gain: real.gain - plain.gain, max: real.max }
  }
  const one = hpGain([["life_regen", "life_bloom"], ["warlock_frost"]])
  check("全队回血上限：生生不息 + 生命脉动合计 4%", Math.abs(one.gain / one.max - 0.04) < 0.003, `${one.gain}/${one.max}`)
  const stacked = hpGain([["life_regen", "life_bloom"], ["life_regen", "life_bloom"], ["life_bloom", "life_regen"]])
  check("全队回血上限：三张卡叠满（含治疗量加成）也不超过 4%", Math.abs(stacked.gain / stacked.max - 0.04) < 0.003, `${stacked.gain}/${stacked.max}`)
  const bloomOnly = hpGain([["life_bloom", "warlock_frost"], ["warlock_frost"]])
  check("全队回血上限：只有生命脉动回约 2.9%（2.5% × 治疗量 +15%）", Math.abs(bloomOnly.gain / bloomOnly.max - 0.02875) < 0.003, `${bloomOnly.gain}/${bloomOnly.max}`)
  check("全队回血：被动回血来源只有生命脉动和生生不息（含生息的下位版）", Object.values(SKILLS).filter((s) => s.regenPct).map((s) => s.id).sort().join() === "life_bloom,life_regen,life_regen_low,life_regen_mid")

  // 辉光礼赞：救醒 1 人
  const hymn = (() => {
    const s = start("support", ["healer_hymn"])
    s.cards = [...s.cards, { ...s.cards[1]!, name: "filler-2" }]
    s.cards[1]!.down = true
    s.cards[2]!.down = true
    s.ap = 6
    return apply(s, { type: "skill", card: 0, skill: "healer_hymn" })
  })()
  check("辉光礼赞：只救醒 1 人", hymn.cards.filter((c) => c.down).length === 1)

  // 零拍定音：0 AP，单次
  {
    const cards = inputs(
      [face("bard", "support", "L", 40, 0, ["dancer_cue"]), face("a", "tank", "L", 40, 0, ["bulwark_quake"]), face("b", "tank", "L", 40, 0, ["bulwark_quake"])],
      10,
    )
    const s = createBattle(spec, cards, { apMax: 7, seed: "cue-1" })
    for (const c of s.cards) c.trigger = null
    const apBefore = s.ap
    const after = apply(s, { type: "skill", card: 0, skill: "dancer_cue" })
    check("零拍定音：0 AP", after.ap === apBefore)
    check("零拍定音：点亮 1 张队友的 BOOST", after.cards.filter((c, i) => i > 0 && c.trigger === "boost").length === 1)
    check("零拍定音：整场只能用 1 次", withAction(after, { type: "skill", card: 0, skill: "dancer_cue" }).error !== null)
  }

  // 被动
  const defOf = (id: string) => {
    const s = start("tank", [id])
    return statOf(s, s.cards[0]!, "def")
  }
  const baseDef = defOf("bulwark_quake")
  check("重甲护航：DEF ×1.15", Math.abs(defOf("warden_escort") / baseDef - 1.15) < 0.02)
  check("战意吸血：DEF ×1.05", Math.abs(defOf("bulwark_resolve") / baseDef - 1.05) < 0.02)
  check("仁心续命 / 和声壁障：自身 DEF 加成", (() => {
    const def = (id: string) => { const s = start("support", [id]); return statOf(s, s.cards[0]!, "def") }
    const base = def("bard_inspire")
    return Math.abs(def("healer_ward") / base - 1.08) < 0.02 && Math.abs(def("healer_barrier") / base - 1.1) < 0.02
  })())
  {
    const s = lowHp(start("tank", ["bulwark_thornheart"]))
    const plain = lowHp(start("tank", ["bulwark_quake"]))
    check("荆心魔甲：低血时 ATK ×1.25", Math.abs(statOf(s, s.cards[0]!, "atk") / statOf(plain, plain.cards[0]!, "atk") - 1.25) < 0.02)
    check("荆心魔甲：开局自带荆棘", start("tank", ["bulwark_thornheart"]).cards[0]!.statuses.some((st) => st.id === "thorns"))
  }

  // 召唤
  {
    const s = start("tank", ["bulwark_ironwall"], "ironwall-1", ghost)
    s.ap = 6
    const after = apply(s, { type: "skill", card: 0, skill: "bulwark_ironwall" })
    check("铁棘墙：部署强度 2 的荆棘支援", after.playerSupports.some((u) => u.kind === "thorns" && (u.tier ?? 1) === 2))
  }
  {
    const s = start("tank", ["warden_vanguard"], "vanguard-1", ghost)
    s.ap = 6
    const after = apply(s, { type: "skill", card: 0, skill: "warden_vanguard" })
    check("前线号盾：部署强度 2 的攻击型支援", after.playerSupports.some((u) => u.kind === "attack" && (u.tier ?? 1) === 2))
  }

  // 重压破阵：拆强度 2 的支援
  {
    const aura = (id: string, tier: number) => ({ id, name: id, kind: "aura" as const, element: "light" as const, stat: "def" as const, amount: 0.1, tier, roleText: "测试" })
    const s = start("tank", ["bulwark_crush"], "crush-1", ghost)
    s.enemy.hp = s.enemy.hpMax = 1e9
    s.ap = 6
    s.enemySupports = [aura("t2", 2), aura("t3", 3)]
    const after = apply(s, { type: "skill", card: 0, skill: "bulwark_crush" })
    check("重压破阵：拆得动强度 2，拆不动强度 3", after.enemySupports.map((u) => u.id).join() === "t3", after.enemySupports.map((u) => u.id).join())
  }

  // 终幕盾轰：脆弱时 +45%
  {
    const dealtTo = (vulnerable: boolean) => {
      let total = 0
      for (const seed of seedsOf("slam")) {
        const s = start("tank", ["bulwark_slam"], seed, ghost)
        s.enemy.hp = s.enemy.hpMax = 1e9
        s.ap = 6
        if (vulnerable) s.enemy.statuses.push({ id: "vulnerable", name: "脆弱", amount: 0.3, turns: 2, isDebuff: true })
        total += s.enemy.hp - apply(s, { type: "skill", card: 0, skill: "bulwark_slam" }).enemy.hp
      }
      return total
    }
    check("终幕盾轰：目标脆弱时伤害明显更高", dealtTo(true) / dealtTo(false) > 1.3 * 1.3, `${dealtTo(true)}/${dealtTo(false)}`)
  }

  // 穿透棱光：穿甲 50% 且不带状态
  {
    const def = SKILLS.warlock_prism!
    check("穿透棱光：穿甲 50%，不附带状态", def.piercePct === 0.5 && def.statusId === undefined)
  }

  // 数据口径
  const added = ["warden_spike", "warden_double", "bulwark_ironwall", "warden_vanguard", "bulwark_crush", "bulwark_slam", "bulwark_intimidate", "bulwark_thornheart", "bulwark_shelter", "warden_escort", "bulwark_resolve", "breaker_keen", "berserker_overdrive", "berserker_frenzy", "warlock_prism", "warlock_overclock", "life_leech", "life_bloom", "life_spring", "summoner_bastion", "bard_vigil", "dancer_cue", "healer_hymn", "healer_patch", "bard_discord", "bard_tempo", "healer_ward", "healer_barrier"]
  check("技能池扩充第一批：28 个技能都在表里", added.length === 28 && added.every((id) => SKILLS[id]))
  const newActive0 = Object.values(SKILLS).filter((s) => !s.passive && s.ap === 0 && added.includes(s.id))
  check("技能池扩充：新增的 0 费主动不超过 2 个", newActive0.length <= 2, newActive0.map((s) => s.id).join())
  check("技能池扩充：吸血被动都不超过 8%", Object.values(SKILLS).filter((s) => s.lifesteal).every((s) => s.lifesteal! <= 0.08))
}

// ---------- 9l. 技能池扩充第二批：三个新机制 ----------
{
  const ghost = resolveEncounter(BATTLE_CONTENT, "ghost")!
  const RESIST = 1000

  // 全队减伤（滞拍格挡 6%、稳拍护盾 4%）：多张叠加，合计 10% 封顶，仍受总减伤 90% 上限约束
  const factorWith = (decks: Array<[Job, string[]]>) => {
    const cards = inputs(decks.map(([job, ids], i) => face(`t${i}`, job, "Mythic", 40, 0, ids)), 10)
    return { s: createBattle(spec, cards, { apMax: 7, seed: "team-reduce" }) }
  }
  const none = incomingDamageFactor(factorWith([["tank", ["bulwark_quake"]], ["tank", ["bulwark_quake"]]]).s, RESIST)
  const parry = factorWith([["tank", ["warden_parry"]], ["tank", ["bulwark_quake"]]]).s
  check("滞拍格挡：全队受到的伤害 −6%", Math.abs(incomingDamageFactor(parry, RESIST) / none - 0.94) < 0.002)
  const both = factorWith([["tank", ["warden_parry"]], ["support", ["bard_shelter"]]]).s
  check("滞拍格挡 + 稳拍护盾：叠加 −10%", Math.abs(incomingDamageFactor(both, RESIST) / none - 0.9) < 0.002)
  const many = factorWith([["tank", ["warden_parry"]], ["tank", ["warden_parry"]], ["tank", ["warden_parry"]]]).s
  check("全队减伤：叠到 18% 也只算 10%", Math.abs(incomingDamageFactor(many, RESIST) / none - 0.9) < 0.002)
  const downed = factorWith([["tank", ["warden_parry"]], ["tank", ["bulwark_quake"]]]).s
  downed.cards[0]!.down = true
  check("滞拍格挡：带它的卡被 Down 就失效", Math.abs(incomingDamageFactor(downed, RESIST) - none) < 1e-9)
  many.defenseTier = 4
  check("全队减伤：叠上满档防御，总减伤仍不超过 90%", incomingDamageFactor(many, RESIST) >= 0.1 - 1e-9, String(incomingDamageFactor(many, RESIST)))

  // 异常计数增伤：每种负面 +15%，最多 3 种，脆弱不计
  const hitFor = (id: string, job: Job, kinds: string[], extra?: (s: BattleState) => void) => {
    let total = 0
    for (const seed of seedsOf(id)) {
      const s = start(job, [id], seed, ghost)
      s.enemy.hp = s.enemy.hpMax = 1e9
      s.ap = 6
      for (const kind of kinds) s.enemy.statuses.push({ id: kind, name: kind, amount: 0.03, turns: 3, isDebuff: true } as never)
      extra?.(s)
      total += s.enemy.hp - apply(s, { type: "skill", card: 0, skill: id }).enemy.hp
    }
    return total
  }
  for (const [id, job] of [["assassin_exploit", "warrior"], ["warlock_collapse", "mage"]] as const) {
    const base = hitFor(id, job, [])
    check(`${SKILLS[id]!.name}：目标 2 种负面状态时伤害约 +30%`, Math.abs(hitFor(id, job, ["poison", "bleed"]) / base - 1.3) < 0.03)
    check(`${SKILLS[id]!.name}：5 种负面状态也只计 3 种（+45%）`, Math.abs(hitFor(id, job, ["poison", "bleed", "curse", "shock", "weaken"]) / base - 1.45) < 0.03)
    check(`${SKILLS[id]!.name}：脆弱不重复计入`, Math.abs(hitFor(id, job, ["vulnerable"]) / base - 1.3) < 0.03, "脆弱本身有 +30% 乘区，不应再叠 +15%")
  }

  // 节拍阈值：强拍星落 Combo ≥ 5 伤害 +35%
  {
    const at = (combo: number) => hitFor("warlock_cadence", "mage", [], (s) => { s.combo = combo })
    const expected = 1.35 * (comboMultiplier(6) / comboMultiplier(5))
    check("强拍星落：Combo 5 比 Combo 4 多 35%（另计 Combo 倍率差）", Math.abs(at(5) / at(4) - expected) < 0.04, `${at(5) / at(4)} vs ${expected}`)
    check("强拍星落：Combo 6 和 Combo 5 的差只剩 Combo 倍率", Math.abs(at(6) / at(5) - comboMultiplier(7) / comboMultiplier(6)) < 0.04)
  }

  // 高潮合拍：Combo ≥ 5 多点亮 2 名队友的 BOOST
  {
    const lit = (combo: number) => {
      const cards = inputs(
        [face("bard", "support", "L", 40, 0, ["bard_crescendo"]), face("a", "tank", "L", 40, 0, ["bulwark_quake"]), face("b", "tank", "L", 40, 0, ["bulwark_quake"]), face("c", "tank", "L", 40, 0, ["bulwark_quake"])],
        10,
      )
      const s = createBattle(spec, cards, { apMax: 7, seed: "crescendo-1" })
      for (const c of s.cards) c.trigger = null
      s.combo = combo
      s.ap = 6
      const after = apply(s, { type: "skill", card: 0, skill: "bard_crescendo" })
      return {
        boosts: after.cards.filter((c, i) => i > 0 && c.trigger === "boost").length,
        buffed: after.teamStatuses.some((st) => st.id === "buff_atk"),
      }
    }
    check("高潮合拍：Combo 不够时只加全队增益，不点亮 BOOST", lit(4).boosts === 0 && lit(4).buffed)
    check("高潮合拍：Combo ≥ 5 时多点亮 2 名队友的 BOOST", lit(5).boosts === 2 && lit(5).buffed, String(lit(5).boosts))
  }

  // 数据口径
  const second = ["warden_parry", "assassin_exploit", "warlock_collapse", "warlock_cadence", "bard_crescendo", "bard_shelter"]
  check("技能池扩充第二批：6 个技能都在表里", second.every((id) => SKILLS[id]))
  check("技能池扩充第二批：两个全队减伤被动 Mythic 起", SKILLS.warden_parry!.minRarity === "Mythic" && SKILLS.bard_shelter!.minRarity === "Mythic")
  check("技能池扩充第二批：只有这两个技能带全队减伤", Object.values(SKILLS).filter((s) => s.teamDamageReduce).map((s) => s.id).sort().join() === "bard_shelter,warden_parry")
}

// ---------- 9m. 技能池扩充第三批：断拍震击、震慑乱拍 ----------
{
  const ghost = resolveEncounter(BATTLE_CONTENT, "ghost")!
  const aura = (id: string, tier: number) => ({ id, name: id, kind: "aura" as const, element: "light" as const, stat: "def" as const, amount: 0.1, tier, roleText: "测试" })
  const s = start("tank", ["warden_stagger"], "stagger-1", ghost)
  s.enemy.hp = s.enemy.hpMax = 1e9
  s.ap = 6
  s.enemySupports = [aura("t1", 1), aura("t1b", 1), aura("t2", 2)]
  const after = apply(s, { type: "skill", card: 0, skill: "warden_stagger" })
  check("断拍震击：只拆 1 个强度 ≤1 的支援，强度 2 不动", after.enemySupports.length === 2 && after.enemySupports.some((u) => u.id === "t2"), after.enemySupports.map((u) => u.id).join())

  let weakened = 0
  for (const seed of seedsOf("daze")) {
    const d = start("tank", ["warden_daze"], seed, ghost)
    d.enemy.hp = d.enemy.hpMax = 1e9
    d.ap = 6
    if (apply(d, { type: "skill", card: 0, skill: "warden_daze" }).enemy.statuses.some((st) => st.id === "weaken")) weakened += 1
  }
  check("震慑乱拍：衰弱几率约 80%", Math.abs(weakened / SEEDS - 0.8) < 0.1, String(weakened / SEEDS))
  check("技能池扩充第三批：2 个技能都在表里", Boolean(SKILLS.warden_stagger && SKILLS.warden_daze))
}

// ---------- 9n. 下位技能：初阶（C–UC）、次阶（R–E）----------
{
  const RARITY_LIST = ["C", "UC", "R", "E", "L", "Mythic", "Prismatic"] as const
  const lows = Object.values(SKILLS).filter((s) => s.id.endsWith("_low"))
  const mids = Object.values(SKILLS).filter((s) => s.id.endsWith("_mid"))
  const baseOf = (id: string) => SKILLS[id.replace(/_(low|mid)$/, "")]
  const lowerIds = new Set([...lows, ...mids].map((s) => s.id))

  check("下位技能：每个都有对应的原版", [...lows, ...mids].every((s) => baseOf(s.id) !== undefined))
  check("下位技能：数量 43 个初阶 + 49 个次阶", lows.length === 43 && mids.length === 49, `${lows.length}/${mids.length}`)
  check("下位技能：初阶只到 UC，次阶只在 R–E", lows.every((s) => s.maxRarity === "UC" && !s.minRarity) && mids.every((s) => s.minRarity === "R" && s.maxRarity === "E"))
  check(
    "下位技能：有下位版的原版只发给 L 起（铁壁架势除外，它没有下位版）",
    Object.values(SKILLS)
      .filter((s) => !lowerIds.has(s.id) && (SKILLS[`${s.id}_mid`] !== undefined))
      .every((s) => skillDealtTo(s, "L") && !skillDealtTo(s, "E")),
  )
  check("下位技能：AP 费用、类型、段数和原版一致", [...lows, ...mids].every((s) => {
    const base = baseOf(s.id)!
    return s.ap === base.ap && s.kind === base.kind && s.hits === base.hits && s.element === base.element && Boolean(s.passive) === Boolean(base.passive)
  }))
  check("下位技能：威力 初阶 ≤ 次阶 ≤ 原版", mids.every((mid) => {
    const base = baseOf(mid.id)!
    const low = SKILLS[mid.id.replace(/_mid$/, "_low")]
    if (base.power === undefined || mid.power === undefined) return true
    return mid.power <= base.power && (low?.power === undefined || low.power <= mid.power)
  }))
  check("下位技能：初阶不拆支援、不带净化、不带 BOOST 点亮", lows.every((s) => !s.clearEnemySupports && !s.breakTier && !s.cleanse && !s.boostAllies))
  check("下位技能：名字不重复（全表）", new Set(Object.values(SKILLS).map((s) => s.name)).size === Object.keys(SKILLS).length)
  check("下位技能：技能表整体校验通过", checkSkillTable().length === 0, checkSkillTable().join("；"))

  // 发牌：低品质拿不到原版，高品质拿不到下位版；每个职业每个稀有度的池子都不空
  const dealt = (job: Job, rarity: (typeof RARITY_LIST)[number], n = 300) => {
    const ids = new Set<string>()
    for (let i = 0; i < n; i += 1) for (const ref of rollSkillRefs(job, rarity, seededRandom(`low-${job}-${rarity}-${i}`))) ids.add(ref.skillId)
    return ids
  }
  let leak = ""
  for (const job of JOB_ORDER) {
    for (const rarity of RARITY_LIST) {
      const ids = dealt(job, rarity)
      for (const id of ids) {
        const lower = lowerIds.has(id)
        const hasLower = !lower && SKILLS[`${id}_mid`] !== undefined
        if ((rarity === "C" || rarity === "UC") && (id.endsWith("_mid") || hasLower)) leak ||= `${rarity} 拿到了 ${id}`
        if ((rarity === "R" || rarity === "E") && (id.endsWith("_low") || hasLower)) leak ||= `${rarity} 拿到了 ${id}`
        if (RARITY_LIST.indexOf(rarity) >= 4 && lower) leak ||= `${rarity} 拿到了 ${id}`
      }
      if (ids.size === 0) leak ||= `${job}/${rarity} 池子是空的`
    }
  }
  check("下位技能发牌：C/UC 只拿初阶、R/E 只拿次阶、L 起只拿原版", leak === "", leak)

  // 迅捷抢攻率：初阶 ×0.5、次阶 ×0.75
  const ghost = resolveEncounter(BATTLE_CONTENT, "ghost")!
  const preemptive = (swiftId: string) => {
    let n = 0
    for (const seed of seedsOf("swiftrate")) n += logHas(start("warrior", ["berserker_cleave", swiftId], seed, ghost), "抢攻") ? 1 : 0
    return n
  }
  const full = preemptive("breaker_swift")
  const mid = preemptive("breaker_swift_mid")
  const low = preemptive("breaker_swift_low")
  check("迅捷抢攻率：初阶 < 次阶 < 原版", low < mid && mid < full, `${low}/${mid}/${full}`)
  check("迅捷抢攻率：初阶约为原版一半", Math.abs(low / Math.max(1, full) - 0.5) < 0.2, `${low}/${full}`)

  // 本体卡技能池按 Prismatic：只有原版、3 个槽
  const heroRefs = JOB_ORDER.flatMap((job) => Array.from({ length: 100 }, (_, i) => rollSkillRefs(job, "Prismatic", seededRandom(`hero-${job}-${i}`))))
  check("本体卡：3 个槽，抽不到下位版", heroRefs.every((refs) => refs.length === 3 && refs.every((r) => !lowerIds.has(r.skillId))))
}

// ---------- 10. 坦克只看大职业 ----------
{
  const tankDeck = start("tank", ["bulwark_quake"])
  const warriorDeck = createBattle(spec, inputs([face("w", "warrior", "L", 40, 0, ["paladin_smite"])], 10), { apMax: 7, seed: "t" })
  check("四维权重：坦克 DEF 高于战士", tankDeck.cards[0]!.stats.def > warriorDeck.cards[0]!.stats.def)
}

console.log(`\n${count} 项检查，未通过 ${failures.length}`)
if (failures.length > 0) {
  console.log(failures.map((f) => `  - ${f}`).join("\n"))
  process.exit(1)
}
