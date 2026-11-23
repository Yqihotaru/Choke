// pnpm test:weakness —— 三种弱点的行为测试。
// 用 ghost 改出几只合成敌人（直接在内存里改，不碰 content/），检查：
//   1. 窗口弱点：条件成立的回合伤害更高，且整回合固定（回合中途条件变了也不会变）
//   2. 隐藏弱点：一直生效；第一次打中才记入 hiddenFound，只记一次，只发一次事件
//   3. 打中的属性不在隐藏列表里时不记录
//   4. 带这些字段的整场战斗，同种子打两遍相同、重放与实打相同
import { replayBattle, withAction, type BattleAction } from "@choke/shared/battle/actions"
import { resolveEncounter, type EncounterSpec, type EnemyDef } from "@choke/shared/battle/content"
import { createBattle } from "@choke/shared/battle/engine"
import type { BattleEvent, BattleState } from "@choke/shared/battle/types"
import { ELEMENTS, type Element } from "@choke/shared/types"

import { BATTLE_CONTENT } from "../src/content"
import { BENCH, DECKS, playBot, testApMax } from "./lib/battle-bot"

const ghost = resolveEncounter(BATTLE_CONTENT, "ghost")!
const deck = DECKS.normal!
const ALL: Element[] = [...ELEMENTS]

/** 把 ghost 的弱点清空再按 patch 覆盖，其余不变，这样「有弱点」和「没弱点」只差一个因素 */
function enemyWith(patch: Partial<Pick<EnemyDef, "weaknesses" | "hiddenWeaknesses" | "weaknessWindows">>): EncounterSpec {
  return { ...ghost, enemy: { ...ghost.enemy, weaknesses: [], hiddenWeaknesses: [], weaknessWindows: [], ...patch } }
}

const failures: string[] = []
let count = 0
function check(name: string, ok: boolean, detail = "") {
  count += 1
  if (!ok) failures.push(`${name}${detail ? `：${detail}` : ""}`)
  console.log(`${ok ? "✔" : "✘"} ${name}${!ok && detail ? ` → ${detail}` : ""}`)
}

const seed = "weakness-seed-2"
const start = (spec: EncounterSpec) => createBattle(spec, deck, { seed, bench: BENCH, apMax: testApMax(deck) })
const apply = (state: BattleState, action: BattleAction) => {
  const result = withAction(state, action)
  if (result.error) throw new Error(`操作不合法：${result.error}`)
  return result.state
}
const hits = (events: BattleEvent[]) =>
  events.filter((e): e is Extract<BattleEvent, { type: "damage" }> => e.type === "damage" && e.target === "enemy")

/** 在 state 上找第一个能打到敌人的技能 */
function findHit(state: BattleState): BattleAction {
  for (let i = 0; i < state.cards.length; i += 1) {
    for (const skill of state.cards[i]!.skills) {
      if (skill.passive) continue
      const action: BattleAction = { type: "skill", card: i, skill: skill.id }
      const result = withAction(state, action)
      if (!result.error && hits(result.state.events).length > 0) return action
    }
  }
  throw new Error("找不到能打到敌人的技能")
}

// ---------- 1. 窗口弱点 ----------
{
  const control = start(enemyWith({}))
  const windowed = start(enemyWith({ weaknessWindows: [{ when: { turnMod: [2, 0] }, elements: ALL }] }))
  check("窗口：不成立的回合（第 1 回合）没有露出", windowed.enemy.exposed.length === 0)

  let c = control
  let w = windowed
  const a1 = findHit(c)
  c = apply(c, a1)
  w = apply(w, a1)
  check("窗口：不成立的回合伤害与无弱点一致", hits(c.events)[0]!.amount === hits(w.events)[0]!.amount)

  c = apply(c, { type: "endTurn" })
  w = apply(w, { type: "endTurn" })
  check("窗口：条件成立的回合（第 2 回合）露出", w.turn === 2 && w.enemy.exposed.length === ALL.length)
  const a2 = findHit(c)
  c = apply(c, a2)
  w = apply(w, a2)
  const dc = hits(c.events)[0]!
  const dw = hits(w.events)[0]!
  check("窗口：露出的回合伤害更高", dw.amount > dc.amount, `${dw.amount} vs ${dc.amount}`)
  check("窗口：命中带弱点标记", dw.isWeak === true)
  check("窗口：回合中途不会收回", w.enemy.exposed.length === ALL.length)

  w = apply(w, { type: "endTurn" })
  check("窗口：下一回合（第 3 回合）收回", w.turn === 3 && w.enemy.exposed.length === 0)
}

