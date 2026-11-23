import type { BattleAction } from "../battle/actions"
import type { EncounterSpec } from "../battle/content"
import type { ExpeditionAllocation } from "../expedition-points"
import type { CardFaceData } from "../types"
import type { MapDef, Reward, StoryLine } from "./content"

/** 接口返回的出征视图：前端只靠它画界面，规则全在服务端 */

/** 进行中 / 挂起（保存并退出）算「未结束」；其余是终态 */
export type ExpeditionStatus = "active" | "suspended" | "settled" | "abandoned" | "expired"

/** 怎么结束的 */
export type ExpeditionEnd = "cleared" | "early" | "abandoned" | "expired"

export interface ExpeditionPoolCard {
  userCardId: number
  face: CardFaceData
}

export type BattleStatus = "preparing" | "fighting" | "won" | "lost"

export interface ExpeditionBattleView {
  nodeId: string
  status: BattleStatus
  encounter: EncounterSpec
  /** 这场战斗的种子：重试不换 */
  seed: string
  apMax: number
  /** 开场时队伍血量占最大生命的比例 */
  hpRatioStart: number
  /** 上场卡的 userCardId，按槽位顺序；还没选阵容时为空 */
  lineup: number[]
  bench: number[]
  /** 到现在为止服务端认可的全部操作；前端拿它重放出当前局面 */
  actions: BattleAction[]
  retries: number
  /** 通关后的星数；没打赢是 null */
  stars: number | null
}

export interface ExpeditionStoryView {
  nodeId: string
  title: string
  lines: StoryLine[]
}

export interface ExpeditionSettlement {
  end: ExpeditionEnd
  /** 实际发到账上的奖励（到期结算时附件走邮件，playerExp 直接加） */
  rewards: Reward
  stars: number
  maxStars: number
  /** 这次出征体力是不是扣掉了（拿到东西才扣） */
  staminaSpent: number
  staminaRefunded: number
  /** 到期结算时，奖励是通过邮件发的 */
  viaMail: boolean
}

export interface ExpeditionView {
  id: number
  status: ExpeditionStatus
  mapId: string
  map: MapDef
  seed: string
  allocation: ExpeditionAllocation
  pool: ExpeditionPoolCard[]
  /** 现在站在哪个节点 */
  position: string
  /** 这个节点处理完了没有（打赢了 / 剧情看完了）；没处理完不能往下走 */
  nodeDone: boolean
  /** 能走的下一步（已经按标记过滤） */
  availableNext: string[]
  /** 走到了终点并且处理完：可以按「通关结算」 */
  atEnd: boolean
  flags: string[]
  /** 队伍血量占最大生命的比例，跨战斗保留 */
  hpRatio: number
  /** 到现在攒下的奖励（结算时一次性发） */
  pending: Reward
  stars: number
  maxStars: number
  staminaCost: number
  startedAt: string
  expiresAt: string
  battle: ExpeditionBattleView | null
  story: ExpeditionStoryView | null
  settlement: ExpeditionSettlement | null
}
