import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"

import { GameCardFace } from "@/card/GameCardFace"
import { JOB_LABEL, RARITY_LABEL } from "@/card/data"
import type { Job, Rarity } from "@/card/types"

import { usePanel } from "@/desk/shell/PanelFrame"
import { CardDetail } from "@/desk/panels/cards/CardDetail"
import {
  defToFace,
  fetchCardCountries,
  fetchCardStats,
  fetchCodexPage,
  fetchUserCodexStats,
  type ApiCardDef,
  type ApiUserCard,
} from "@/desk/session/api"
import { CardGrid } from "@/desk/panels/cards/grid/CardGrid"
import {
  ActiveFilters,
  CountrySelect,
  JobSelect,
  RarityChips,
  SearchBox,
  SortSelect,
  countryLabel,
} from "@/desk/panels/cards/grid/FilterBar"
import { Pager } from "@/desk/panels/cards/grid/Pager"
import { usePagedQuery } from "@/desk/panels/cards/grid/usePagedQuery"
import "@/desk/panels/cards/grid/card-grid.css"
import "@/desk/panels/cards/codex-panel.css"

const PAGE_SIZE = 36
const SORTS = [
  { id: "rarity", label: "稀有度", dir: "desc" },
  { id: "pp", label: "pp", dir: "desc" },
  { id: "name", label: "名字", dir: "asc" },
] as const
const OWNED_FILTERS = [
  { id: "all", label: "全部" },
  { id: "owned", label: "已收集" },
  { id: "unseen", label: "未见" },
] as const

type CodexSort = (typeof SORTS)[number]["id"]
type OwnedFilter = (typeof OWNED_FILTERS)[number]["id"]

interface RarityStat {
  total: number
  owned: number
}

interface CodexStats {
  total: number
  owned: number
  byRarity: Record<string, RarityStat>
  countries: { code: string; total: number; owned: number }[]
}

interface CodexFilters {
  rarity: Rarity[]
  q: string
  country: string
  job: Job | ""
  owned: OwnedFilter
  sort: CodexSort
}

const DEFAULT_FILTERS: CodexFilters = { rarity: [], q: "", country: "", job: "", owned: "all", sort: "rarity" }

function percent(owned: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((owned / total) * 1000) / 10
}

const num = (value: number) => value.toLocaleString("en-US")

function toPseudoCard(row: ApiCardDef): ApiUserCard {
  return {
    ...row,
    skillRefs: [],
    userCardId: 0,
    level: 1,
    constellation: 0,
    exp: 0,
  }
}

