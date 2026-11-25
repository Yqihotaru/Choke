import { memo, useCallback, useEffect, useRef, useState } from "react"

import { playSfx } from "@/audio/sfx"
import { GameCardFace } from "@/card/GameCardFace"
import { RARITY_LABEL, JOB_LABEL } from "@/card/data"
import { expToNext, isHeroCardId, levelCap } from "@/card/progression"

import {
  fetchCardCountries,
  fetchUserCards,
  toFace,
  type ApiUserCard,
  type UserCardFilters,
} from "@/desk/session/api"
import { usePanel } from "@/desk/shell/PanelFrame"
import { CardDetail } from "@/desk/panels/cards/CardDetail"
import { CardGrid } from "@/desk/panels/cards/grid/CardGrid"
import {
  ActiveFilters,
  CountrySelect,
  FoilToggle,
  JobSelect,
  RarityChips,
  SearchBox,
  SortSelect,
  countryLabel,
} from "@/desk/panels/cards/grid/FilterBar"
import { Pager } from "@/desk/panels/cards/grid/Pager"
import { usePagedQuery } from "@/desk/panels/cards/grid/usePagedQuery"
import { startCardPointerDrag, toDeskCard } from "@/desk/lib/drag"
import { onDeskHover } from "@/desk/session/events"
import { GuestLoginButton } from "@/desk/login/GuestLoginButton"
import { useDeskCardIds } from "@/desk/session/presence"
import "@/desk/panels/cards/grid/card-grid.css"
import "@/desk/panels/cards/album-panel.css"

const PAGE_SIZE = 36

const ALBUM_SORTS = [
  { id: "recent", label: "最近获得", dir: "desc" },
  { id: "rarity", label: "稀有度", dir: "desc" },
  { id: "pp", label: "pp", dir: "desc" },
  { id: "rank", label: "全球排名", dir: "asc" },
  { id: "level", label: "等级", dir: "desc" },
  { id: "name", label: "名字", dir: "asc" },
] as const

const DEFAULT_FILTERS: UserCardFilters = { sort: "recent", dir: "desc" }

