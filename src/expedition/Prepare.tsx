import { useEffect, useMemo, useState } from "react"

import { JOB_LABEL, RARITY_LABEL, battlePower } from "@/card/data"
import { GameCardFace } from "@/card/GameCardFace"
import type { CardFaceData } from "@/card/types"
import { fetchDeck, fetchProgress, toFace, type ApiUserCard } from "@/desk/session/api"
import {
  BASE_AP_MAX,
  BASE_SLOTS,
  FREE_MAX_RARITY,
  GATED_RARITIES,
  MAX_SLOTS,
  UPGRADED_AP_MAX,
  allocationCost,
  cardAllowed,
  totalPoints,
  type ExpeditionAllocation,
} from "@choke/shared/expedition-points"
import { RARITIES, type Rarity } from "@choke/shared/types"
import type { ExpeditionView } from "@choke/shared/expedition/view"

import { startExpedition, type MapListing } from "./api"
import { loadAllCards } from "./cards"
import { endsWithinHour, errorText, remainingText } from "./common"

/** 选稀有度权限时能点的几档：免费档，再加上要花点数的三档 */
const RARITY_STEPS: Rarity[] = [FREE_MAX_RARITY, ...GATED_RARITIES]

const LOCK_TEXT = "本次出征锁定当前卡组与卡牌状态，期间强化不会生效，参战的卡不能出售或分解。"

interface Row {
  row: ApiUserCard
  face: CardFaceData
  power: number
  isHero: boolean
}

