// pnpm test:difficulty —— 难度系统的纯函数：档位换算、血量与掉落放大、日常图危险路线、通关目标。不碰数据库。
import assert from "node:assert/strict"

import { resolveEncounter } from "@choke/shared/battle/content"
import { difficultySchema, mapGeneratorSchema, type MapDef, type RewardTable } from "@choke/shared/expedition/content"
import {
  DEFAULT_HP_MULT,
  DEFAULT_LOOT_MULT,
  DEFAULT_THRESHOLDS,
  MAX_THREAT,
  clampThreat,
  difficultyOf,
  difficultyStatus,
  nextTierAt,
  objectiveMet,
  objectiveText,
  scaleEncounterHp,
  scaleReward,
  tierOf,
} from "@choke/shared/expedition/difficulty"
import { generateMapFromTemplate } from "@choke/shared/expedition/generator"
import { rollRewardTable } from "@choke/shared/expedition/loot"

import { BATTLE_CONTENT, WORLD_CONTENT } from "../src/content"

let count = 0
function check(name: string, fn: () => void) {
  fn()
  count += 1
  console.log(`✔ ${name}`)
}

const base = { thresholds: DEFAULT_THRESHOLDS }

check("档位：按阈值换算，刚好等于阈值就升档", () => {
  assert.equal(tierOf(0, base), 1)
  assert.equal(tierOf(2, base), 1)
  assert.equal(tierOf(3, base), 2)
  assert.equal(tierOf(5, base), 2)
  assert.equal(tierOf(6, base), 3)
  assert.equal(tierOf(10, base), 4)
  assert.equal(tierOf(15, base), 5)
  assert.equal(tierOf(MAX_THREAT, base), 5)
})

check("下一档所需威胁值：最高档为 null", () => {
  assert.equal(nextTierAt(0, base), 3)
  assert.equal(nextTierAt(3, base), 6)
  assert.equal(nextTierAt(14, base), 15)
  assert.equal(nextTierAt(15, base), null)
})

check("威胁值夹在 0 到上限之间", () => {
  assert.equal(clampThreat(-5), 0)
  assert.equal(clampThreat(1000), MAX_THREAT)
  assert.equal(clampThreat(4.4), 4)
})

check("没写难度配置的地图用默认值：全程 1 档、倍率 1", () => {
  const status = difficultyStatus({}, 0)
  assert.equal(status.tier, 1)
  assert.equal(status.hpMult, 1)
  assert.equal(status.lootMult, 1)
  assert.deepEqual(difficultyOf({}).hpMult, DEFAULT_HP_MULT)
  assert.deepEqual(difficultyOf({}).lootMult, DEFAULT_LOOT_MULT)
})

check("地图可以覆盖阈值和倍率，lootMult 全写 1 就是不放大掉落", () => {
  const map = { difficulty: difficultySchema.parse({ thresholds: [1, 2, 3, 4], lootMult: [1, 1, 1, 1, 1] }) }
  const status = difficultyStatus(map, 3)
  assert.equal(status.tier, 4)
  assert.equal(status.lootMult, 1)
  assert.equal(status.hpMult, DEFAULT_HP_MULT[3])
})

check("难度配置校验：阈值必须递增、血量倍率不能随档位下降、数量要对", () => {
  assert.equal(difficultySchema.safeParse({ thresholds: [3, 3, 6, 9] }).success, false)
  assert.equal(difficultySchema.safeParse({ thresholds: [3, 6, 9] }).success, false)
  assert.equal(difficultySchema.safeParse({ hpMult: [1, 1.5, 1.2, 2, 3] }).success, false)
  assert.equal(difficultySchema.safeParse({ hpMult: [0.5, 1, 1, 1, 1] }).success, false)
  assert.equal(difficultySchema.safeParse({ extra: 1 }).success, false)
  assert.equal(difficultySchema.safeParse({}).success, true)
})

check("敌人血量放大：倍率 1 原样返回，否则四舍五入，不改别的面板", () => {
  const spec = resolveEncounter(BATTLE_CONTENT, "ghost")!
  assert.equal(scaleEncounterHp(spec, 1), spec)
  const scaled = scaleEncounterHp(spec, 1.7)
  assert.equal(scaled.enemy.stats.hp, Math.round(spec.enemy.stats.hp * 1.7))
  assert.equal(scaled.enemy.stats.atk, spec.enemy.stats.atk)
  assert.equal(scaled.enemy.stats.def, spec.enemy.stats.def)
  assert.equal(spec.enemy.stats.hp, BATTLE_CONTENT.enemies.ghost!.stats.hp, "不改原数据")
})