// ---------- 2. 窗口整回合固定：条件在回合中途才变成立，也要等下一回合 ----------
{
  const spec = enemyWith({ weaknessWindows: [{ when: { hpBelow: 0.99 }, elements: ALL }] })
  let state = start(spec)
  check("固定：血量没掉时不露出", state.enemy.exposed.length === 0)
  state = apply(state, findHit(state))
  check("固定：血量掉到条件以下，本回合仍不露出", state.enemy.hp / state.enemy.hpMax < 0.99 && state.enemy.exposed.length === 0)
  state = apply(state, { type: "endTurn" })
  check("固定：下一回合开始时才露出", state.enemy.exposed.length === ALL.length)
}

// ---------- 3. 隐藏弱点 ----------
{
  const control = start(enemyWith({}))
  const first = findHit(control)
  const c1 = apply(control, first)
  const element = hits(c1.events)[0]!.element

  const hidden = start(enemyWith({ hiddenWeaknesses: ALL }))
  check("隐藏：开战时一个都没发现", hidden.hiddenFound.length === 0)
  const h1 = apply(hidden, first)
  check("隐藏：未发现时也生效（伤害更高）", hits(h1.events)[0]!.amount > hits(c1.events)[0]!.amount)
  check("隐藏：第一次打中，记入 hiddenFound", h1.hiddenFound.length === 1 && h1.hiddenFound[0] === element)
  check("隐藏：同时发出一次 weakness_found 事件", h1.events.filter((e) => e.type === "weakness_found").length === 1)
  check("隐藏：日志里有提示", h1.log.some((line) => line.includes("发现隐藏弱点")))

  const next = apply(h1, { type: "endTurn" })
  const h2 = apply(next, first)
  check("隐藏：再用同一个技能（同属性）打中，不重复记录也不再发事件",
    h2.hiddenFound.length === next.hiddenFound.length && !h2.events.some((e) => e.type === "weakness_found"))
  check("隐藏：hiddenFound 没有重复项", new Set(h2.hiddenFound).size === h2.hiddenFound.length)

  const others = ALL.filter((el) => el !== element)
  const miss = apply(start(enemyWith({ hiddenWeaknesses: others })), first)
  check("隐藏：打中的属性不在隐藏列表里，不记录", miss.hiddenFound.length === 0 && !miss.events.some((e) => e.type === "weakness_found"))
}

// ---------- 4. 整场：确定性与重放 ----------
{
  const spec = enemyWith({
    weaknesses: ["light"],
    hiddenWeaknesses: ["ice", "fire"],
    weaknessWindows: [{ when: { turnMod: [3, 0] }, elements: ["thunder", "dark"] }],
  })
  let bad = 0
  let foundSomething = 0
  for (const [name, cards] of Object.entries(DECKS)) {
    for (let n = 0; n < 10; n += 1) {
      const s = `test-weakness-${name}-${n}`
      const a = playBot(spec, cards, s)
      const b = playBot(spec, cards, s)
      const live = JSON.stringify(a.state)
      const replay = replayBattle({ encounter: spec, cards, bench: BENCH, seed: s, apMax: testApMax(cards) }, a.actions)
      if (live !== JSON.stringify(b.state) || replay.invalidAt !== null || live !== JSON.stringify(replay.state)) bad += 1
      if (a.state.hiddenFound.length > 0) foundSomething += 1
    }
  }
  check("整场：20 局确定性与重放一致", bad === 0, `${bad} 局不一致`)
  check("整场：确实有局打出了隐藏弱点（测试不是空转）", foundSomething > 0)
}

// ---------- 5. 内容里的窗口弱点与教学引导 ----------
{
  const open = (id: string) => createBattle(resolveEncounter(BATTLE_CONTENT, id)!, deck, { seed: `window-${id}`, apMax: testApMax(deck) })
  check("内容：无谱拳手第 1 回合露出光破绽", open("bare-brawler").enemy.exposed.join() === "light", open("bare-brawler").enemy.exposed.join())
  check("内容：巨像节拍器第 1 拍没有破绽（第 3 拍才露出）", open("colossus-metronome").enemy.exposed.length === 0)
  check("内容：圣咏唱诗者开局蓄力不足，没有破绽", open("halo-chorister").enemy.exposed.length === 0)
  check("内容：终曲指挥带蓄力窗口弱点（金）", BATTLE_CONTENT.enemies.conductor!.weaknessWindows.some((w) => w.elements.includes("metal")))
  check("内容：教学幽灵带一个隐藏弱点（教程里有引导）", BATTLE_CONTENT.enemies["tutorial-ghost"]!.hiddenWeaknesses.length === 1)
  const covered = new Set(Object.values(BATTLE_CONTENT.enemies).map((e) => e.element))
  check("内容：敌人覆盖全部 9 种属性", ALL.every((el) => covered.has(el)), ALL.filter((el) => !covered.has(el)).join())
}

console.log(`\n${count} 项检查，未通过 ${failures.length}`)
if (failures.length > 0) process.exitCode = 1