/** 出征准备页：选卡池、分配点数、确认开始 */
export function Prepare({
  userId,
  map,
  onBack,
  onStarted,
}: {
  userId: string
  map: MapListing
  onBack: () => void
  onStarted: (view: ExpeditionView) => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [cardsTotal, setCardsTotal] = useState<number | null>(null)
  const [cardsTruncated, setCardsTruncated] = useState(false)
  const [deckIds, setDeckIds] = useState<number[]>([])
  const [level, setLevel] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [alloc, setAlloc] = useState<ExpeditionAllocation>({
    slots: Math.min(BASE_SLOTS, map.deckSize),
    apUpgrade: false,
    maxRarity: FREE_MAX_RARITY,
  })
  const [picked, setPicked] = useState<number[]>([])
  const [query, setQuery] = useState("")
  const [jobFilter, setJobFilter] = useState("all")
  const [rarityFilter, setRarityFilter] = useState<Rarity | "all">("all")
  const [minLevel, setMinLevel] = useState(0)
  const [deckOnly, setDeckOnly] = useState(false)
  const [sortBy, setSortBy] = useState<"power" | "level" | "rarity" | "pp">("power")
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc")
  const [deckNotice, setDeckNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctl = new AbortController()
    Promise.all([
      loadAllCards(userId, ctl.signal),
      fetchProgress(userId, ctl.signal),
      fetchDeck(userId, ctl.signal).catch(() => null),
    ])
      .then(([cards, progress, deck]) => {
        setCardsTotal(cards.total)
        setCardsTruncated(cards.truncated)
        setRows(
          cards.rows
            .map((row) => {
              const face = toFace(row)
              return { row, face, power: battlePower(face), isHero: !!face.isHero }
            })
            .sort((a, b) => b.power - a.power),
        )
        setLevel(progress?.level ?? null)
        setDeckIds(
          deck ? deck.slots.flatMap((s) => (s.card ? [s.card.userCardId] : [])) : [],
        )
      })
      .catch((reason: unknown) => {
        if (!ctl.signal.aborted) setLoadError(errorText(reason))
      })
    return () => ctl.abort()
  }, [userId])

  const allowed = (r: Row) => cardAllowed(alloc, { rarity: r.row.rarity, isHero: r.isHero })
  /** 正在市场挂单或出征中的卡：服务端开战时会拒，编队页直接标出来 */
  const unavailable = (r: Row) => r.row.listed === true || r.row.locked === true

  // 稀有度权限降低后，已选的卡里没权限的要拿掉
  const [prevFilterKey, setPrevFilterKey] = useState({ alloc, rows })
  if (prevFilterKey.alloc !== alloc || prevFilterKey.rows !== rows) {
    setPrevFilterKey({ alloc, rows })
    if (rows) {
      const byId = new Map(rows.map((r) => [r.row.userCardId, r]))
      setPicked((current) => {
        const next = current.filter((id) => {
          const r = byId.get(id)
          return r && cardAllowed(alloc, { rarity: r.row.rarity, isHero: r.isHero })
        })
        return next.length === current.length ? current : next
      })
    }
  }

  const points = level === null ? null : totalPoints(level)
  const cost = allocationCost(alloc)
  const overBudget = points !== null && cost > points
  const costOf = (patch: Partial<ExpeditionAllocation>) => allocationCost({ ...alloc, ...patch })

  const maxSlots = Math.min(MAX_SLOTS, map.deckSize)
  const slotChoices = Array.from({ length: maxSlots - BASE_SLOTS + 1 }, (_, i) => BASE_SLOTS + i)

  const deckSet = useMemo(() => new Set(deckIds), [deckIds])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = (rows ?? []).filter((r) => {
      if (q && !r.row.name.toLowerCase().includes(q)) return false
      if (jobFilter !== "all" && r.row.job !== jobFilter) return false
      if (rarityFilter !== "all" && r.row.rarity !== rarityFilter) return false
      if (minLevel > 0 && r.row.level < minLevel) return false
      if (deckOnly && !deckSet.has(r.row.userCardId)) return false
      return true
    })
    const dir = sortOrder === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      let diff: number
      if (sortBy === "power") diff = a.power - b.power
      else if (sortBy === "level") diff = a.row.level - b.row.level
      else if (sortBy === "rarity") diff = RARITIES.indexOf(a.row.rarity) - RARITIES.indexOf(b.row.rarity)
      else diff = Number(a.row.pp ?? 0) - Number(b.row.pp ?? 0)
      if (diff !== 0) return diff * dir
      return (a.power - b.power) * dir
    })
  }, [rows, query, jobFilter, rarityFilter, minLevel, deckOnly, deckSet, sortBy, sortOrder])

  const toggle = (r: Row) => {
    setDeckNotice(null)
    if (unavailable(r)) {
      setDeckNotice(r.row.listed ? "这张卡正在市场挂单，先下架再加入编队。" : "这张卡正在出征中，结束出征后才能再次使用。")
      return
    }
    const id = r.row.userCardId
    setPicked((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id)
      if (current.length >= map.deckSize) return current
      return [...current, id]
    })
  }
  const autoPick = () => {
    setDeckNotice(null)
    const best = (rows ?? []).filter((r) => allowed(r) && !unavailable(r)).slice(0, map.deckSize)
    setPicked(best.map((r) => r.row.userCardId))
  }
  const applyDeck = () => {
    if (!rows || deckIds.length === 0) return
    const byId = new Map(rows.map((r) => [r.row.userCardId, r]))
    const eligible: number[] = []
    let blockedCount = 0
    let busyCount = 0
    for (const id of deckIds) {
      const r = byId.get(id)
      if (!r) continue
      if (unavailable(r)) {
        busyCount += 1
        continue
      }
      if (!allowed(r)) {
        blockedCount += 1
        continue
      }
      if (eligible.length < map.deckSize) eligible.push(id)
    }
    setPicked(eligible)
    const reasons: string[] = []
    if (blockedCount > 0) reasons.push(`${blockedCount} 张超出稀有度权限`)
    if (busyCount > 0) reasons.push(`${busyCount} 张已上架或出征中`)
    if (reasons.length > 0) {
      setDeckNotice(`已套用当前卡组，有 ${reasons.join("、")}未带入。`)
    } else if (deckIds.length > map.deckSize) {
      setDeckNotice(`已按卡组顺序套用前 ${map.deckSize} 张卡。`)
    } else {
      setDeckNotice(null)
    }
  }

  const full = picked.length === map.deckSize
  const canStart = full && !overBudget && !busy

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const view = await startExpedition(userId, { mapId: map.id, cardIds: picked, allocation: alloc })
      onStarted(view)
    } catch (reason) {
      setError(errorText(reason))
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="ex-btn ex-btn--sm" onClick={onBack} style={{ marginBottom: 10 }}>
        ‹ 换一张图
      </button>
      <h1 className="ex-title">{map.name}</h1>
      <p className="ex-sub">先分配点数，再选出要带的 {map.deckSize} 张卡。战斗时从这些卡里挑上场的卡。</p>

      {loadError && <div className="ex-note ex-note--error">{loadError}</div>}

      <div className="ex-prep">
        <section>
          <div className="ex-toolbar-wrap">
            <div className="ex-toolbar">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="按名字找卡"
                aria-label="按名字找卡"
              />
              <button
                type="button"
                className="ex-btn ex-btn--sm"
                onClick={applyDeck}
                disabled={!rows || deckIds.length === 0}
                title={deckIds.length === 0 ? "卡组里还没有卡" : "按卡组槽位顺序套用当前编队"}
              >
                套用当前卡组
              </button>
              <button type="button" className="ex-btn ex-btn--sm" onClick={autoPick} disabled={!rows}>
                自动选最强
              </button>
              <button
                type="button"
                className="ex-btn ex-btn--sm"
                onClick={() => {
                  setDeckNotice(null)
                  setPicked([])
                }}
                disabled={picked.length === 0}
              >
                清空
              </button>
              <span className="ex-chip">
                已选 {picked.length} / {map.deckSize}
              </span>
            </div>

            <div className="ex-toolbar">
              {deckIds.length > 0 && (
                <button
                  type="button"
                  className="ex-btn ex-btn--sm"
                  aria-pressed={deckOnly}
                  onClick={() => setDeckOnly((v) => !v)}
                >
                  只看卡组内
                </button>
              )}
              <select
                value={jobFilter}
                onChange={(e) => setJobFilter(e.target.value)}
                aria-label="按职业筛选"
              >
                <option value="all">全部职业</option>
                {Object.keys(JOB_LABEL).map((j) => (
                  <option key={j} value={j}>
                    {JOB_LABEL[j]}
                  </option>
                ))}
              </select>
              <select
                value={rarityFilter}
                onChange={(e) => setRarityFilter(e.target.value as Rarity | "all")}
                aria-label="按品质筛选"
              >
                <option value="all">全部品质</option>
                {RARITIES.map((r) => (
                  <option key={r} value={r}>
                    {RARITY_LABEL[r]}
                  </option>
                ))}
              </select>
              <select
                value={minLevel}
                onChange={(e) => setMinLevel(Number(e.target.value))}
                aria-label="按最低等级筛选"
              >
                <option value={0}>全部等级</option>
                <option value={5}>Lv.5+</option>
                <option value={10}>Lv.10+</option>
                <option value={20}>Lv.20+</option>
                <option value={30}>Lv.30+</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "power" | "level" | "rarity" | "pp")}
                aria-label="排序方式"
              >
                <option value="power">按战力</option>
                <option value="level">按等级</option>
                <option value="rarity">按品质</option>
                <option value="pp">按 PP</option>
              </select>
              <button
                type="button"
                className="ex-btn ex-btn--sm"
                onClick={() => setSortOrder((o) => (o === "desc" ? "asc" : "desc"))}
                aria-label="切换排序方向"
              >
                {sortOrder === "desc" ? "倒序 ↓" : "正序 ↑"}
              </button>
            </div>
          </div>

          <div className="ex-picked-bar" aria-label="已选出战编队">
            <div className="ex-picked-bar__meta">
              <span>编队总战力</span>
              <b>
                {picked
                  .reduce((sum, id) => sum + (rows?.find((r) => r.row.userCardId === id)?.power ?? 0), 0)
                  .toLocaleString("en-US")}
              </b>
            </div>
            {Array.from({ length: map.deckSize }, (_, i) => {
              const id = picked[i]
              const item = id != null ? rows?.find((r) => r.row.userCardId === id) : undefined
              if (!item) {
                return (
                  <div className="ex-picked-slot" key={`empty-${i}`}>
                    <span>空位 {i + 1}</span>
                  </div>
                )
              }
              return (
                <button
                  type="button"
                  className="ex-picked-slot"
                  data-filled="true"
                  key={item.row.userCardId}
                  title="点击移出编队"
                  onClick={() => toggle(item)}
                >
                  <span className="ex-picked-slot__name">{item.row.name}</span>
                  <span className="ex-picked-slot__bp">Lv.{item.row.level}</span>
                </button>
              )
            })}
          </div>

          {deckNotice && <div className="ex-note" style={{ marginBottom: 10 }}>{deckNotice}</div>}

          {!rows && !loadError && <div className="ex-note">正在读取你的卡……</div>}
          {rows && rows.length === 0 && <div className="ex-note">你还没有卡，先去开包。</div>}
          {cardsTruncated && (
            <div className="ex-note">
              卡太多，只加载了前 {rows?.length ?? 0} 张（共 {cardsTotal ?? "?"} 张），筛选和自动编队可能不完整。
            </div>
          )}
          <div className="ex-cards">
            {shown.map((r) => {
              const id = r.row.userCardId
              const on = picked.includes(id)
              const ok = allowed(r)
              const busy = unavailable(r)
              const blocked = !ok || busy || (!on && picked.length >= map.deckSize)
              return (
                <button
                  key={id}
                  type="button"
                  className="ex-tile"
                  aria-pressed={on}
                  aria-label={`${r.row.name}，战力 ${r.power}`}
                  disabled={blocked && !on}
                  title={
                    busy
                      ? r.row.listed
                        ? "这张卡正在市场挂单，先下架再加入编队"
                        : "这张卡正在出征中，结束出征后才能再次使用"
                      : ok
                        ? undefined
                        : "超出了你分配的稀有度权限"
                  }
                  onClick={() => toggle(r)}
                >
                  <GameCardFace card={r.face} />
                  {!ok && !busy && <span className="ex-tile__lock">稀有度不够</span>}
                  {busy && <span className="ex-tile__lock">{r.row.listed ? "已上架" : "出征中"}</span>}
                </button>
              )
            })}
          </div>
        </section>

        <aside className="ex-prep__side">
          <div className="ex-box">
            <h4>
              点数分配 · {cost} / {points ?? "—"}
            </h4>
            {points !== null && (
              <div className="ex-bar" style={{ marginBottom: 12 }}>
                <i style={{ width: `${Math.min(100, (cost / Math.max(1, points)) * 100)}%` }} />
              </div>
            )}
            <div className="ex-field">
              <span>上场卡槽</span>
              <div className="ex-seg">
                {slotChoices.map((n) => (
                  <button key={n} type="button" aria-pressed={alloc.slots === n} onClick={() => setAlloc({ ...alloc, slots: n })}>
                    {n} 张
                    <small>{costOf({ slots: n })} 点</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="ex-field">
              <span>AP 上限</span>
              <div className="ex-seg">
                <button type="button" aria-pressed={!alloc.apUpgrade} onClick={() => setAlloc({ ...alloc, apUpgrade: false })}>
                  {BASE_AP_MAX}
                  <small>{costOf({ apUpgrade: false })} 点</small>
                </button>
                <button type="button" aria-pressed={alloc.apUpgrade} onClick={() => setAlloc({ ...alloc, apUpgrade: true })}>
                  {UPGRADED_AP_MAX}
                  <small>{costOf({ apUpgrade: true })} 点</small>
                </button>
              </div>
            </div>
            <div className="ex-field" style={{ marginBottom: 0 }}>
              <span>能带的最高稀有度</span>
              <div className="ex-seg">
                {RARITY_STEPS.map((r) => (
                  <button key={r} type="button" aria-pressed={alloc.maxRarity === r} onClick={() => setAlloc({ ...alloc, maxRarity: r })}>
                    到 {RARITY_LABEL[r]}
                    <small>{costOf({ maxRarity: r })} 点</small>
                  </button>
                ))}
              </div>
            </div>
            <p className="ex-sub" style={{ margin: "10px 0 0" }}>
              每个按钮下面的数字，是选它之后总共要花的点数。本体卡不受稀有度限制。
            </p>
            {overBudget && <div className="ex-note ex-note--error" style={{ marginTop: 8 }}>点数不够：需要 {cost}，现有 {points}。</div>}
          </div>

          <div className="ex-box">
            <h4>出征信息</h4>
            <div className="ex-row">
              <span>这一期还剩</span>
              <b>{remainingText(map.endsAt)}</b>
            </div>
            <div className="ex-row">
              <span>AP 上限</span>
              <b>{alloc.apUpgrade ? UPGRADED_AP_MAX : BASE_AP_MAX}</b>
            </div>
            {endsWithinHour(map.endsAt) && (
              <div className="ex-note ex-note--warn" style={{ marginTop: 8 }}>
                离这一期结束不足 1 小时，来不及打完的话，到期会自动结算。
              </div>
            )}
            {error && <div className="ex-note ex-note--error" style={{ marginTop: 8 }}>{error}</div>}
            <button
              type="button"
              className="ex-btn ex-btn--primary"
              style={{ width: "100%", marginTop: 12 }}
              disabled={!canStart}
              onClick={() => setConfirming(true)}
            >
              {full ? "开始出征" : `还要再选 ${map.deckSize - picked.length} 张卡`}
            </button>
          </div>
        </aside>
      </div>

      {confirming && (
        <div className="ex-modal" role="dialog" aria-modal="true" aria-label="确认出征">
          <div className="ex-dialog">
            <h2>确认出征？</h2>
            <p>{LOCK_TEXT}</p>
            <div className="ex-row">
              <span>地图</span>
              <b>{map.name}</b>
            </div>
            <div className="ex-row">
              <span>带卡</span>
              <b>
                {picked.length} 张（上场 {alloc.slots}）
              </b>
            </div>
            {endsWithinHour(map.endsAt) && (
              <div className="ex-note ex-note--warn">离这一期结束不足 1 小时，到期没打完会自动结算，奖励通过邮件发放。</div>
            )}
            <div className="ex-actions">
              <button type="button" className="ex-btn" onClick={() => setConfirming(false)} disabled={busy}>
                再想想
              </button>
              <button type="button" className="ex-btn ex-btn--primary" onClick={start} disabled={busy}>
                {busy ? "出发中……" : "确认出征"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
