import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react"

import { playSfx } from "@/audio/sfx"
import { GameCardFace } from "@/card/GameCardFace"
import { RARITY_LABEL } from "@/card/data"
import { expToNext, isHeroCardId, levelCap } from "@/card/progression"
import { RARITIES } from "@/card/types"

import {
  ApiError,
  dismantleCardsBatch,
  fetchRecycleQuota,
  fetchUserCards,
  recycleCardsBatch,
  toFace,
  type ApiUserCard,
  type CardSort,
  type RecycleQuota,
} from "@/desk/session/api"
import { NPC_RECYCLE_DAILY_LIMIT, npcRecycleValue } from "@choke/shared/economy"
import { ITEMS, SHARDS_PER_DISMANTLE } from "@choke/shared/items"
import { Pages, useBook, usePageCache } from "@/desk/shell/BookPages"
import { CardDetail } from "@/desk/panels/cards/CardDetail"
import { FitArea } from "@/desk/shell/FitArea"
import { startCardPointerDrag, toDeskCard } from "@/desk/lib/drag"
import { onDeskHover } from "@/desk/session/events"
import { GuestLoginButton } from "@/desk/login/GuestLoginButton"
import { useDeskCardIds } from "@/desk/session/presence"
import { RARITY_COLOR } from "@/desk/lib/rarity"
import "@/desk/panels/cards/album-panel.css"

/** 一个跨页：左页筛选下面两排，右页三排；放不下时卡按页高缩小，不出滚动条 */
const COLS = 4
const LEFT_SIZE = COLS * 2
const RIGHT_ROWS = 3
const PAGE_SIZE = LEFT_SIZE + COLS * RIGHT_ROWS
/** 和 album-panel.css 的 .album-sheet__grid gap 一致 */
const SHEET_GAP = 10

interface Result {
  rows: ApiUserCard[]
  total: number
  error: string | null
}

type CardTypeFilter = "all" | "pool" | "mirror" | "hero"

const CARD_TYPE_OPTIONS: { value: CardTypeFilter; label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "pool", label: "普通卡" },
  { value: "mirror", label: "镜像卡" },
  { value: "hero", label: "本体卡" },
]

