/** 品质从低到高；界面的筛选、排序、概率展示都从这里取顺序。 */
export const RARITIES = ["C", "UC", "R", "E", "L", "Mythic", "Prismatic"] as const

export type Rarity = (typeof RARITIES)[number]

/** 职业四大类；十四子职业后续在此扩展 */
export type Job = "tank" | "warrior" | "mage" | "support"

/** 九属性，挂在技能上，不挂在卡上 */
export const ELEMENTS = ["metal", "wood", "earth", "ice", "fire", "thunder", "light", "dark", "physical"] as const
export type Element = (typeof ELEMENTS)[number]

export const ELEMENT_LABEL: Record<Element, string> = {
  metal: "金",
  wood: "木",
  earth: "土",
  ice: "冰",
  fire: "火",
  thunder: "雷",
  light: "光",
  dark: "暗",
  physical: "物",
}

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
  /** 技能 id：行为与数值一律取技能注册表 */
  id: string
  name: string
  element: Element
  /** 行动点消耗 */
  ap: number
  /** 被动技能：AP 恒 0 */
  passive?: boolean
}

/**
 * 卡的技能引用：只存技能 id，名字、行为与数值由技能注册表提供。
 */
export interface CardSkillRef {
  skillId: string
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
