/** 卡包/卡池的唯一权威配置。前端通过 GET /config 读取，不再维护第二份权重。 */
/** 概率口径：Design/经济与养成系统 v0.3.md §4.2。卡包无保底（§11.1 方案 A）。 */
export const PACKS = {
  normal: {
    name: "普通卡包",
    short: "普通",
    color: "#E5484D",
    weights: { C: 57, UC: 26, R: 11, E: 5, L: 0.85, Radiant: 0.13, Prismatic: 0.02 },
    foilRate: 0.03,
  },
  idle: {
    name: "挂机卡包",
    short: "挂机",
    color: "#3CBADB",
    weights: { C: 62, UC: 26, R: 9, E: 2.8, L: 0.2 },
    foilRate: 0.012,
  },
  golden: {
    name: "黄金卡包",
    short: "黄金",
    color: "#FFC24B",
    weights: { C: 8, UC: 30, R: 30, E: 28.45, L: 3, Radiant: 0.5, Prismatic: 0.05 },
    foilRate: 0.05,
  },
  radiant: {
    name: "璀璨卡包",
    short: "璀璨",
    color: "#B98CFF",
    weights: { UC: 10.5, R: 22, E: 30, L: 25, Radiant: 12, Prismatic: 0.5 },
    foilRate: 0.08,
  },
  sky: {
    name: "天穹卡包",
    short: "天穹",
    color: "#21E985",
    weights: { R: 12, E: 22, L: 40, Radiant: 25, Prismatic: 1 },
    foilRate: 0.1,
  },
  prism: {
    name: "棱彩卡包",
    short: "棱彩",
    color: "#F4F4F6",
    weights: { E: 3, L: 30, Radiant: 55, Prismatic: 12 },
    foilRate: 0.15,
  },
  /** 一次性活动包：新手 30 包。概率同普通包，最后一包兜底一张 L（见 STARTER_GUARANTEE）。 */
  starter: {
    name: "新手卡包",
    short: "新手",
    color: "#FF66AA",
    weights: { C: 57, UC: 26, R: 11, E: 5, L: 0.85, Radiant: 0.13, Prismatic: 0.02 },
    foilRate: 0.03,
  },
} as const

export type PackId = keyof typeof PACKS

export const PACK_SIZE = 5

/** 活动包：只靠发放获得，前端库存为 0 时整行隐藏。以后的活动包加进这里即可。 */
export const EVENT_PACKS: readonly PackId[] = ["starter"]

export const STARTER_PACKS = {
  starter: 30,
  mystery: 1,
} as const

/** 新手包兜底：开最后一包时，如果新手包里还没出过 L 及以上，最后一张改成 L。 */
export const STARTER_GUARANTEE = { pool: "starter", rarity: "L" } as const

/** 神秘卡包不在公共卡池里，单独一个 id/名字。 */
export const MYSTERY_PACK = { id: "mystery", name: "神秘卡包" } as const
