import { and, desc, eq, inArray, lt } from "drizzle-orm"

import { ITEMS, isItemId } from "@choke/shared/items"
import {
  LEDGER_KIND_LABEL,
  LEDGER_PAGE_SIZE,
  type LedgerEntryView,
  type LedgerKind,
  type LedgerPage,
} from "@choke/shared/ledger"

import { db } from "./db/client"
import { cards, ledgerEntries } from "./db/schema"
import { MYSTERY_PACK, PACKS } from "./gacha/packs"
import type { Tx } from "./tx"

export type { LedgerKind }

export interface LedgerEntryInput {
  kind: LedgerKind
  /** 物品 id、卡包 id、卡 id；货币留空 */
  ref?: string
  delta: number
  userCardId?: number
}

export interface LedgerSource {
  /** 来源，如 mail-claim、pack-open；中文名见 SOURCE_LABELS */
  source: string
  sourceRef?: string
}

export const SOURCE_LABELS: Readonly<Record<string, string>> = {
  "mail-claim": "邮件领取",
  "mail-auto": "邮件到期自动领取",
  "pack-open": "开包",
  starter: "新手礼包",
  "hero-claim": "领取本体卡",
  dungeon: "副本",
  expedition: "远征",
  "expedition-refund": "远征体力退回",
  feed: "喂养",
  fuse: "融合",
  dismantle: "分解",
  foil: "闪卡强化",
  "market-buy": "市场购买",
  "market-sell": "市场出售",
}

/** 在发放 / 扣除的同一个事务里调用，流水和余额一起提交或回滚；delta 为 0 的不记 */
export async function recordLedger(
  tx: Tx | typeof db,
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

function packName(pool: string): string {
  if (pool === MYSTERY_PACK.id) return MYSTERY_PACK.name
  return (PACKS as Record<string, { name: string }>)[pool]?.name ?? pool
}

/** 玩家自己的流水，新的在前；用 before（上一页最后一条的 id）翻页，kind 可只看某一类 */
export async function listLedger(
  userId: string,
  options: { kind?: LedgerKind; before?: number; limit?: number } = {},
): Promise<LedgerPage> {
  const limit = Math.min(Math.max(options.limit ?? LEDGER_PAGE_SIZE, 1), 100)
  const rows = await db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        options.kind ? eq(ledgerEntries.kind, options.kind) : undefined,
        options.before ? lt(ledgerEntries.id, options.before) : undefined,
      ),
    )
    .orderBy(desc(ledgerEntries.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)

  const cardIds = [...new Set(page.filter((row) => row.kind === "card").map((row) => row.ref))]
  const cardInfo = new Map<string, { name: string; rarity: string }>()
  if (cardIds.length > 0) {
    const found = await db
      .select({ id: cards.id, name: cards.name, rarity: cards.rarity })
      .from(cards)
      .where(inArray(cards.id, cardIds))
    for (const row of found) cardInfo.set(row.id, row)
  }

  const entries = page.map((row): LedgerEntryView => {
    const kind = row.kind as LedgerKind
    const base = {
      id: row.id,
      kind,
      delta: row.delta,
      sourceLabel: SOURCE_LABELS[row.source] ?? row.source,
      createdAt: row.createdAt.toISOString(),
    }
    if (kind === "card") {
      const info = cardInfo.get(row.ref)
      return { ...base, label: info?.name ?? row.ref, ...(info ? { rarity: info.rarity } : {}) }
    }
    if (kind === "item") return { ...base, label: isItemId(row.ref) ? ITEMS[row.ref].name : row.ref }
    if (kind === "pack") return { ...base, label: packName(row.ref) }
    return { ...base, label: LEDGER_KIND_LABEL[kind] }
  })
  return { entries, hasMore: rows.length > limit }
}
