import { useEffect, useMemo, useState } from "react"

import { battlePower } from "@/card/data"
import { GameCardFace } from "@/card/GameCardFace"
import type { CardFaceData } from "@/card/types"
import { fetchProgress, fetchStamina, toFace, type ApiUserCard, type StaminaState } from "@/desk/session/api"
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
import { type Rarity } from "@choke/shared/types"
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
  const [level, setLevel] = useState<number | null>(null)
  const [stamina, setStamina] = useState<StaminaState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [alloc, setAlloc] = useState<ExpeditionAllocation>({
    slots: Math.min(BASE_SLOTS, map.deckSize),
    apUpgrade: false,
    maxRarity: FREE_MAX_RARITY,
  })
  const [picked, setPicked] = useState<number[]>([])
  const [query, setQuery] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctl = new AbortController()
    Promise.all([loadAllCards(userId, ctl.signal), fetchProgress(userId, ctl.signal), fetchStamina(userId, ctl.signal).catch(() => null)])
      .then(([cards, progress, stam]) => {
        setRows(
          cards
            .map((row) => {
              const face = toFace(row)
              return { row, face, power: battlePower(face), isHero: !!face.isHero }
            })
            .sort((a, b) => b.power - a.power),
        )
        setLevel(progress?.level ?? null)
        setStamina(stam)
      })
      .catch((reason: unknown) => {
        if (!ctl.signal.aborted) setLoadError(errorText(reason))
      })
    return () => ctl.abort()
  }, [userId])

  const allowed = (r: Row) => cardAllowed(alloc, { rarity: r.row.rarity, isHero: r.isHero })

  // 稀有度权限降低后，已选的卡里没权限的要拿掉
  useEffect(() => {
    if (!rows) return
    const byId = new Map(rows.map((r) => [r.row.userCardId, r]))
    setPicked((current) => {
      const next = current.filter((id) => {
        const r = byId.get(id)
        return r && cardAllowed(alloc, { rarity: r.row.rarity, isHero: r.isHero })
      })
      return next.length === current.length ? current : next
    })
  }, [alloc, rows])

  const points = level === null ? null : totalPoints(level)
  const cost = allocationCost(alloc)
  const overBudget = points !== null && cost > points
  const costOf = (patch: Partial<ExpeditionAllocation>) => allocationCost({ ...alloc, ...patch })

  const maxSlots = Math.min(MAX_SLOTS, map.deckSize)
  const slotChoices = Array.from({ length: maxSlots - BASE_SLOTS + 1 }, (_, i) => BASE_SLOTS + i)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? []).filter((r) => !q || r.row.name.toLowerCase().includes(q))
  }, [rows, query])

  const toggle = (r: Row) => {
    const id = r.row.userCardId
    setPicked((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id)
      if (current.length >= map.deckSize) return current
      return [...current, id]
    })
  }
  const autoPick = () => {
    const best = (rows ?? []).filter(allowed).slice(0, map.deckSize)
    setPicked(best.map((r) => r.row.userCardId))
  }

  const lacksStamina = stamina !== null && map.staminaCost > stamina.value
  const full = picked.length === map.deckSize
  const canStart = full && !overBudget && !lacksStamina && !busy

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
          <div className="ex-toolbar">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="按名字找卡"
              aria-label="按名字找卡"
            />
            <button type="button" className="ex-btn ex-btn--sm" onClick={autoPick} disabled={!rows}>
              自动选最强
            </button>
            <button type="button" className="ex-btn ex-btn--sm" onClick={() => setPicked([])} disabled={picked.length === 0}>
              清空
            </button>
            <span className="ex-chip">
              已选 {picked.length} / {map.deckSize}
            </span>
          </div>

          {!rows && !loadError && <div className="ex-note">正在读取你的卡……</div>}
          {rows && rows.length === 0 && <div className="ex-note">你还没有卡，先去开包。</div>}
          <div className="ex-cards">
            {shown.map((r) => {
              const id = r.row.userCardId
              const on = picked.includes(id)
              const ok = allowed(r)
              const blocked = !ok || (!on && picked.length >= map.deckSize)
              return (
                <button
                  key={id}
                  type="button"
                  className="ex-tile"
                  aria-pressed={on}
                  aria-label={`${r.row.name}，战力 ${r.power}`}
                  disabled={blocked && !on}
                  title={ok ? undefined : "超出了你分配的稀有度权限"}
                  onClick={() => toggle(r)}
                >
                  <GameCardFace card={r.face} />
                  {!ok && <span className="ex-tile__lock">稀有度不够</span>}
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
                    到 {r}
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
              <span>体力</span>
              <b>
                {map.staminaCost > 0 ? `需要 ${map.staminaCost}` : "不消耗"}
                {stamina && map.staminaCost > 0 ? `（现有 ${stamina.value}）` : ""}
              </b>
            </div>
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
            {lacksStamina && <div className="ex-note ex-note--error" style={{ marginTop: 8 }}>体力不够，需要 {map.staminaCost}。</div>}
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
            <div className="ex-row">
              <span>体力</span>
              <b>{map.staminaCost > 0 ? `${map.staminaCost}（结算时才扣，没拿到东西或放弃会退回）` : "不消耗"}</b>
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