export const AlbumPanel = memo(function AlbumPanel({
  userId,
}: {
  userId: string | null
}) {
  const book = useBook()
  const [rarity, setRarity] = useState("")
  const [cardTypeFilter, setCardTypeFilter] = useState<CardTypeFilter>("all")
  const [foilOnly, setFoilOnly] = useState(false)
  const [query, setQuery] = useState("")
  const [deferredQuery, setDeferredQuery] = useState("")
  const [sort, setSort] = useState<CardSort>("recent")
  const [page, setPage] = useState(0)
  const [detail, setDetail] = useState<ApiUserCard | null>(null)
  const [batchMode, setBatchMode] = useState<"dismantle" | "recycle" | null>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [batchConfirm, setBatchConfirm] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchNotice, setBatchNotice] = useState<string | null>(null)
  const [recycleQuota, setRecycleQuota] = useState<RecycleQuota | null>(null)
  const [recycleLockMsg, setRecycleLockMsg] = useState<string | null>(null)
  const [prevUserId, setPrevUserId] = useState(userId)
  const [prevRevision, setPrevRevision] = useState(book.revision)
  const rootRef = useRef<HTMLDivElement>(null)
  const deskIds = useDeskCardIds()

  if (prevUserId !== userId) {
    setPrevUserId(userId)
    setDetail(null)
    setBatchMode(null)
    setSelectedIds([])
    setBatchConfirm(false)
    setBatchNotice(null)
    setRecycleQuota(null)
    setRecycleLockMsg(null)
  }
  if (prevRevision !== book.revision) {
    setPrevRevision(book.revision)
    setSelectedIds([])
    setBatchConfirm(false)
  }

  useEffect(() => {
    if (!userId || batchMode !== "recycle") return
    const ctl = new AbortController()
    fetchRecycleQuota(userId, ctl.signal)
      .then((q) => {
        if (ctl.signal.aborted) return
        setRecycleQuota(q)
        setRecycleLockMsg(null)
      })
      .catch((error: unknown) => {
        if (ctl.signal.aborted) return
        const code = error instanceof ApiError ? error.code : undefined
        setRecycleLockMsg(
          code === "feature_locked"
            ? error instanceof Error
              ? error.message
              : "NPC 回收尚未解锁"
            : error instanceof Error
              ? error.message
              : "读取回收额度失败",
        )
      })
    return () => ctl.abort()
  }, [userId, batchMode, book.revision])

  const maxBatchSelect =
    batchMode === "recycle" ? Math.max(0, recycleQuota?.remaining ?? NPC_RECYCLE_DAILY_LIMIT) : 60

  const openDetail = useCallback((row: ApiUserCard) => setDetail(row), [])
  const toggleSelect = useCallback(
    (row: ApiUserCard) => {
      if (batchBusy || isHeroCardId(row.id)) return
      setBatchConfirm(false)
      setBatchNotice(null)
      setSelectedIds((cur) => {
        if (cur.includes(row.userCardId)) return cur.filter((id) => id !== row.userCardId)
        if (cur.length >= maxBatchSelect) return cur
        return [...cur, row.userCardId]
      })
    },
    [batchBusy, maxBatchSelect],
  )
  const exitBatchMode = useCallback(() => {
    if (batchBusy) return
    setBatchMode(null)
    setSelectedIds([])
    setBatchConfirm(false)
    setBatchNotice(null)
  }, [batchBusy])

  useEffect(() => {
    return onDeskHover("album", (value) => {
      rootRef.current?.classList.toggle("is-drop-target", Boolean(value))
    })
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDeferredQuery(query.trim())
      setPage(0)
    }, 280)
    return () => window.clearTimeout(timer)
  }, [query])

  const key = userId
    ? `${userId}|${rarity}|${cardTypeFilter}|${foilOnly ? "foil" : ""}|${deferredQuery}|${sort}|${book.revision}`
    : ""
  const loadPage = useCallback(
    async (index: number, signal: AbortSignal): Promise<Result> => {
      try {
        if (cardTypeFilter === "all" && !foilOnly) {
          const data = await fetchUserCards(userId!, {
            rarity: rarity || undefined,
            q: deferredQuery || undefined,
            sort,
            page: index,
            limit: PAGE_SIZE,
            signal,
          })
          return { rows: data.rows, total: data.total, error: null }
        }
        const first = await fetchUserCards(userId!, {
          rarity: rarity || undefined,
          q: deferredQuery || undefined,
          sort,
          page: 0,
          limit: 60,
          signal,
        })
        const all = [...first.rows]
        const maxPages = Math.min(10, Math.ceil(first.total / 60))
        for (let p = 1; p < maxPages; p += 1) {
          if (signal.aborted) break
          const next = await fetchUserCards(userId!, {
            rarity: rarity || undefined,
            q: deferredQuery || undefined,
            sort,
            page: p,
            limit: 60,
            signal,
          })
          all.push(...next.rows)
        }
        const matched = all.filter((row) => {
          if (foilOnly && !row.foil) return false
          const isMirror = row.cardType === "mirror" || row.id.startsWith("mirror-")
          const isHero = isHeroCardId(row.id)
          if (cardTypeFilter === "mirror") return isMirror
          if (cardTypeFilter === "hero") return isHero
          if (cardTypeFilter === "pool") return !isMirror && !isHero
          return true
        })
        const start = index * PAGE_SIZE
        return {
          rows: matched.slice(start, start + PAGE_SIZE),
          total: matched.length,
          error: null,
        }
      } catch (error) {
        if (signal.aborted) throw error
        return {
          rows: [],
          total: 0,
          error: error instanceof Error ? error.message : "加载失败",
        }
      }
    },
    [userId, rarity, cardTypeFilter, foilOnly, deferredQuery, sort]
  )
  const cachedPages = usePageCache(key, page, PAGE_SIZE, loadPage)
  const currentResult = cachedPages.find(([index]) => index === page)?.[1]
  // 渲染期钳制页码：React 会丢弃这次渲染立刻重来，不会提交越界的中间帧；改 effect 反而会闪一帧空页
  if (currentResult && !currentResult.error) {
    const lastPage = Math.max(0, Math.ceil(currentResult.total / PAGE_SIZE) - 1)
    if (page > lastPage) setPage(lastPage)
  }

  const rootClass = "album-panel"

  if (!userId) {
    return (
      <Pages
        className={rootClass}
        left={
          <>
            <p className="bk-note">登录后查看卡册。</p>
            <div className="login-actions">
              <a className="bk-btn bk-btn--main album-login" href="/auth/osu">
                用 osu! 登录
              </a>
              <GuestLoginButton className="bk-btn bk-btn--ghost album-login" />
            </div>
          </>
        }
        right={<div className="bk-empty album-fill">还没有登录</div>}
      />
    )
  }

  const renderPage = (index: number, result: Result | null) => {
    const ready = result !== null
    const total = result?.total ?? 0
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    const filtered = !!(rarity || deferredQuery || cardTypeFilter !== "all" || foilOnly)
    const rows = result && !result.error ? result.rows : null
    const empty = ready && rows !== null && rows.length === 0

    const selectedSet = new Set(selectedIds)
    const slot = (row: ApiUserCard) => (
      <AlbumSlot
        key={row.userCardId}
        row={row}
        onDesk={deskIds.has(row.userCardId)}
        batchMode={batchMode !== null}
        selected={selectedSet.has(row.userCardId)}
        onDetail={openDetail}
        onToggleSelect={toggleSelect}
      />
    )
    const selectCurrentPage = () => {
      if (!rows) return
      playSfx("tick")
      setBatchConfirm(false)
      setBatchNotice(null)
      const eligible = rows.filter((r) => !isHeroCardId(r.id)).map((r) => r.userCardId)
      setSelectedIds((cur) => {
        const next = new Set(cur)
        for (const id of eligible) {
          if (next.size >= maxBatchSelect) break
          next.add(id)
        }
        return [...next]
      })
    }
    const estimatedCoins =
      batchMode === "recycle" && rows
        ? selectedIds.reduce((sum, id) => {
            const card = rows.find((r) => r.userCardId === id)
            return sum + (card ? npcRecycleValue(card.rarity, card.level, card.exp, false) : 0)
          }, 0)
        : 0
    const runBatchAction = async () => {
      if (selectedIds.length === 0 || batchBusy) return
      if (!batchConfirm) {
        playSfx("tick")
        setBatchConfirm(true)
        return
      }
      setBatchBusy(true)
      setBatchNotice(null)
      try {
        if (batchMode === "recycle") {
          const res = await recycleCardsBatch(userId, selectedIds)
          playSfx("coin")
          setSelectedIds([])
          setBatchConfirm(false)
          setRecycleQuota({
            dailyLimit: res.dailyLimit,
            usedToday: res.usedToday,
            remaining: res.remaining,
          })
          const skipNote = res.skipped?.length ? `（跳过 ${res.skipped.length} 张出征/在售卡）` : ""
          setBatchNotice(
            `已回收 ${res.recycledCount} 张卡，获得 ${res.coinsGained} 金币 · 今日剩余 ${res.remaining}/${res.dailyLimit}${skipNote}`,
          )
          book.invalidate()
          return
        }
        const res = await dismantleCardsBatch(userId, selectedIds)
        playSfx("pick")
        setSelectedIds([])
        setBatchConfirm(false)
        const shardCount = res.itemsGained
          .filter((s) => s.itemId.startsWith("shard-"))
          .reduce((sum, s) => sum + s.count, 0)
        const expParts = res.itemsGained
          .filter((s) => s.itemId.startsWith("exp-"))
          .map((s) => `${ITEMS[s.itemId]?.name ?? s.itemId} ×${s.count}`)
        const skipNote = res.skipped?.length ? `（跳过 ${res.skipped.length} 张出征/在售卡）` : ""
        setBatchNotice(
          `已分解 ${res.removedUserCardIds.length} 张卡，获得 ${shardCount} 片碎片${expParts.length > 0 ? `、${expParts.join("、")}` : ""}${res.essenceGained > 0 ? `、${res.essenceGained} 精华` : ""}${skipNote}`,
        )
        book.invalidate()
      } catch (error) {
        setBatchConfirm(false)
        const code = error instanceof ApiError ? error.code : undefined
        if (code === "daily_limit_reached") {
          setBatchNotice(error instanceof Error ? error.message : "今日 NPC 回收额度已用完")
        } else if (code === "feature_locked") {
          setBatchNotice(error instanceof Error ? error.message : "该功能尚未解锁")
        } else {
          setBatchNotice(error instanceof Error ? error.message : batchMode === "recycle" ? "批量回收失败" : "批量分解失败")
        }
      } finally {
        setBatchBusy(false)
      }
    }

    /** 一页卡位：有卡放卡，剩下的补空位；items 为 null 时（加载中）全是空位 */
    const sheet = (
      items: ApiUserCard[] | null,
      size: number,
      label: string
    ) => (
      <FitArea
        className="album-sheet"
        cols={COLS}
        rows={size / COLS}
        gapX={SHEET_GAP}
        gapY={SHEET_GAP}
        style={{ "--cols": COLS, "--rows": size / COLS } as CSSProperties}
      >
        <div
          className="album-sheet__grid"
          style={{ visibility: ready ? undefined : "hidden" }}
          aria-label={ready && items ? label : "加载中"}
          aria-busy={ready ? undefined : true}
        >
          {items?.map(slot)}
          {Array.from({ length: size - (items?.length ?? 0) }, (_, i) => (
            <div className="bk-slot" key={`empty-${i}`} aria-hidden />
          ))}
        </div>
        <div
          className="album-sheet__grid album-sheet__loading"
          style={{ visibility: ready ? "hidden" : undefined }}
          aria-hidden
        >
          {Array.from({ length: size }, (_, i) => (
            <div className="bk-slot" key={i} />
          ))}
        </div>
      </FitArea>
    )

    return (
      <Pages
        key={index}
        rootRef={index === page ? rootRef : undefined}
        preload={index !== page}
        className={rootClass}
        ready={ready}
        tutorialId={index === page ? "album-grid" : undefined}
        pager={
          totalPages > 1
            ? {
                page: Math.min(index + 1, totalPages),
                pages: totalPages,
                onPage: (next) => setPage(next - 1),
              }
            : undefined
        }
        left={
          <>
            <div className="album-head">
              <div className="bk-stat">
                <b>{ready ? total : "—"}</b>
                <span>{filtered ? "张符合筛选" : "张已收集"}</span>
              </div>
              <input
                className="bk-input album-head__search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索玩家名"
                aria-label="搜索玩家名"
              />
              <select
                className="bk-select"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as CardSort)
                  setPage(0)
                }}
                aria-label="排序"
              >
                <option value="recent">最近获得</option>
                <option value="rarity">稀有度</option>
                <option value="pp">pp</option>
                <option value="name">名字</option>
              </select>
              <button
                type="button"
                className={`bk-btn album-head__batch ${batchMode === "dismantle" ? "bk-btn--main" : "bk-btn--ghost"}`}
                disabled={batchBusy}
                onClick={() => {
                  if (batchBusy) return
                  playSfx("tick")
                  if (batchMode === "dismantle") {
                    exitBatchMode()
                  } else {
                    setDetail(null)
                    setSelectedIds([])
                    setBatchConfirm(false)
                    setBatchMode("dismantle")
                    setBatchNotice(null)
                  }
                }}
              >
                {batchMode === "dismantle" ? "退出分解" : "批量分解"}
              </button>
              <button
                type="button"
                className={`bk-btn album-head__batch ${batchMode === "recycle" ? "bk-btn--main" : "bk-btn--ghost"}`}
                disabled={batchBusy}
                onClick={() => {
                  if (batchBusy) return
                  playSfx("tick")
                  if (batchMode === "recycle") {
                    exitBatchMode()
                  } else {
                    setDetail(null)
                    setSelectedIds([])
                    setBatchConfirm(false)
                    setBatchMode("recycle")
                    setBatchNotice(null)
                  }
                }}
              >
                {batchMode === "recycle" ? "退出回收" : "批量回收"}
              </button>
            </div>

            {batchMode && (
              <div
                className="album-batch-bar"
                role="region"
                aria-label={batchMode === "recycle" ? "批量回收操作栏" : "批量分解操作栏"}
              >
                <button
                  type="button"
                  className="bk-btn bk-btn--ghost"
                  disabled={!rows || rows.length === 0 || batchBusy || Boolean(batchMode === "recycle" && recycleLockMsg)}
                  onClick={selectCurrentPage}
                >
                  本页全选
                </button>
                <button
                  type="button"
                  className="bk-btn bk-btn--ghost"
                  disabled={selectedIds.length === 0 || batchBusy}
                  onClick={() => {
                    playSfx("tick")
                    setSelectedIds([])
                    setBatchConfirm(false)
                  }}
                >
                  清空
                </button>
                <span className="album-batch-bar__info">
                  {batchMode === "recycle" ? (
                    recycleLockMsg ? (
                      recycleLockMsg
                    ) : (
                      <>
                        已选 {selectedIds.length} · 预计 +{estimatedCoins} 金币 · 今日剩余{" "}
                        {recycleQuota?.remaining ?? NPC_RECYCLE_DAILY_LIMIT}/{recycleQuota?.dailyLimit ?? NPC_RECYCLE_DAILY_LIMIT}
                      </>
                    )
                  ) : (
                    <>
                      已选 {selectedIds.length} / 60 · 预计 +{selectedIds.length * SHARDS_PER_DISMANTLE} 碎片
                    </>
                  )}
                </span>
                <button
                  type="button"
                  className={`bk-btn ${batchConfirm ? "album-batch-bar__danger" : "bk-btn--main"}`}
                  disabled={
                    selectedIds.length === 0 ||
                    batchBusy ||
                    Boolean(batchMode === "recycle" && (recycleLockMsg || (recycleQuota?.remaining ?? 1) <= 0))
                  }
                  onClick={() => void runBatchAction()}
                >
                  {batchBusy
                    ? batchMode === "recycle"
                      ? "回收中…"
                      : "分解中…"
                    : batchConfirm
                      ? `确认${batchMode === "recycle" ? "回收" : "分解"} ${selectedIds.length} 张`
                      : `${batchMode === "recycle" ? "回收" : "分解"} (${selectedIds.length})`}
                </button>
                {batchNotice && <div className="album-batch-bar__notice">{batchNotice}</div>}
              </div>
            )}

            <div className="bk-chips" role="group" aria-label="稀有度筛选">
              <button
                type="button"
                className="bk-chip"
                aria-pressed={rarity === ""}
                onClick={() => {
                  playSfx("tick")
                  setRarity("")
                  setPage(0)
                }}
              >
                全部
              </button>
              {RARITIES.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="bk-chip"
                  aria-pressed={rarity === item}
                  onClick={() => {
                    playSfx("tick")
                    setRarity(item)
                    setPage(0)
                  }}
                >
                  <i
                    style={{ "--c": RARITY_COLOR[item] } as CSSProperties}
                    aria-hidden
                  />
                  {RARITY_LABEL[item]}
                </button>
              ))}
              {CARD_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className="bk-chip"
                  aria-pressed={cardTypeFilter === opt.value}
                  onClick={() => {
                    playSfx("tick")
                    setCardTypeFilter(opt.value)
                    setPage(0)
                  }}
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                className="bk-chip"
                aria-pressed={foilOnly}
                onClick={() => {
                  playSfx("tick")
                  setFoilOnly((prev) => !prev)
                  setPage(0)
                }}
              >
                仅闪卡
              </button>
            </div>

            {!empty &&
              !(ready && result.error) &&
              sheet(rows && rows.slice(0, LEFT_SIZE), LEFT_SIZE, "卡册左页")}
          </>
        }
        right={
          <>
            {ready && result.error ? (
              <div className="bk-empty bk-error album-fill">{result.error}</div>
            ) : empty ? (
              <div className="bk-empty album-fill">
                <span>{filtered ? "没有符合条件的卡" : "还没有卡"}</span>
                {!filtered && (
                  <a className="bk-btn bk-btn--main" href="/?panel=packs">
                    去开包
                  </a>
                )}
              </div>
            ) : (
              sheet(
                rows && rows.slice(LEFT_SIZE),
                PAGE_SIZE - LEFT_SIZE,
                "卡册右页"
              )
            )}
          </>
        }
      />
    )
  }
  return (
    <>
      {cachedPages.map(([index, result]) => renderPage(index, result))}
      {book.active && detail && (
        <CardDetail
          key={detail.userCardId}
          card={detail}
          userId={userId}
          onClose={() => setDetail(null)}
          onChanged={book.invalidate}
        />
      )}
    </>
  )
})

