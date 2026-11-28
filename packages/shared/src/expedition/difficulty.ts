import type { EncounterSpec } from "../battle/content"
import type { MapDef, Reward } from "./content"

/**
 * 出征难度（纯函数，服务端和前端共用）：
 * - 威胁值（threat）只在大地图的格子和事件选项上变动，普通战斗打赢不涨；
 * - 档位 = 威胁值按阈值换算，1–5 档，战斗中不变，只在走进格子 / 做事件选择时变；
 * - 第一版每档放大敌人血量；掉落倍率默认全 1（不放大），需要「高难多拿」的图在地图配置里自己写 lootMult。
 * 地图配置可以整体覆盖；不写就用下面的默认值，没有任何格子带威胁的地图永远是 1 档、倍率 1。
 */

export const TIER_COUNT = 5
export const MAX_THREAT = 99

export const DEFAULT_THRESHOLDS = [3, 6, 10, 15] as const
export const DEFAULT_HP_MULT = [1, 1.3, 1.7, 2.2, 3] as const
export const DEFAULT_LOOT_MULT = [1, 1, 1, 1, 1] as const

export interface Difficulty {
  startThreat: number
  /** 威胁值达到第 i 个数就升到 i+2 档（4 个阈值 → 5 档） */
  thresholds: readonly number[]
  hpMult: readonly number[]
  lootMult: readonly number[]
}

export function difficultyOf(map: Pick<MapDef, "difficulty">): Difficulty {
  return (
    map.difficulty ?? {
      startThreat: 0,
      thresholds: DEFAULT_THRESHOLDS,
      hpMult: DEFAULT_HP_MULT,
      lootMult: DEFAULT_LOOT_MULT,
    }
  )
}

export function clampThreat(threat: number): number {
  return Math.min(MAX_THREAT, Math.max(0, Math.round(threat)))
}

/** 威胁值 → 档位（1–5） */
export function tierOf(threat: number, difficulty: Pick<Difficulty, "thresholds">): number {
  return 1 + difficulty.thresholds.filter((at) => threat >= at).length
}

/** 下一档要多少威胁值；已经最高档返回 null */
export function nextTierAt(threat: number, difficulty: Pick<Difficulty, "thresholds">): number | null {
  return difficulty.thresholds.find((at) => threat < at) ?? null
}

/** 给前端和日志用的一份当前难度小结 */
export interface DifficultyStatus {
  threat: number
  tier: number
  hpMult: number
  lootMult: number
  /** 升到下一档需要的威胁值；已是最高档为 null */
  nextTierAt: number | null
  thresholds: number[]
}

export function difficultyStatus(map: Pick<MapDef, "difficulty">, threat: number): DifficultyStatus {
  const difficulty = difficultyOf(map)
  const tier = tierOf(threat, difficulty)
  return {
    threat,
    tier,
    hpMult: difficulty.hpMult[tier - 1] ?? 1,
    lootMult: difficulty.lootMult[tier - 1] ?? 1,
    nextTierAt: nextTierAt(threat, difficulty),
    thresholds: [...difficulty.thresholds],
  }
}

/**
 * 按倍率放大这场遭遇敌人的血量。进入战斗节点时做一次，结果存进战斗快照，
 * 所以重放、断线恢复、战败重试看到的都是同一份血量。倍率 1 原样返回。
 */
export function scaleEncounterHp(spec: EncounterSpec, mult: number): EncounterSpec {
  if (mult === 1) return spec
  return { ...spec, enemy: { ...spec.enemy, stats: { ...spec.enemy.stats, hp: Math.max(1, Math.round(spec.enemy.stats.hp * mult)) } } }
}

const scaleCount = (n: number, mult: number) => Math.max(1, Math.round(n * mult))

/**
 * 按倍率放大一份奖励的主产：金币、精华、玩家经验、物品、卡包。
 * 整卡和体力不放大（它们不是「刷」出来的量）。倍率 1 原样返回。
 */
export function scaleReward(reward: Reward, mult: number): Reward {
  if (mult === 1) return reward
  const out: Reward = { ...reward }
  for (const key of ["coins", "essence", "playerExp", "cardExp", "expPool"] as const) {
    if (reward[key]) out[key] = scaleCount(reward[key]!, mult)
  }
  if (reward.items) out.items = reward.items.map((item) => ({ ...item, count: scaleCount(item.count, mult) })) as Reward["items"]
  if (reward.packs) out.packs = reward.packs.map((pack) => ({ ...pack, count: scaleCount(pack.count, mult) }))
  return out
}

/** 地图的通关目标是否达成：档位 ≥ N，或拿到某个标记 */
export function objectiveMet(
  objective: NonNullable<MapDef["objectives"]>[number],
  state: { tier: number; flags: readonly string[] },
): boolean {
  return "tierAtLeast" in objective ? state.tier >= objective.tierAtLeast : state.flags.includes(objective.flag)
}

export function objectiveText(objective: NonNullable<MapDef["objectives"]>[number]): string {
  if (objective.label) return objective.label
  return "tierAtLeast" in objective ? `难度 ${objective.tierAtLeast} 档及以上通关` : `拿到标记「${objective.flag}」后通关`
}