check("奖励放大：金币、精华、经验、物品、卡包放大；整卡和体力不动", () => {
  const out = scaleReward(
    {
      coins: 100,
      essence: 3,
      playerExp: 30,
      stamina: 10,
      items: [{ itemId: "exp-small", count: 2 }],
      packs: [{ pool: "golden", count: 1 }],
      cards: [{ cardId: "x", count: 1 }],
    },
    1.9,
  )
  assert.equal(out.coins, 190)
  assert.equal(out.essence, 6)
  assert.equal(out.playerExp, 57)
  assert.equal(out.stamina, 10)
  assert.equal(out.items![0]!.count, 4)
  assert.equal(out.packs![0]!.count, 2)
  assert.equal(out.cards![0]!.count, 1)
  assert.equal(scaleReward({ coins: 1 }, 1.4).coins, 1, "最少还是 1")
})

check("掉落倍率只乘固定和随机，不乘星级加成和首通奖励", () => {
  const table: RewardTable = {
    fixed: { coins: 100 },
    random: { rolls: 2, entries: [{ weight: 1, reward: { coins: 10 } }] },
    starBonus: { "1": { coins: 7 } },
    firstClear: { coins: 500 },
  }
  const plain = rollRewardTable(table, { seed: "s", stream: "t", stars: 1, firstClear: true })
  const scaled = rollRewardTable(table, { seed: "s", stream: "t", stars: 1, firstClear: true, lootMult: 2 })
  assert.equal(plain.coins, 100 + 20 + 7 + 500)
  assert.equal(scaled.coins, 200 + 40 + 7 + 500)
})

check("通关目标：档位 ≥ N 或标记；文字没写 label 时自动生成", () => {
  assert.equal(objectiveMet({ tierAtLeast: 3 }, { tier: 3, flags: [] }), true)
  assert.equal(objectiveMet({ tierAtLeast: 3 }, { tier: 2, flags: [] }), false)
  assert.equal(objectiveMet({ flag: "blessed" }, { tier: 1, flags: ["blessed"] }), true)
  assert.equal(objectiveMet({ flag: "blessed" }, { tier: 5, flags: [] }), false)
  assert.equal(objectiveText({ tierAtLeast: 3 }), "难度 3 档及以上通关")
  assert.equal(objectiveText({ flag: "blessed", label: "祝福" }), "祝福")
})

const template = (danger?: { rate: number; threat: number }) =>
  mapGeneratorSchema.parse({
    layers: 8,
    branchRate: 1,
    battleRewards: "test-battle",
    bossRewards: "test-boss",
    battles: [{ encounter: "ghost" }],
    bosses: [{ encounter: "colossus-metronome" }],
    chests: [{ rewards: "test-chest" }],
    ...(danger ? { danger } : {}),
  })

const dangerNodes = (nodes: MapDef["nodes"]) => Object.entries(nodes).filter(([, node]) => node.threat)

check("日常图：不写 danger 时生成结果和以前完全一样（没有任何威胁格）", () => {
  const plain = generateMapFromTemplate(template(), "seed-a")
  assert.equal(dangerNodes(plain.nodes).length, 0)
  assert.deepEqual(plain, generateMapFromTemplate(template(), "seed-a"))
})

check("日常图：危险路线概率 1 时每个分叉层的下面那个节点都是危险战斗，带威胁、标题和连线", () => {
  const { nodes } = generateMapFromTemplate(template({ rate: 1, threat: 3 }), "seed-a")
  const forks = Object.keys(nodes).filter((id) => id.endsWith("b"))
  assert.ok(forks.length >= 3, "branchRate 1 时中间层都分叉")
  for (const id of forks) {
    const node = nodes[id]!
    assert.equal(node.type, "battle")
    assert.equal(node.threat, 3)
    assert.equal(node.title, "危险路线")
    assert.ok(node.next.length >= 1)
  }
  assert.equal(dangerNodes(nodes).length, forks.length)
  assert.deepEqual(nodes, generateMapFromTemplate(template({ rate: 1, threat: 3 }), "seed-a").nodes, "同种子同一张图")
})

check("日常图：危险路线概率 0 时没有威胁格", () => {
  const { nodes } = generateMapFromTemplate(template({ rate: 0, threat: 3 }), "seed-a")
  assert.equal(dangerNodes(nodes).length, 0)
})

check("内容里写 danger 的掉落表必须存在；设置不合法被拒", () => {
  assert.equal(mapGeneratorSchema.safeParse({ ...template(), danger: { rate: 2, threat: 3 } }).success, false)
  assert.equal(mapGeneratorSchema.safeParse({ ...template(), danger: { rate: 0.5, threat: 0 } }).success, false)
  assert.equal(mapGeneratorSchema.safeParse({ ...template(), danger: { rate: 0.5, threat: 3, hp: 5 } }).success, false)
})

check("现有内容里的测试地图：威胁之路带事件、危险路线和两个通关目标", () => {
  const map = WORLD_CONTENT.maps["test-threat"]!
  assert.equal(map.objectives?.length, 2)
  assert.equal(map.nodes.n3a!.threat, 4)
  assert.equal(map.nodes.n2!.type, "event")
  assert.ok(WORLD_CONTENT.events["test-shrine"])
})

console.log(`\n${count} 项检查通过`)
