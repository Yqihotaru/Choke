import { ledgerEntries } from "./db/schema"
import type { Tx } from "./tx"

export type LedgerKind = "coins" | "essence" | "stamina" | "item" | "pack" | "card"

export interface LedgerEntryInput {
  kind: LedgerKind
  /** 物品 id、卡包 id、卡 id；货币留空 */
  ref?: string
  delta: number
  userCardId?: number
}

export interface LedgerSource {
  /** 来源，如 mail-claim、mail-auto */
  source: string
  sourceRef?: string
}

/** 在发放 / 扣除的同一个事务里调用，流水和余额一起提交或回滚；delta 为 0 的不记 */
export async function recordLedger(
  tx: Tx,
  userId: string,
  entries: readonly LedgerEntryInput[],
  origin: LedgerSource,
) {
  const rows = entries
    .filter((entry) => entry.delta !== 0)
    .map((entry) => ({
      userId,
      kind: entry.kind,
      ref: entry.ref ?? "",
      delta: entry.delta,
      source: origin.source,
      sourceRef: origin.sourceRef ?? null,
      userCardId: entry.userCardId ?? null,
    }))
  if (rows.length > 0) await tx.insert(ledgerEntries).values(rows)
}
