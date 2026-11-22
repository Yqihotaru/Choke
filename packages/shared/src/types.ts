/** 品质从低到高；界面的筛选、排序、概率展示都从这里取顺序。 */
export const RARITIES = ["C", "UC", "R", "E", "L", "Radiant", "Prismatic"] as const

export type Rarity = (typeof RARITIES)[number]

/** 职业四大类；十四子职业后续在此扩展 */
export type Job = "tank" | "warrior" | "mage" | "support"

/** 九属性，挂在技能上，不挂在卡上 */
export const ELEMENTS = ["metal", "wood", "earth", "ice", "fire", "thunder", "light", "dark", "physical"] as const
export type Element = (typeof ELEMENTS)[number]

export type Mod =
  | "HD"
  | "HR"
  | "DT"
  | "FL"
  | "NC"
  | "EZ"
  | "HT"
  | "NF"
  | "SD"
  | "PF"
  | "SO"
  | "CL"

export interface CardSkill {
  name: string
  element: Element
  /** 行动点消耗 */
  ap: number
  /** 法系才有的 MP 消耗 */
  mp?: number
  /** 被动技能：AP 恒 0，且不显示 MP */
  passive?: boolean
}

/**
 * 卡面上的技能引用：只存技能 id，行为与数值由技能注册表提供。
 * `name` 可选，用于保留老卡的显示名（新卡直接显示注册表里的名字）。
 */
export interface CardSkillRef {
  skillId: string
  name?: string
  /** 技能等级，预留给技能升级 */
  level?: number
}

export interface CardFaceData {
  id: string
  name: string
  rarity: Rarity
  job: Job
  level: number
  mods: Mod[]
  /** 普通卡 0–6；本体卡 0–12（每颗星两档） */
  constellation: number
  no: number
  total: number
  /** 实例序号：这张卡被发出的第几张；没有实例（图鉴、预览）时缺省 */
  serial?: number
  /** 这张卡累计发行多少张 */
  pulled?: number
  skills: CardSkill[]
  /** 技能引用：存在时优先于 skills，用于把技能与卡面解耦 */
  skillRefs?: CardSkillRef[]
  /** 立绘；缺省时使用占位图。玩家卡用头像地址，由浏览器随看随载。 */
  art?: string
  /** 个人主页 banner。没有地址就不要请求。 */
  banner?: string
  /** 卡面名字链到本人 osu! 主页 */
  profileUrl?: string
  /** 玩家卡身份信息 */
  country?: string
  globalRank?: number | null
  pp?: number | null
  isHero?: boolean
  /** 闪卡：仅实例属性，不改变卡池稀有度 */
  foil?: boolean
  /** 实例个体值，千分比：970–1030，默认 1000 */
  rollBp?: number
  /** 镜像卡：本体卡的复制体，单独卡型 */
  isMirror?: boolean
}


export type StarState = "empty" | "copper" | "prism"
