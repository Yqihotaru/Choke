/** 流水：玩家所有货币、道具、卡包、卡牌的增减记录 */
export const LEDGER_KINDS = ["coins", "essence", "stamina", "item", "pack", "card"] as const
export type LedgerKind = (typeof LEDGER_KINDS)[number]

export const LEDGER_KIND_LABEL: Readonly<Record<LedgerKind, string>> = {
  coins: "金币",
  essence: "闪卡精华",
  stamina: "体力",
  item: "道具",
  pack: "卡包",
  card: "卡牌",
}

export interface LedgerEntryView {
  id: number
  kind: LedgerKind
  /** 显示名：金币、道具名、卡包名、卡名 */
  label: string
  /** 卡牌才有 */
  rarity?: string
  /** 正数是得到，负数是失去 */
  delta: number
  /** 来源的中文名，如"开包""市场购买" */
  sourceLabel: string
  createdAt: string
}

export interface LedgerPage {
  entries: LedgerEntryView[]
  /** 还有更早的记录；用最后一条的 id 作为下一页的 before */
  hasMore: boolean
}

export const LEDGER_PAGE_SIZE = 50
