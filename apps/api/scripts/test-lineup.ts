// pnpm test:lineup —— 推荐上阵：每职业取最强、对口加分、稀有度权限、结果固定，以及遭遇里的推荐配置。
import { resolveEncounter, listEncounters, TUTORIAL_ENCOUNTER_ID, type Recommend } from "@choke/shared/battle/content"
import { FREE_ALLOCATION } from "@choke/shared/expedition-points"
import {
  LINEUP_ORDER,
  pickReason,
  recommendLineup,
  recommendText,
  type LineupCard,
} from "@choke/shared/lineup"
import { SKILLS } from "@choke/shared/skills"
import type { Job, Rarity } from "@choke/shared/types"

import { BATTLE_CONTENT } from "../src/content"

const failures: string[] = []
let count = 0
function check(name: string, ok: boolean, detail = "") {
  count += 1
  if (!ok) failures.push(`${name}${detail ? `：${detail}` : ""}`)
  console.log(`${ok ? "✔" : "✘"} ${name}${!ok && detail ? ` → ${detail}` : ""}`)
}

const card = (key: number, job: Job, power: number, skillIds: string[] = [], rarity: Rarity = "R", isHero = false): LineupCard => ({
  key,
  job,
  rarity,
  isHero,
  power,
  skillIds,
})
const keys = (cards: LineupCard[], recommend: Recommend, options?: Parameters<typeof recommendLineup>[2]) =>
  recommendLineup(cards, recommend, options).picks.map((p) => p.key)
const none: Recommend = { elements: [], skills: [] }
const fire: Recommend = { elements: ["fire"], skills: [] }

const fireAttacks = Object.values(SKILLS).filter((s) => s.element === "fire" && (s.power ?? 0) > 0)
const fireOf = (job: Job) => fireAttacks.find((s) => s.job === job)?.id
const fireWarrior = fireOf("warrior")!
const fireMage = fireOf("mage")!
check("前提：战士和法师各有火属性攻击技能", !!fireWarrior && !!fireMage)
const plainOf = (job: Job) => Object.values(SKILLS).find((s) => s.job === job && !s.passive && s.element !== "fire")!.id

// ---------- 1. 基本规则 ----------
const five = [card(1, "support", 900), card(2, "mage", 1200), card(3, "tank", 1000), card(4, "warrior", 1100), card(5, "mage", 800)]
check("每个职业各一张，按站位排好", keys(five, none).join() === "3,4,2,1", keys(five, none).join())
check("同职业取战力最高的", keys(five, none).includes(2) && !keys(five, none).includes(5))
check("角色标成 job", recommendLineup(five, none).picks.every((p) => p.role === "job"))
check("没有推荐时 wanted 为 false、hit 为 false", !recommendLineup(five, none).wanted && !recommendLineup(five, none).hit)

const threeJobs = [card(1, "tank", 1000), card(2, "tank", 950), card(3, "mage", 900), card(4, "tank", 700), card(5, "warrior", 600)]
check("缺一个职业就按战力补位", keys(threeJobs, none).join() === "1,2,5,3", keys(threeJobs, none).join())
const filled = recommendLineup(threeJobs, none)
check("补位的角色标成 fill", filled.picks.filter((p) => p.role === "fill").length === 1)
check("补位的是战力最高的剩余卡", filled.picks.some((p) => p.key === 2))

check("不足 4 张就有几张上几张", keys([card(1, "tank", 1), card(2, "mage", 2)], none).length === 2)
check("一张卡都没有就是空阵容", recommendLineup([], fire).picks.length === 0)
check("size 参数限制人数", keys(five, none, { size: 2 }).length === 2)
check("size 为 0 时没有人", keys(five, none, { size: 0 }).length === 0)
check("size 超过卡数也不会重复", new Set(keys(five, none, { size: 9 })).size === 5)

// ---------- 2. 对口加分 ----------
const withFire = [
  card(1, "tank", 1000),
  card(2, "warrior", 1500, [plainOf("warrior")]),
  card(3, "warrior", 900, [fireWarrior]),
  card(4, "mage", 1500, [plainOf("mage")]),
  card(5, "mage", 800, [fireMage]),
  card(6, "support", 1000),
]
const fireLineup = recommendLineup(withFire, fire)
check("对口的卡压过战力更高的卡", fireLineup.picks.map((p) => p.key).join() === "1,3,5,6", fireLineup.picks.map((p) => p.key).join())
check("有对口时 hit 为 true", fireLineup.hit && fireLineup.wanted)
check("对口的卡记下了命中的技能", fireLineup.picks.find((p) => p.key === 3)!.matches[0]?.skillId === fireWarrior)

const noFire = recommendLineup(five, fire)
check("没有对口的卡：wanted 为 true、hit 为 false", noFire.wanted && !noFire.hit)
check("没有对口的卡：照常按战力选满", noFire.picks.length === 4)
check("非攻击技能不算属性对口（威力为 0）", (() => {
  const buff = Object.values(SKILLS).find((s) => s.element === "fire" && !(s.power ?? 0))
  if (!buff) return true
  return !recommendLineup([card(1, buff.job, 100, [buff.id])], fire).hit
})())

