/** 卡包/卡池的唯一权威配置。前端通过 GET /packs 读取，不再维护第二份权重。 */
export const PACKS = {
  normal: {
    name: "普通卡包",
    short: "普通",
    color: "#E5484D",
    weights: { C: 45, UC: 24, R: 15, E: 10, L: 4, Radiant: 1.92, Prismatic: 0.08 },
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
    weights: { C: 12, UC: 32, R: 28, E: 18, L: 8, Radiant: 1.92, Prismatic: 0.08 },
    foilRate: 0.05,
  },
  radiant: {
    name: "璀璨卡包",
    short: "璀璨",
    color: "#B98CFF",
    weights: { UC: 15, R: 25, E: 30, L: 22, Radiant: 7.8, Prismatic: 0.2 },
    foilRate: 0.08,
  },
  sky: {
    name: "天穹卡包",
    short: "天穹",
    color: "#21E985",
    weights: { R: 15, E: 30, L: 35, Radiant: 19.2, Prismatic: 0.8 },
    foilRate: 0.1,
  },
  prism: {
    name: "棱彩卡包",
    short: "棱彩",
    color: "#F4F4F6",
    weights: { E: 10, L: 34, Radiant: 50, Prismatic: 6 },
    foilRate: 0.15,
  },
} as const

export type PackId = keyof typeof PACKS

export const PITY = {
  threshold: 60,
  rarity: "L",
} as const

export const PACK_SIZE = 5

export const STARTER_PACKS = {
  normal: 30,
  mystery: 1,
} as const
