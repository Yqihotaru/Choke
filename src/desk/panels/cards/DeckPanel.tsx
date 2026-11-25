import { memo, useCallback, useEffect, useRef, useState } from "react"

import { playSfx } from "@/audio/sfx"
import { GameCardFace } from "@/card/GameCardFace"
import { RARITY_LABEL, battlePower } from "@/card/data"
import { emitTutorialEvent } from "@/tutorial/events"
import { useTutorialProgress } from "@/tutorial/store"
import { TUTORIAL_ENCOUNTER_ID, type Recommend } from "@choke/shared/battle/content"
import { BASE_SLOTS } from "@choke/shared/expedition-points"
import { pickReason, recommendText } from "@choke/shared/lineup"

import {
  fetchDeck,
  fetchEncounter,
  fetchUserCards,
  saveDeck,
  toFace,
  type ApiDeck,
  type ApiUserCard,
  type UserCardFilters,
} from "@/desk/session/api"
import {
  CARD_POINTER_DROP_EVENT,
  DECK_ASSIGN_EVENT,
  startCardPointerDrag,
  toDeskCard,
  type CardPointerDrop,
} from "@/desk/lib/drag"
import { onDeskHover } from "@/desk/session/events"
import { pickLineup } from "@/desk/lib/lineup"
import { ConfirmBar } from "@/desk/shell/ConfirmBar"
import { usePanel } from "@/desk/shell/PanelFrame"
import { CardGrid } from "@/desk/panels/cards/grid/CardGrid"
import { FoilToggle, JobSelect, RarityChips, SearchBox, SortSelect } from "@/desk/panels/cards/grid/FilterBar"
import { Pager } from "@/desk/panels/cards/grid/Pager"
import { usePagedQuery } from "@/desk/panels/cards/grid/usePagedQuery"
import { GuestLoginButton } from "@/desk/login/GuestLoginButton"
import { useDeskCardIds } from "@/desk/session/presence"
import { useGameConfig } from "@/desk/session/useGameConfig"
import "@/desk/panels/cards/deck-panel.css"

/** 选卡区每页张数 */
const PICK_SIZE = 24
const PICK_DEFAULTS: UserCardFilters = { sort: "pp", dir: "desc" }
const PICK_SORTS = [
  { id: "pp", label: "战力 (pp)", dir: "desc" },
  { id: "rarity", label: "稀有度", dir: "desc" },
  { id: "level", label: "等级", dir: "desc" },
  { id: "recent", label: "最近获得", dir: "desc" },
] as const