export const AlbumPanel = memo(function AlbumPanel({
  userId,
}: {
  userId: string | null
}) {
  const panel = usePanel()
  const [filters, setFilters] = useState<UserCardFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(0)
  const [detail, setDetail] = useState<ApiUserCard | null>(null)
  const [countries, setCountries] = useState<{ code: string; total: number }[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const deskIds = useDeskCardIds()
  const openDetail = useCallback((row: ApiUserCard) => setDetail(row), [])

  useEffect(() => {
    return onDeskHover("album", (value) => {
      rootRef.current?.classList.toggle("is-drop-target", Boolean(value))
    })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchCardCountries(controller.signal)
      .then((list) => setCountries(list.map((item) => ({ code: item.code, total: Number(item.total) }))))
      .catch(() => {})
    return () => controller.abort()
  }, [])

  const update = useCallback((patch: Partial<UserCardFilters>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setPage(0)
  }, [])
  const setQuery = useCallback((q: string) => update({ q: q || undefined }), [update])

  const key = userId ? JSON.stringify([userId, filters, panel.revision]) : ""
  const query = usePagedQuery(key, page, async (index, signal) => {
    const data = await fetchUserCards(userId!, { ...filters, page: index, limit: PAGE_SIZE, signal })
    return { rows: data.rows, total: data.total }
  })

  // 渲染期钳制页码：React 会丢弃这次渲染立刻重来，不会提交越界的中间帧
  const totalPages = Math.max(1, Math.ceil(query.total / PAGE_SIZE))
  if (!query.loading && query.rows && page > totalPages - 1) setPage(totalPages - 1)

  if (!userId) {
    return (
      <div className="album-panel album-panel--guest" ref={rootRef}>
        <p className="bk-note">登录后查看卡册。</p>
        <div className="login-actions">
          <a className="bk-btn bk-btn--main album-login" href="/auth/osu">
            用 osu! 登录
          </a>
          <GuestLoginButton className="bk-btn bk-btn--ghost album-login" />
        </div>
      </div>
    )
  }

  const chips = [
    ...(filters.rarity ?? []).map((rarity) => ({
      label: RARITY_LABEL[rarity],
      onClear: () => {
        const next = (filters.rarity ?? []).filter((item) => item !== rarity)
        update({ rarity: next.length ? next : undefined })
      },
    })),
    ...(filters.q ? [{ label: `「${filters.q}」`, onClear: () => update({ q: undefined }) }] : []),
    ...(filters.job ? [{ label: JOB_LABEL[filters.job], onClear: () => update({ job: undefined }) }] : []),
    ...(filters.country
      ? [{ label: countryLabel(filters.country), onClear: () => update({ country: undefined }) }]
      : []),
    ...(filters.foil !== undefined
      ? [{ label: filters.foil ? "闪卡" : "非闪", onClear: () => update({ foil: undefined }) }]
      : []),
  ]
  const clearFilters = () => update({ rarity: undefined, q: undefined, job: undefined, country: undefined, foil: undefined })
  const filtered = chips.length > 0

  return (
    <div className="album-panel split-panel" ref={rootRef}>
      <aside className="filter-side" aria-label="筛选">
        <div className="bk-stat">
          <b>{query.rows ? query.total : "—"}</b>
          <span>{filtered ? "张符合筛选" : "张已收集"}</span>
        </div>
        <div className="filter-side__group">
          <span className="bk-label">搜索</span>
          <SearchBox value={filters.q ?? ""} onChange={setQuery} />
        </div>
        <div className="filter-side__group">
          <span className="bk-label">稀有度</span>
          <RarityChips value={filters.rarity ?? []} onChange={(rarity) => update({ rarity: rarity.length ? rarity : undefined })} />
        </div>
        <div className="filter-side__group">
          <span className="bk-label">职业</span>
          <JobSelect value={filters.job ?? ""} onChange={(job) => update({ job: job || undefined })} />
        </div>
        <div className="filter-side__group">
          <span className="bk-label">国家 / 地区</span>
          <CountrySelect value={filters.country ?? ""} onChange={(country) => update({ country: country || undefined })} options={countries} />
        </div>
        <div className="filter-side__group">
          <span className="bk-label">闪卡</span>
          <FoilToggle value={filters.foil} onChange={(foil) => update({ foil })} />
        </div>
        <div className="filter-side__group">
          <span className="bk-label">排序</span>
          <SortSelect
            value={filters.sort ?? "recent"}
            dir={filters.dir ?? "desc"}
            options={ALBUM_SORTS}
            onChange={(sort, dir) => update({ sort, dir })}
          />
        </div>
      </aside>

      <section className="filter-main">
        <ActiveFilters chips={chips} onClearAll={clearFilters} />
        <CardGrid
          rows={query.rows}
          loading={query.loading}
          error={query.error}
          onRetry={query.retry}
          tutorialId="album-grid"
          getKey={(row) => row.userCardId}
          renderCard={(row) => (
            <AlbumSlot row={row} onDesk={deskIds.has(row.userCardId)} onDetail={openDetail} />
          )}
          empty={
            filtered ? (
              <>
                <span>没有符合条件的卡</span>
                <button type="button" className="bk-btn" onClick={clearFilters}>
                  清除筛选
                </button>
              </>
            ) : (
              <>
                <span>还没有卡</span>
                <button type="button" className="bk-btn bk-btn--main" onClick={() => panel.select("packs")}>
                  去开包
                </button>
              </>
            )
          }
        />
        <Pager page={page} pages={totalPages} onPage={setPage} className="album-pager" />
      </section>

      {detail && (
        <CardDetail
          key={detail.userCardId}
          card={detail}
          userId={userId}
          onClose={() => setDetail(null)}
          onChanged={panel.invalidate}
        />
      )}
    </div>
  )
})

const AlbumSlot = memo(function AlbumSlot({
  row,
  onDesk,
  onDetail,
}: {
  row: ApiUserCard
  onDesk: boolean
  onDetail: (row: ApiUserCard) => void
}) {
  const face = toFace(row)
  return (
    <div
      className={`album-slot ${onDesk ? "is-on-desk" : ""}`}
      data-user-card={row.userCardId}
      role="button"
      tabIndex={0}
      aria-label={`${row.name}，${RARITY_LABEL[row.rarity]}，Lv.${row.level}${row.foil ? "，闪卡" : ""}${onDesk ? "，在桌面" : ""}，查看详情`}
      onPointerDown={(event) =>
        startCardPointerDrag(event, {
          card: toDeskCard(face, row.userCardId),
          userCardId: row.userCardId,
        })
      }
      onClick={() => {
        playSfx("pick")
        onDetail(row)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          playSfx("pick")
          onDetail(row)
        }
      }}
    >
      <GameCardFace card={face} eager />
      <div className="album-slot__tags">
        {onDesk && <span className="bk-tag album-slot__on-desk">在桌面</span>}
        {row.level < levelCap(isHeroCardId(row.id)) && <ReadyBadge row={row} />}
      </div>
    </div>
  )
})

function ReadyBadge({ row }: { row: ApiUserCard }) {
  const need = expToNext(row.level, row.rarity, isHeroCardId(row.id))
  if (need <= 0 || row.exp < need) return null
  return <span className="bk-tag album-slot__ready">可升级</span>
}