export const CodexPanel = memo(function CodexPanel({ userId }: { userId: string | null }) {
  const panel = usePanel()
  const [filters, setFilters] = useState<CodexFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(0)
  const [dimUnseen, setDimUnseen] = useState(false)
  const [stats, setStats] = useState<CodexStats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [statsReload, setStatsReload] = useState(0)
  const [detail, setDetail] = useState<ApiCardDef | null>(null)
  const [ownedTotal, setOwnedTotal] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const onDone = () => setStatsError(null)
    const onFail = (reason: unknown) => {
      if (controller.signal.aborted) return
      setStatsError(reason instanceof Error ? reason.message : "加载统计失败")
    }

    if (!userId) {
      Promise.all([fetchCardStats(), fetchCardCountries(controller.signal)])
        .then(([statsData, countryData]) => {
          const byRarity: Record<string, RarityStat> = {}
          for (const [key, value] of Object.entries(statsData.byRarity)) {
            byRarity[key] = { total: Number(value), owned: 0 }
          }
          setStats({
            total: Number(statsData.total),
            owned: 0,
            byRarity,
            countries: countryData.map((item) => ({
              code: item.code,
              total: Number(item.total),
              owned: 0,
            })),
          })
          onDone()
        })
        .catch(onFail)

      return () => controller.abort()
    }

    fetchUserCodexStats(userId, controller.signal)
      .then((data) => {
        if (data) setStats(data as CodexStats)
        onDone()
      })
      .catch(onFail)

    return () => controller.abort()
  }, [userId, panel.revision, statsReload])

  const update = useCallback((patch: Partial<CodexFilters>) => {
    setFilters((current) => ({ ...current, ...patch }))
    setPage(0)
  }, [])
  const setQuery = useCallback((q: string) => update({ q }), [update])

  const owned = userId ? filters.owned : "all"
  const key = JSON.stringify([userId ?? "guest", filters, owned, panel.revision])
  const query = usePagedQuery(key, page, async (index, signal) => {
    const data = await fetchCodexPage({
      userId,
      rarity: filters.rarity,
      q: filters.q,
      country: filters.country,
      job: filters.job,
      sort: filters.sort,
      owned,
      limit: PAGE_SIZE,
      offset: index * PAGE_SIZE,
      signal,
    })
    setOwnedTotal(userId ? (data.ownedTotal ?? 0) : 0)
    // 图鉴接口返回的是卡定义 + owned 标记，不是用户的卡实例
    const rows = data.rows as unknown as ApiCardDef[]
    return {
      rows: userId ? rows : rows.map((row) => ({ ...row, owned: false })),
      total: data.total,
    }
  })

  const totalPages = Math.max(1, Math.ceil(query.total / PAGE_SIZE))
  if (!query.loading && query.rows && page > totalPages - 1) setPage(totalPages - 1)

  const detailCard = useMemo(() => (detail ? toPseudoCard(detail) : null), [detail])
  const poolBase = owned === "unseen" ? query.total + ownedTotal : query.total

  const chips = [
    ...filters.rarity.map((rarity) => ({
      label: RARITY_LABEL[rarity],
      onClear: () => update({ rarity: filters.rarity.filter((item) => item !== rarity) }),
    })),
    ...(filters.q ? [{ label: `「${filters.q}」`, onClear: () => update({ q: "" }) }] : []),
    ...(filters.job ? [{ label: JOB_LABEL[filters.job], onClear: () => update({ job: "" as const }) }] : []),
    ...(filters.country ? [{ label: countryLabel(filters.country), onClear: () => update({ country: "" }) }] : []),
    ...(userId && filters.owned !== "all"
      ? [{ label: OWNED_FILTERS.find((item) => item.id === filters.owned)!.label, onClear: () => update({ owned: "all" as const }) }]
      : []),
  ]
  const clearFilters = () => update({ rarity: [], q: "", country: "", job: "", owned: "all" })
  const rarityCounts = Object.fromEntries(
    Object.entries(stats?.byRarity ?? {}).map(([rarity, tier]) => [
      rarity,
      userId ? `${num(tier.owned)}/${num(tier.total)}` : num(tier.total),
    ]),
  ) as Partial<Record<Rarity, string>>

  return (
    <div className="codex-panel split-panel">
      <aside className="filter-side" aria-label="筛选">
        <div className="codex-progress">
          <div className="codex-progress__line">
            <span className="bk-label">{userId ? "收集进度" : "全部卡牌"}</span>
            <span className="bk-num">
              {!stats
                ? "—"
                : userId
                  ? `${num(stats.owned)} / ${num(stats.total)} · ${percent(stats.owned, stats.total)}%`
                  : `${num(stats.total)} 张`}
            </span>
          </div>
          <div className="bk-bar" style={{ "--p": stats ? percent(stats.owned, stats.total) : 0 } as CSSProperties}>
            <i />
          </div>
          {statsError && (
            <div className="codex-stats-error" role="alert">
              <span className="bk-error">统计加载失败：{statsError}</span>
              <button
                type="button"
                className="bk-btn bk-btn--sm"
                onClick={() => {
                  setStatsError(null)
                  setStatsReload((value) => value + 1)
                }}
              >
                重试
              </button>
            </div>
          )}
        </div>
        <div className="filter-side__group">
          <span className="bk-label">搜索</span>
          <SearchBox value={filters.q} onChange={setQuery} />
        </div>
        <div className="filter-side__group">
          <span className="bk-label">稀有度</span>
          <RarityChips value={filters.rarity} onChange={(rarity) => update({ rarity })} counts={rarityCounts} />
        </div>
        <div className="filter-side__group">
          <span className="bk-label">职业</span>
          <JobSelect value={filters.job} onChange={(job) => update({ job })} />
        </div>
        <div className="filter-side__group">
          <span className="bk-label">国家 / 地区</span>
          <CountrySelect
            value={filters.country}
            onChange={(country) => update({ country })}
            options={stats?.countries ?? []}
          />
        </div>
        {userId && (
          <div className="filter-side__group">
            <span className="bk-label">收集</span>
            <div className="bk-seg" role="group" aria-label="收集筛选">
              {OWNED_FILTERS.map((item) => (
                <button key={item.id} type="button" aria-pressed={filters.owned === item.id} onClick={() => update({ owned: item.id })}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="filter-side__group">
          <span className="bk-label">排序</span>
          <SortSelect
            value={filters.sort}
            dir="desc"
            options={SORTS}
            fixedDir
            onChange={(sort) => update({ sort })}
          />
        </div>
        <button
          type="button"
          className="bk-chip"
          aria-pressed={dimUnseen}
          onClick={() => setDimUnseen((value) => !value)}
          title="未见卡只保留问号，并进一步压暗"
        >
          暗化未见
        </button>
      </aside>

      <section className="filter-main">
        <div className="filter-row">
          <p className="bk-note codex-count">
            <b className="bk-num">{query.rows ? num(query.total) : "—"}</b> 张
            {userId && query.rows && query.total > 0 && (
              <>
                {" · 已收集 "}
                <span className="bk-num">
                  {owned === "owned"
                    ? num(ownedTotal)
                    : `${num(ownedTotal)} / ${num(poolBase)} · ${percent(ownedTotal, poolBase)}%`}
                </span>
              </>
            )}
          </p>
        </div>
        <ActiveFilters chips={chips} onClearAll={clearFilters} />
        <CardGrid
          rows={query.rows}
          loading={query.loading}
          error={query.error}
          onRetry={query.retry}
          getKey={(row) => row.id}
          renderCard={(row) =>
            row.owned ? (
              <CodexSlot row={row} onDetail={setDetail} />
            ) : (
              <div className={`bk-slot codex-unknown ${dimUnseen ? "is-dimmed" : ""}`} aria-label="未收集的卡">
                ?
              </div>
            )
          }
          empty={
            <>
              <span>没有符合条件的卡</span>
              {chips.length > 0 && (
                <button type="button" className="bk-btn" onClick={clearFilters}>
                  清除筛选
                </button>
              )}
            </>
          }
        />
        <Pager page={page} pages={totalPages} onPage={setPage} />
      </section>

      {detailCard && (
        <CardDetail
          key={`codex-${detailCard.id}`}
          card={detailCard}
          userId={userId}
          readOnly
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
})

const CodexSlot = memo(function CodexSlot({
  row,
  onDetail,
}: {
  row: ApiCardDef
  onDetail: (row: ApiCardDef) => void
}) {
  return (
    <div
      className="codex-slot"
      role="button"
      tabIndex={0}
      aria-label={`${row.name}，${RARITY_LABEL[row.rarity]}，查看图鉴详情`}
      onClick={() => onDetail(row)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onDetail(row)
        }
      }}
    >
      <GameCardFace card={defToFace(row)} eager />
    </div>
  )
})
