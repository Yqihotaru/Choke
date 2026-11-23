// pnpm test:skills —— 技能效果测试。
// 每个被动 / 效果字段：带了生效、没带不生效、卡被 Down 失效。
import { withAction, type BattleAction } from "@choke/shared/battle/actions"
import { resolveEncounter } from "@choke/shared/battle/content"
import { createBattle, effectiveApCost, statOf } from "@choke/shared/battle/engine"
import type { BattleState } from "@choke/shared/battle/types"
import { autoDescribeSkill, checkSkill, checkSkillTable, describeSkill } from "@choke/shared/skill-check"
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
