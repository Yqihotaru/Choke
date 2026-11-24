import type { Job, Mod } from "./types"

/** 吞噬共鸣属性：与设计文档 v0.3 §7.5 一致 */
export const RESONANCE_ATTRIBUTES = ["ATK", "DEF", "SPD", "CRIT"] as const
export type ResonanceAttribute = (typeof RESONANCE_ATTRIBUTES)[number]

/** 每次共鸣固定 +50 bp（+0.5%） */
export const RESONANCE_VALUE_BP = 50
/** 单属性最多叠加 3 次（+1.5%） */
export const RESONANCE_ATTR_CAP = 3
/** 总共鸣槽位上限 8 个（+4.0%） */
export const RESONANCE_TOTAL_CAP = 8

const JOB_PRIMARY_ATTR: Record<Job, ResonanceAttribute> = {
  tank: "DEF",
  warrior: "ATK",
  mage: "CRIT",
  support: "SPD",
}

const MOD_ATTR_OVERRIDE: Partial<Record<Mod, ResonanceAttribute>> = {
  DT: "SPD",
  NC: "SPD",
  HD: "CRIT",
  FL: "CRIT",
  HR: "ATK",
  PF: "ATK",
  EZ: "DEF",
  HT: "DEF",
  NF: "DEF",
  SD: "DEF",
}

/** 根据镜像卡的职业和第一个 MOD 计算吞噬后提供的共鸣属性 */
export function resonanceAttributeOf(job: Job, mods: readonly Mod[]): ResonanceAttribute {
  const firstMod = mods[0]
  if (firstMod) {
    const override = MOD_ATTR_OVERRIDE[firstMod]
    if (override) return override
  }
  return JOB_PRIMARY_ATTR[job]
}

export interface ResonanceRecord {
  sourceCardId: string
  attribute: ResonanceAttribute
  valueBp: number
  slot: number
}

export interface ResonanceSummary {
  totalBpByAttr: Record<ResonanceAttribute, number>
  countsByAttr: Record<ResonanceAttribute, number>
  totalSlots: number
}

export function summarizeResonance(records: readonly ResonanceRecord[]): ResonanceSummary {
  const totalBpByAttr: Record<ResonanceAttribute, number> = { ATK: 0, DEF: 0, SPD: 0, CRIT: 0 }
  const countsByAttr: Record<ResonanceAttribute, number> = { ATK: 0, DEF: 0, SPD: 0, CRIT: 0 }
  for (const r of records) {
    totalBpByAttr[r.attribute] += r.valueBp
    countsByAttr[r.attribute] += 1
  }
  return {
    totalBpByAttr,
    countsByAttr,
    totalSlots: records.length,
  }
}