const skillRec: Recommend = { elements: ["fire"], skills: [plainOf("tank")] }
const skillFirst = recommendLineup([card(1, "tank", 500, [plainOf("tank")]), card(2, "tank", 2000, [])], skillRec)
check("推荐技能的对口分比战力重要", skillFirst.picks[0]?.key === 1)
const skillVsElement = recommendLineup([card(1, "warrior", 500, [plainOf("warrior")]), card(2, "warrior", 500, [fireWarrior])], { elements: ["fire"], skills: [plainOf("warrior")] }, { size: 1 })
check("推荐技能比推荐属性更重", skillVsElement.picks[0]?.key === 1)
check("同一个技能不会重复计分", recommendLineup([card(1, "mage", 1, [fireMage, fireMage])], fire).picks[0]!.matches.length === 1)
check("不认识的技能 id 直接忽略", !recommendLineup([card(1, "mage", 1, ["nope_skill"])], fire).hit)

// ---------- 3. 稀有度权限 ----------
const gated = [card(1, "tank", 1000, [], "L"), card(2, "tank", 500, [], "E"), card(3, "warrior", 900, [], "Mythic")]
check("免费档挡住 L 和 Mythic", keys(gated, none).join() === "2", keys(gated, none).join())
check("本体卡不受稀有度限制", keys([card(1, "tank", 100, [], "Prismatic", true)], none).join() === "1")
check("点了 L 之后 L 能上", keys(gated, none, { allocation: { ...FREE_ALLOCATION, maxRarity: "L" } }).includes(1))
check("点了 L 之后 Mythic 还是上不了", !keys(gated, none, { allocation: { ...FREE_ALLOCATION, maxRarity: "L" } }).includes(3))
check("默认人数等于分配的卡槽数", keys(Array.from({ length: 10 }, (_, i) => card(i + 1, LINEUP_ORDER[i % 4]!, 100 + i)), none, { allocation: { ...FREE_ALLOCATION, slots: 6 } }).length === 6)

// ---------- 4. 结果固定 ----------
const tied = [card(7, "tank", 1000), card(3, "tank", 1000), card(5, "tank", 1000, [], "E")]
check("战力相同看稀有度", keys(tied, none, { size: 1 })[0] === 5)
check("战力和稀有度都相同看 key", keys([card(7, "tank", 1000), card(3, "tank", 1000)], none, { size: 1 })[0] === 3)
check("输入顺序不影响结果", keys(withFire, fire).join() === keys([...withFire].reverse(), fire).join())
check("重复调用结果一样", JSON.stringify(recommendLineup(withFire, fire)) === JSON.stringify(recommendLineup(withFire, fire)))
const before = JSON.stringify(withFire)
recommendLineup(withFire, fire)
check("不会改动传进来的卡", JSON.stringify(withFire) === before)

// ---------- 5. 文字 ----------
const reasonFire = pickReason(fireLineup.picks.find((p) => p.key === 3)!)
check("理由里有职业和技能名", reasonFire.includes("战士") && reasonFire.includes(SKILLS[fireWarrior]!.name), reasonFire)
check("没对口时说明是职业里最强", pickReason(recommendLineup(five, none).picks[0]!).includes("最强"))
check("补位的理由说补位", pickReason(filled.picks.find((p) => p.role === "fill")!).includes("补位"))
check("推荐文字：属性", recommendText(fire) === "推荐：火属性攻击", recommendText(fire))
check("推荐文字：技能名", recommendText(skillRec).includes(SKILLS[plainOf("tank")]!.name))
check("推荐文字：空推荐", recommendText(none) === "没有特别的推荐")

// ---------- 6. 遭遇里的推荐配置 ----------
const tutorial = resolveEncounter(BATTLE_CONTENT, TUTORIAL_ENCOUNTER_ID)!
check("教学战推荐火属性", tutorial.recommend.elements.join() === "fire" && tutorial.recommend.skills.length === 0)
const summaries = listEncounters(BATTLE_CONTENT)
const listed = summaries.filter((s) => s.listed)
check("没写推荐的遭遇按公开弱点推荐", listed.every((s) => s.recommend.elements.join() === s.weaknesses.join()))
check("没写推荐的遭遇不泄露隐藏弱点", listed.every((s) => {
  const enemy = BATTLE_CONTENT.enemies[BATTLE_CONTENT.encounters[s.id]!.enemy]!
  return enemy.hiddenWeaknesses.every((el) => !s.recommend.elements.includes(el))
}))
check("遭遇详情和列表里的推荐一致", listed.every((s) => JSON.stringify(resolveEncounter(BATTLE_CONTENT, s.id)!.recommend) === JSON.stringify(s.recommend)))

console.log(`\n${count} 项检查，未通过 ${failures.length}`)
if (failures.length > 0) {
  console.log(failures.map((f) => `  - ${f}`).join("\n"))
  process.exit(1)
}