export const DeckPanel = memo(function DeckPanel({
  userId,
}: {
  userId: string | null
}) {
  const book = usePanel()
  const tutorial = useTutorialProgress(userId)
  const [deck, setDeck] = useState<ApiDeck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dropSlot, setDropSlot] = useState<number | null>(null)
  const [reload, setReload] = useState(0)
  const [busyHint, setBusyHint] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [reviewRecommend, setReviewRecommend] = useState<Recommend | null>(null)
  const hoverSlotRef = useRef<number | null>(null)
  const deskIds = useDeskCardIds()
  const config = useGameConfig()
  const deckSize = config?.deckSize ?? 0

  const [pickerSlot, setPickerSlot] = useState<number | null>(null)
  const [pickFilters, setPickFilters] = useState<UserCardFilters>(PICK_DEFAULTS)
  const [pickPage, setPickPage] = useState(0)
  const updatePick = (patch: Partial<UserCardFilters>) => {
    setPickFilters((current) => ({ ...current, ...patch }))
    setPickPage(0)
  }

  const assignRef = useRef<
    (userCardId: number, slotIndex: number, fromSlot?: number) => void
  >(() => {})
  const removeRef = useRef<(slotIndex: number) => void>(() => {})

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    fetchDeck(userId, controller.signal)
      .then((data) => {
        setDeck(data)
        setError(null)
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return
        setError(reason instanceof Error ? reason.message : "加载卡组失败")
      })
    return () => controller.abort()
  }, [userId, book.revision, reload])

  useEffect(() => {
    if (tutorial.tutorialStep !== "deck-review") return
    let cancelled = false
    fetchEncounter(TUTORIAL_ENCOUNTER_ID)
      .then((spec) => {
        if (!cancelled) setReviewRecommend(spec.recommend)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [tutorial.tutorialStep])

  const pickKey = userId ? JSON.stringify([userId, pickFilters, book.revision]) : ""
  const picker = usePagedQuery(pickKey, pickPage, async (index, signal) => {
    const data = await fetchUserCards(userId!, { ...pickFilters, page: index, limit: PICK_SIZE, signal })
    return { rows: data.rows, total: data.total }
  })
  // 渲染期钳制页码：React 会丢弃这次渲染立刻重来，不会提交越界的中间帧
  if (!picker.loading && picker.rows) {
    const lastPage = Math.max(0, Math.ceil(picker.total / PICK_SIZE) - 1)
    if (pickPage > lastPage) setPickPage(lastPage)
  }

  const commit = async (slots: (number | null)[]) => {
    if (!userId || !deck || saving) return
    setSaving(true)
    setBusyHint(false)
    setNotice(null)
    try {
      const next = await saveDeck(userId, slots)
      setDeck(next)
      setSavedAt(
        new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        })
      )
    } catch (reason) {
      playSfx("error")
      setNotice(reason instanceof Error ? reason.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  /** 保存期间的改动不排队，直接提示稍等，避免静默丢操作 */
  const rejectWhileSaving = () => {
    setBusyHint(true)
    playSfx("deny")
  }

  const assign = (userCardId: number, slotIndex: number, fromSlot?: number) => {
    if (!deck) return
    if (saving) return rejectWhileSaving()
    const slots = deck.slots.map((slot) => slot.card?.userCardId ?? null)
    if (fromSlot != null) {
      const target = slots[slotIndex] ?? null
      slots[fromSlot] = target
      slots[slotIndex] = userCardId
    } else {
      const existing = slots.indexOf(userCardId)
      if (existing === slotIndex) return
      if (existing >= 0) slots[existing] = slots[slotIndex] ?? null
      slots[slotIndex] = userCardId
    }
    setPickerSlot(null)
    setConfirmClear(false)
    playSfx("equip")
    void commit(slots)
  }
  useEffect(() => {
    assignRef.current = assign
  })

  const remove = (slotIndex: number) => {
    if (!deck) return
    if (saving) return rejectWhileSaving()
    const slots = deck.slots.map((slot) => slot.card?.userCardId ?? null)
    slots[slotIndex] = null
    setPickerSlot(null)
    setConfirmClear(false)
    playSfx("unequip")
    void commit(slots)
  }
  useEffect(() => {
    removeRef.current = remove
  })

  const clear = () => {
    if (!deck) return
    if (saving) return rejectWhileSaving()
    setConfirmClear(false)
    setPickerSlot(null)
    playSfx("slide")
    void commit(deck.slots.map(() => null))
  }

  useEffect(() => {
    const offHover = onDeskHover("deck", (value) => {
      const slot = typeof value === "number" ? value : null
      if (slot !== null && slot !== hoverSlotRef.current) playSfx("tick")
      hoverSlotRef.current = slot
      setDropSlot(slot)
    })
    const onAssign = (event: Event) => {
      const detail = (
        event as CustomEvent<{ userCardId: number; slot: number }>
      ).detail
      if (detail) assignRef.current(detail.userCardId, detail.slot)
    }
    window.addEventListener(DECK_ASSIGN_EVENT, onAssign)
    return () => {
      offHover()
      window.removeEventListener(DECK_ASSIGN_EVENT, onAssign)
    }
  }, [])

  // 卡组槽接住指针拖卡；槽内卡拖到选卡区则移出卡组。DragGhost 只在指针落在 .deck-picker 上时才把根节点当落点，所以这里 hit === root 就是「拖到了选卡区」。
  const bindRoot = useCallback((root: HTMLDivElement | null) => {
    if (!root) return
    const onDrop = (event: Event) => {
      const { payload } = (event as CustomEvent<CardPointerDrop>).detail
      const hit = event.target instanceof Element ? event.target : null
      const slot = hit?.closest<HTMLElement>(".deck-slot[data-slot]")
      if (slot && payload.userCardId != null) {
        event.preventDefault()
        assignRef.current(
          payload.userCardId,
          Number(slot.dataset.slot),
          payload.fromSlot
        )
      } else if (payload.fromSlot != null && hit === root) {
        event.preventDefault()
        removeRef.current(payload.fromSlot)
      }
    }
    root.addEventListener(CARD_POINTER_DROP_EVENT, onDrop)
    return () => root.removeEventListener(CARD_POINTER_DROP_EVENT, onDrop)
  }, [])

  if (!userId) {
    return (
      <div className="deck-panel deck-panel--guest">
        <div className="bk-empty">
          <span>登录后编辑卡组</span>
          <div className="login-actions">
            <a className="bk-btn bk-btn--main" href="/auth/osu">
              用 osu! 登录
            </a>
            <GuestLoginButton className="bk-btn bk-btn--ghost" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !deck) {
    return (
      <div className="deck-panel deck-panel--guest">
        <div className={`bk-empty ${error ? "bk-error" : ""}`} role={error ? "alert" : "status"}>
          <span>{error ?? "加载中…"}</span>
          {error && (
            <button
              type="button"
              className="bk-btn bk-btn--sm"
              onClick={() => {
                setError(null)
                setReload((value) => value + 1)
              }}
            >
              重试
            </button>
          )}
        </div>
      </div>
    )
  }

  const filled = deck.slots.filter((slot) => slot.card).length
  const totalBp = deck.slots.reduce(
    (sum, slot) => (slot.card ? sum + battlePower(toFace(slot.card)) : sum),
    0
  )
  const usedIds = new Set(
    deck.slots.flatMap((slot) => (slot.card ? [slot.card.userCardId] : []))
  )
  // 没点槽位时，点右页的卡放进第一个空槽
  const firstEmpty = deck.slots.findIndex((slot) => !slot.card)
  const targetSlot = pickerSlot ?? (firstEmpty >= 0 ? firstEmpty : null)
  const tutorialDeckStep = tutorial.tutorialStep === "deck-view"
  const tutorialReview = tutorial.tutorialStep === "deck-review"
  const reviewLineup =
    tutorialReview && reviewRecommend
      ? pickLineup(
          deck.slots.flatMap((slot) => (slot.card ? [slot.card] : [])),
          reviewRecommend,
          BASE_SLOTS
        )
      : null
  const reviewNames = new Map(
    deck.slots.flatMap((slot) =>
      slot.card ? [[slot.card.userCardId, slot.card.name] as const] : []
    )
  )

  /** 教程专用：空卡组按推荐挑 4 张存进去；已有卡就不动，教学战开打时再从里面挑 */
  const confirmTutorialDeck = async () => {
    if (!userId || !deck || saving) return
    setSaving(true)
    setBusyHint(false)
    setNotice(null)
    try {
      if (filled === 0) {
        const [spec, page] = await Promise.all([
          fetchEncounter(TUTORIAL_ENCOUNTER_ID),
          fetchUserCards(userId, { sort: "pp", limit: 200 }),
        ])
        const { rows } = pickLineup(page.rows, spec.recommend, BASE_SLOTS)
        if (rows.length === 0) {
          setNotice("你还没有能带的卡；先去抽一包再上阵。")
          return
        }
        const next = await saveDeck(
          userId,
          deck.slots.map((_, index) => rows[index]?.userCardId ?? null)
        )
        setDeck(next)
        setSavedAt(
          new Date().toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })
        )
      }
      playSfx("success")
      emitTutorialEvent("deck-confirmed")
    } catch (reason) {
      playSfx("error")
      setNotice(reason instanceof Error ? reason.message : "上阵失败")
    } finally {
      setSaving(false)
    }
  }

  const pickTotalPages = Math.max(1, Math.ceil(picker.total / PICK_SIZE))
  const pickFiltered = !!(pickFilters.rarity?.length || pickFilters.q || pickFilters.job || pickFilters.foil !== undefined)

  return (
    <div className="deck-panel" ref={bindRoot}>
      <section className="deck-lineup-wrap">
        <div className="deck-summary">
          <div className="bk-stat">
            <b>
              {filled} <small>/ {deck.slots.length}</small>
            </b>
            <span>已上阵</span>
          </div>
          <div className="bk-stat">
            <b>{totalBp.toLocaleString("en-US")}</b>
            <span>总战力</span>
          </div>
          <span className="deck-summary__saved bk-note" role="status">
            {saving
              ? busyHint
                ? "保存中，请稍后再操作…"
                : "保存中…"
              : savedAt
                ? `已保存 ${savedAt}`
                : "改动自动保存"}
          </span>
          <div className="deck-actions">
            <button
              type="button"
              className="bk-btn bk-btn--ghost bk-btn--danger"
              onClick={() => setConfirmClear(true)}
              disabled={saving || filled === 0}
            >
              清空
            </button>
            {tutorialDeckStep ? (
              <button
                type="button"
                className="bk-btn bk-btn--main"
                data-tutorial-id="deck-tutorial-confirm"
                disabled={saving}
                onClick={() => void confirmTutorialDeck()}
              >
                {saving ? "上阵中…" : filled > 0 ? "确认阵容，继续" : "按推荐一键上阵"}
              </button>
            ) : filled === 0 ? (
              <button type="button" className="bk-btn bk-btn--main" disabled>
                进入战斗
              </button>
            ) : (
              <a className="bk-btn bk-btn--main" href="/battle">
                进入战斗
              </a>
            )}
          </div>
        </div>

        {notice && (
          <div className="bk-box bk-error" role="alert">
            {notice}
          </div>
        )}

        <div className="deck-lineup" data-tutorial-id="deck-slots">
          {deck.slots.map((slot, index) => {
            const isDropTarget = dropSlot === index
            const onDesk = !!slot.card && deskIds.has(slot.card.userCardId)
            return (
              <div
                className={`deck-slot ${slot.card ? "has-card" : "bk-slot"} ${isDropTarget ? "is-drop-target" : ""} ${pickerSlot === index ? "is-picked" : ""} ${onDesk ? "is-on-desk" : ""}`}
                key={index}
                data-slot={index}
                onPointerDown={(event) => {
                  if (!slot.card) return
                  startCardPointerDrag(event, {
                    userCardId: slot.card.userCardId,
                    fromSlot: index,
                    card: toDeskCard(toFace(slot.card), slot.card.userCardId),
                  })
                }}
                onClick={() => setPickerSlot(pickerSlot === index ? null : index)}
              >
                {/* 键盘入口：铺满槽位的透明按钮，不接指针（指针仍走外层，拖拽不受影响）；Enter / 空格的 click 冒泡到外层 */}
                <button
                  type="button"
                  className="deck-slot__main"
                  aria-pressed={pickerSlot === index}
                  aria-label={
                    slot.card
                      ? `第 ${index + 1} 槽 ${slot.card.name}，${RARITY_LABEL[slot.card.rarity]}，点击更换`
                      : `第 ${index + 1} 槽，空`
                  }
                />
                {slot.card ? <DeckFace row={slot.card} /> : <span aria-hidden>+</span>}
                <span className="deck-slot__no">{index + 1}</span>
                {slot.card && (
                  <button
                    type="button"
                    className="deck-slot__remove"
                    onClick={(event) => {
                      event.stopPropagation()
                      remove(index)
                    }}
                    aria-label={`移出第 ${index + 1} 槽`}
                  >
                    ×
                  </button>
                )}
                {isDropTarget ? (
                  <span className="deck-slot__flag">松开放入</span>
                ) : (
                  onDesk && <span className="deck-slot__flag">在桌面</span>
                )}
              </div>
            )
          })}
        </div>

        {reviewLineup && reviewRecommend && (
          <div className="bk-box deck-review" role="status">
            <b>{recommendText(reviewRecommend)}</b>
            <ul>
              {reviewLineup.lineup.picks.map((pick) => (
                <li key={pick.key}>
                  <span>{reviewNames.get(pick.key)}</span>
                  {pickReason(pick)}
                </li>
              ))}
            </ul>
            {reviewLineup.lineup.wanted && !reviewLineup.lineup.hit && (
              <p>这队没有对口的攻击技能，教学战里揭不开幽灵的隐藏弱点，不影响过关。</p>
            )}
          </div>
        )}

        {confirmClear && filled > 0 && (
          <ConfirmBar
            danger
            busy={saving}
            confirmLabel="确认清空"
            message={`清空卡组？会把 ${filled} 张卡全部移出槽位（卡仍留在卡册里）。`}
            onCancel={() => setConfirmClear(false)}
            onConfirm={clear}
          />
        )}
      </section>

      <section className="deck-picker" aria-label="选卡">
        <div className="deck-target">
          <span className="bk-label">
            {targetSlot == null ? "卡组已满 · 先点上面要换的槽" : `放进第 ${targetSlot + 1} 槽`}
          </span>
          {pickerSlot != null && (
            <button type="button" className="bk-btn bk-btn--ghost bk-btn--sm" onClick={() => setPickerSlot(null)}>
              取消选槽
            </button>
          )}
          <span className="bk-note deck-target__hint">
            {deckSize > 0 ? `不必满 ${deckSize} 张，至少 1 张。` : "至少 1 张。"}点一下放入，或拖到槽位。共 {picker.rows ? picker.total : "—"} 张。
          </span>
        </div>

        <div className="filter-row">
          <SearchBox value={pickFilters.q ?? ""} onChange={(q) => updatePick({ q: q || undefined })} />
          <RarityChips
            value={pickFilters.rarity ?? []}
            onChange={(rarity) => updatePick({ rarity: rarity.length ? rarity : undefined })}
          />
          <JobSelect value={pickFilters.job ?? ""} onChange={(job) => updatePick({ job: job || undefined })} />
          <FoilToggle value={pickFilters.foil} onChange={(foil) => updatePick({ foil })} />
          <SortSelect
            value={pickFilters.sort ?? "pp"}
            dir={pickFilters.dir ?? "desc"}
            options={PICK_SORTS}
            onChange={(sort, dir) => updatePick({ sort, dir })}
          />
        </div>

        <CardGrid
          className="deck-picks"
          rows={picker.rows}
          loading={picker.loading}
          error={picker.error}
          onRetry={picker.retry}
          getKey={(row) => row.userCardId}
          empty={
            <>
              <span>{pickFiltered ? "没有符合条件的卡" : "卡册里还没有卡"}</span>
              {pickFiltered && (
                <button type="button" className="bk-btn" onClick={() => updatePick({ rarity: undefined, q: undefined, job: undefined, foil: undefined })}>
                  清除筛选
                </button>
              )}
            </>
          }
          renderCard={(row) => {
            const used = usedIds.has(row.userCardId)
            const blocked = used || targetSlot == null
            return (
              <div
                className={`deck-pick ${used ? "is-used" : ""}`}
                role="button"
                tabIndex={0}
                aria-disabled={blocked}
                aria-label={`${row.name}，${RARITY_LABEL[row.rarity]}，Lv.${row.level}${
                  used
                    ? "，已在卡组"
                    : targetSlot == null
                      ? "，卡组已满，先选要换的槽"
                      : `，放进第 ${targetSlot + 1} 槽`
                }`}
                onPointerDown={(event) => {
                  if (!used) startCardPointerDrag(event, { userCardId: row.userCardId })
                }}
                onClick={() => {
                  if (!blocked) assign(row.userCardId, targetSlot)
                }}
                onKeyDown={(event) => {
                  if (!blocked && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault()
                    assign(row.userCardId, targetSlot)
                  }
                }}
              >
                <DeckFace row={row} />
                {used && <span className="deck-pick__used">已在卡组</span>}
              </div>
            )
          }}
        />
        <Pager page={pickPage} pages={pickTotalPages} onPage={setPickPage} />
      </section>
    </div>
  )
})

// 卡面只跟随卡实例变化，输入、选槽和拖放高亮不重新生成卡面树。
const DeckFace = memo(function DeckFace({ row }: { row: ApiUserCard }) {
  return <GameCardFace card={toFace(row)} eager />
})
