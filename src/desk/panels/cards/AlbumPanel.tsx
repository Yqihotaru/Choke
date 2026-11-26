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
  dismantleCardsBatch,
  fetchUserCards,
  toFace,
  type ApiUserCard,
  type CardSort,
} from "@/desk/session/api"
import { SHARDS_PER_DISMANTLE } from "@choke/shared/items"
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

export const AlbumPanel = memo(function AlbumPanel({
  userId,
}: {
  userId: string | null
}) {
  const book = useBook()
  const [rarity, setRarity] = useState("")
  const [query, setQuery] = useState("")
  const [deferredQuery, setDeferredQuery] = useState("")
  const [sort, setSort] = useState<CardSort>("recent")
  const [page, setPage] = useState(0)
  const [detail, setDetail] = useState<ApiUserCard | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [batchConfirm, setBatchConfirm] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchNotice, setBatchNotice] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const deskIds = useDeskCardIds()
  const openDetail = useCallback((row: ApiUserCard) => setDetail(row), [])
  const toggleSelect = useCallback((row: ApiUserCard) => {
    if (isHeroCardId(row.id)) return
    setBatchConfirm(false)
    setBatchNotice(null)
    setSelectedIds((cur) => {
      if (cur.includes(row.userCardId)) return cur.filter((id) => id !== row.userCardId)
      if (cur.length >= 60) return cur
      return [...cur, row.userCardId]
    })
  }, [])
  const exitBatchMode = useCallback(() => {
    setBatchMode(false)
    setSelectedIds([])
    setBatchConfirm(false)
    setBatchNotice(null)
  }, [])

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
    ? `${userId}|${rarity}|${deferredQuery}|${sort}|${book.revision}`
    : ""
  const loadPage = useCallback(
    async (index: number, signal: AbortSignal): Promise<Result> => {
      try {
        const data = await fetchUserCards(userId!, {
          rarity: rarity || undefined,
          q: deferredQuery || undefined,
          sort,
          page: index,
          limit: PAGE_SIZE,
          signal,
        })
        return { rows: data.rows, total: data.total, error: null }
      } catch (error) {
        if (signal.aborted) throw error
        return {
          rows: [],
          total: 0,
          error: error instanceof Error ? error.message : "加载失败",
        }
      }
    },
    [userId, rarity, deferredQuery, sort]
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
    const filtered = !!(rarity || deferredQuery)
    const rows = result && !result.error ? result.rows : null
    const empty = ready && rows !== null && rows.length === 0

    const selectedSet = new Set(selectedIds)
    const slot = (row: ApiUserCard) => (
      <AlbumSlot
        key={row.userCardId}
        row={row}
        onDesk={deskIds.has(row.userCardId)}
        batchMode={batchMode}
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
          if (next.size >= 60) break
          next.add(id)
        }
        return [...next]
      })
    }
    const runBatchDismantle = async () => {
      if (selectedIds.length === 0 || batchBusy) return
      if (!batchConfirm) {
        playSfx("tick")
        setBatchConfirm(true)
        return
      }
      setBatchBusy(true)
      setBatchNotice(null)
      try {
        const res = await dismantleCardsBatch(userId, selectedIds)
        playSfx("pick")
        setSelectedIds([])
        setBatchConfirm(false)
        const shardCount = res.itemsGained
          .filter((s) => s.itemId.startsWith("shard-"))
          .reduce((sum, s) => sum + s.count, 0)
        setBatchNotice(
          `已分解 ${res.removedUserCardIds.length} 张卡，获得 ${shardCount} 片碎片${res.essenceGained > 0 ? `、${res.essenceGained} 精华` : ""}`,
        )
        book.invalidate()
      } catch (error) {
        setBatchConfirm(false)
        setBatchNotice(error instanceof Error ? error.message : "批量分解失败")
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
                className={`bk-btn album-head__batch ${batchMode ? "bk-btn--main" : "bk-btn--ghost"}`}
                onClick={() => {
                  playSfx("tick")
                  if (batchMode) {
                    exitBatchMode()
                  } else {
                    setDetail(null)
                    setBatchMode(true)
                    setBatchNotice(null)
                  }
                }}
              >
                {batchMode ? "退出批量" : "批量分解"}
              </button>
            </div>

            {batchMode && (
              <div className="album-batch-bar" role="region" aria-label="批量分解操作栏">
                <button
                  type="button"
                  className="bk-btn bk-btn--ghost"
                  disabled={!rows || rows.length === 0 || batchBusy}
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
                  已选 {selectedIds.length} / 60 · 预计 +{selectedIds.length * SHARDS_PER_DISMANTLE} 碎片
                </span>
                <button
                  type="button"
                  className={`bk-btn ${batchConfirm ? "album-batch-bar__danger" : "bk-btn--main"}`}
                  disabled={selectedIds.length === 0 || batchBusy}
                  onClick={() => void runBatchDismantle()}
                >
                  {batchBusy
                    ? "分解中…"
                    : batchConfirm
                      ? `确认分解 ${selectedIds.length} 张`
                      : `分解 (${selectedIds.length})`}
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

            {book.active && index === page && detail && (
              <CardDetail
                key={detail.userCardId}
                card={detail}
                userId={userId}
                onClose={() => setDetail(null)}
                onChanged={book.invalidate}
              />
            )}
          </>
        }
      />
    )
  }
  return cachedPages.map(([index, result]) => renderPage(index, result))
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