const AlbumSlot = memo(function AlbumSlot({
  row,
  onDesk,
  batchMode,
  selected,
  onDetail,
  onToggleSelect,
}: {
  row: ApiUserCard
  onDesk: boolean
  batchMode: boolean
  selected: boolean
  onDetail: (row: ApiUserCard) => void
  onToggleSelect: (row: ApiUserCard) => void
}) {
  const face = toFace(row)
  const hero = isHeroCardId(row.id)
  const disabledInBatch = batchMode && hero
  const handleActivate = () => {
    if (batchMode) {
      if (disabledInBatch) return
      playSfx("tick")
      onToggleSelect(row)
      return
    }
    playSfx("pick")
    onDetail(row)
  }
  return (
    <div
      className={`album-slot ${onDesk ? "is-on-desk" : ""} ${batchMode ? "is-batch" : ""} ${disabledInBatch ? "is-batch-disabled" : ""} ${selected ? "is-selected" : ""}`}
      data-user-card={row.userCardId}
      role="button"
      tabIndex={disabledInBatch ? -1 : 0}
      aria-pressed={batchMode ? selected : undefined}
      title={disabledInBatch ? "本体卡不可分解" : undefined}
      aria-label={`${row.name}，${RARITY_LABEL[row.rarity]}，Lv.${row.level}${row.foil ? "，闪卡" : ""}${onDesk ? "，在桌面" : ""}${batchMode ? (selected ? "，已选中" : "，点击选中分解") : "，查看详情"}`}
      onPointerDown={
        batchMode
          ? undefined
          : (event) =>
              startCardPointerDrag(event, {
                card: toDeskCard(face, row.userCardId),
                userCardId: row.userCardId,
              })
      }
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          handleActivate()
        }
      }}
    >
      <GameCardFace card={face} eager />
      {batchMode && !disabledInBatch && (
        <span className="album-slot__check" aria-hidden>
          ✓
        </span>
      )}
      <div className="album-slot__tags">
        {onDesk && <span className="bk-tag album-slot__on-desk">在桌面</span>}
        {row.level < levelCap(hero) && <ReadyBadge row={row} />}
      </div>
    </div>
  )
})

function ReadyBadge({ row }: { row: ApiUserCard }) {
  const need = expToNext(row.level, row.rarity, isHeroCardId(row.id))
  if (need <= 0 || row.exp < need) return null
  return <span className="bk-tag album-slot__ready">可升级</span>
}
