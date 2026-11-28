import { memo, useCallback, useEffect, useRef, useState } from "react"

import { playSfx } from "@/audio/sfx"
import { GameCardFace } from "@/card/GameCardFace"
import { JOB_LABEL, JOB_ORDER, RARITY_LABEL, battlePower } from "@/card/data"
import { RARITIES, type Job, type Rarity } from "@/card/types"
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
  type CardSort,
  type SortOrder,
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
import { Pages, useBook, usePageCache } from "@/desk/shell/BookPages"
import { CardDetail } from "@/desk/panels/cards/CardDetail"
import { ConfirmBar } from "@/desk/shell/ConfirmBar"
import { FitArea } from "@/desk/shell/FitArea"
import { GuestLoginButton } from "@/desk/login/GuestLoginButton"
import { useDeskCardIds } from "@/desk/session/presence"
import { useGameConfig } from "@/desk/session/useGameConfig"
import "@/desk/panels/cards/deck-panel.css"

const RARITY_FILTER: (Rarity | "")[] = ["", ...RARITIES]
/** 右页候选卡：一页 4 列 × 3 排，用书的翻页，不滚动 */
const PICK_COLS = 4
const PICK_ROWS = 3
const PICK_SIZE = PICK_COLS * PICK_ROWS

interface PickerResult {
  rows: ApiUserCard[]
  total: number
  error: string | null
}

export const DeckPanel = memo(function DeckPanel({
  userId,
}: {
  userId: string | null
}) {
  const book = useBook()
  const [deck, setDeck] = useState<ApiDeck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dropSlot, setDropSlot] = useState<number | null>(null)
  const [reload, setReload] = useState(0)
  const [busyHint, setBusyHint] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const reviewRecommend: Recommend | null = null
  const hoverSlotRef = useRef<number | null>(null)
  const deskIds = useDeskCardIds()
  const config = useGameConfig()
  const deckSize = config?.deckSize ?? 0

  const [pickerSlot, setPickerSlot] = useState<number | null>(null)
  const [detail, setDetail] = useState<ApiUserCard | null>(null)
  const [prevUserId, setPrevUserId] = useState(userId)
  const [query, setQuery] = useState("")

  if (prevUserId !== userId) {
    setPrevUserId(userId)
    setDetail(null)
  }
  const [deferredQuery, setDeferredQuery] = useState("")
  const [rarity, setRarity] = useState<Rarity | "">("")
  const [job, setJob] = useState<Job | "">("")
  const [minLevel, setMinLevel] = useState<number>(0)
  const [sort, setSort] = useState<CardSort>("pp")
  const [order, setOrder] = useState<SortOrder>("desc")
  const [pickPage, setPickPage] = useState(0)

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
    const timer = window.setTimeout(() => {
      setDeferredQuery(query.trim())
      setPickPage(0)
    }, 260)
    return () => window.clearTimeout(timer)
  }, [query])

  const pickerKey = userId
    ? `${userId}|${deferredQuery}|${rarity}|${job}|${minLevel}|${sort}|${order}|${book.revision}`
    : ""
  const loadPage = useCallback(
    async (index: number, signal: AbortSignal): Promise<PickerResult> => {
      try {
        const data = await fetchUserCards(userId!, {
          q: deferredQuery || undefined,
          rarity: rarity || undefined,
          job: job || undefined,
          minLevel: minLevel > 0 ? minLevel : undefined,
          sort,
          order,
          limit: PICK_SIZE,
          page: index,
          signal,
        })
        return { rows: data.rows, total: data.total, error: null }
      } catch (reason) {
        if (signal.aborted) throw reason
        return {
          rows: [],
          total: 0,
          error: reason instanceof Error ? reason.message : "加载卡册失败",
        }
      }
    },
    [userId, deferredQuery, rarity, job, minLevel, sort, order]
  )
  const cachedPages = usePageCache(pickerKey, pickPage, PICK_SIZE, loadPage)
  const currentResult = cachedPages.find(([index]) => index === pickPage)?.[1]
  // 渲染期钳制页码：React 会丢弃这次渲染立刻重来，不会提交越界的中间帧；改 effect 反而会闪一帧空页
  if (currentResult && !currentResult.error) {
    const lastPage = Math.max(0, Math.ceil(currentResult.total / PICK_SIZE) - 1)
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

  // 卡组槽接住指针拖卡；槽内卡拖到右页则移出卡组，左页空白不接。
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
      <Pages
        className="deck-panel"
        left={<p className="bk-note">登录后可以编辑出战卡组。</p>}
        right={
          <div className="bk-empty">
            <span>登录后编辑卡组</span>
            <div className="login-actions">
              <a className="bk-btn bk-btn--main" href="/auth/osu">
                用 osu! 登录
              </a>
              <GuestLoginButton className="bk-btn bk-btn--ghost" />
            </div>
          </div>
        }
      />
    )
  }

  if (error || !deck) {
    return (
      <Pages
        className="deck-panel"
        ready={!!error}
        left={
          <p className="bk-note">
            {deckSize > 0 ? `出战卡组最多 ${deckSize} 张，改动自动保存。` : "改动自动保存。"}
          </p>
        }
        right={
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
        }
      />
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
  const tutorialDeckStep = false
  const tutorialReview = false
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
          fetchUserCards(userId, { sort: "pp", limit: 60 }),
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
    } catch (reason) {
      playSfx("error")
      setNotice(reason instanceof Error ? reason.message : "上阵失败")
    } finally {
      setSaving(false)
    }
  }

  const renderPage = (index: number, pickerResult: PickerResult | null) => {
    const ready = pickerResult !== null
    const pickTotalPages = Math.max(
      1,
      Math.ceil((pickerResult?.total ?? 0) / PICK_SIZE)
    )

    return (
      <Pages
        key={index}
        rootRef={index === pickPage ? bindRoot : undefined}
        preload={index !== pickPage}
        className="deck-panel"
        ready={ready}
        pager={
          pickTotalPages > 1
            ? {
                page: Math.min(index + 1, pickTotalPages),
                pages: pickTotalPages,
                onPage: (next) => setPickPage(next - 1),
              }
            : undefined
        }
        left={
          <>
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
            </div>

            {notice && (
              <div className="bk-box bk-error" role="alert">
                {notice}
              </div>
            )}

            <div className="deck-grid" data-tutorial-id="deck-slots">
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
                        card: toDeskCard(
                          toFace(slot.card),
                          slot.card.userCardId
                        ),
                      })
                    }}
                    onClick={() =>
                      setPickerSlot(pickerSlot === index ? null : index)
                    }
                    onDoubleClick={() => {
                      if (!slot.card) return
                      playSfx("pick")
                      setDetail(slot.card)
                    }}
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
                    {slot.card ? (
                      <DeckFace row={slot.card} />
                    ) : (
                      <span aria-hidden>+</span>
                    )}
                    <span className="deck-slot__no">{index + 1}</span>
                    {slot.card && (
                      <>
                        <button
                          type="button"
                          className="deck-slot__detail"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            playSfx("pick")
                            setDetail(slot.card)
                          }}
                          aria-label={`查看 ${slot.card.name} 详情并升级`}
                        >
                          详情
                        </button>
                        <button
                          type="button"
                          className="deck-slot__remove"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            remove(index)
                          }}
                          aria-label={`移出第 ${index + 1} 槽`}
                        >
                          ×
                        </button>
                      </>
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
                  <p>
                    这队没有对口的攻击技能，教学战里揭不开幽灵的隐藏弱点，不影响过关。
                  </p>
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
                  {saving
                    ? "上阵中…"
                    : filled > 0
                      ? "确认阵容，继续"
                      : "按推荐一键上阵"}
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

            <p className="bk-note">
              {deckSize > 0
                ? `不必满 ${deckSize} 张也能出战，但至少要 1 张。桌面上的卡可以直接拖进槽位。`
                : "不必填满也能出战，但至少要 1 张。桌面上的卡可以直接拖进槽位。"}
            </p>
          </>
        }
        right={
          <>
            <div className="deck-target">
              <span className="bk-label">
                {targetSlot == null
                  ? "卡组已满 · 先点左页要换的槽"
                  : `放进第 ${targetSlot + 1} 槽`}
              </span>
              {pickerSlot != null && (
                <button
                  type="button"
                  className="bk-btn bk-btn--ghost bk-btn--sm"
                  onClick={() => setPickerSlot(null)}
                >
                  取消选槽
                </button>
              )}
            </div>

            <div className="deck-filters">
              <input
                className="bk-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索玩家名"
                aria-label="搜索卡牌"
              />
              <select
                className="bk-select"
                value={rarity}
                onChange={(event) => {
                  setRarity(event.target.value as Rarity | "")
                  setPickPage(0)
                }}
                aria-label="按品质筛选"
              >
                {RARITY_FILTER.map((item) => (
                  <option key={item || "all"} value={item}>
                    {item ? RARITY_LABEL[item] : "全部品质"}
                  </option>
                ))}
              </select>
              <select
                className="bk-select"
                value={job}
                onChange={(event) => {
                  setJob(event.target.value as Job | "")
                  setPickPage(0)
                }}
                aria-label="按职业筛选"
              >
                <option value="">全部职业</option>
                {JOB_ORDER.map((item) => (
                  <option key={item} value={item}>
                    {JOB_LABEL[item]}
                  </option>
                ))}
              </select>
              <select
                className="bk-select"
                value={minLevel}
                onChange={(event) => {
                  setMinLevel(Number(event.target.value))
                  setPickPage(0)
                }}
                aria-label="按等级筛选"
              >
                <option value={0}>全部等级</option>
                <option value={20}>Lv.20+</option>
                <option value={40}>Lv.40+</option>
                <option value={60}>Lv.60+</option>
                <option value={80}>Lv.80+</option>
              </select>
              <select
                className="bk-select"
                value={sort}
                onChange={(event) => {
                  const nextSort = event.target.value as CardSort
                  setSort(nextSort)
                  setOrder(nextSort === "name" ? "asc" : "desc")
                  setPickPage(0)
                }}
                aria-label="排序字段"
              >
                <option value="pp">按 pp</option>
                <option value="level">按等级</option>
                <option value="rarity">按稀有度</option>
                <option value="recent">按获得时间</option>
                <option value="name">按名字</option>
              </select>
              <button
                type="button"
                className="bk-btn bk-btn--sm"
                onClick={() => {
                  playSfx("tick")
                  setOrder((prev) => (prev === "desc" ? "asc" : "desc"))
                  setPickPage(0)
                }}
                title="切换正序 / 倒序"
              >
                {order === "desc" ? "↓ 倒序" : "↑ 正序"}
              </button>
            </div>

            {!pickerResult ? (
              <div className="bk-empty">加载卡册…</div>
            ) : pickerResult.error ? (
              <div className="bk-empty bk-error">{pickerResult.error}</div>
            ) : pickerResult.rows.length === 0 ? (
              <div className="bk-empty">没有符合条件的卡</div>
            ) : (
              <>
                <FitArea
                  className="deck-picks"
                  cols={PICK_COLS}
                  rows={PICK_ROWS}
                  gapX={10}
                  gapY={12}
                >
                  <div
                    className="deck-picks__grid"
                    aria-busy={!ready}
                    style={{ visibility: ready ? undefined : "hidden" }}
                  >
                    {pickerResult.rows.map((row) => {
                      const used = usedIds.has(row.userCardId)
                      const blocked = used || targetSlot == null
                      return (
                        <div
                          key={row.userCardId}
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
                            if (!used)
                              startCardPointerDrag(event, {
                                userCardId: row.userCardId,
                              })
                          }}
                          onClick={() => {
                            if (!blocked) assign(row.userCardId, targetSlot)
                          }}
                          onKeyDown={(event) => {
                            if (
                              !blocked &&
                              (event.key === "Enter" || event.key === " ")
                            ) {
                              event.preventDefault()
                              assign(row.userCardId, targetSlot)
                            }
                          }}
                        >
                          <DeckFace row={row} />
                          <button
                            type="button"
                            className="deck-slot__detail deck-pick__detail"
                            onPointerDown={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation()
                              playSfx("pick")
                              setDetail(row)
                            }}
                            aria-label={`查看 ${row.name} 详情并升级`}
                          >
                            详情
                          </button>
                          {used && (
                            <span className="deck-pick__used">已在卡组</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <div
                    className="deck-picks__grid deck-picks__loading"
                    style={{ visibility: ready ? "hidden" : undefined }}
                    aria-hidden
                  >
                    {Array.from({ length: PICK_SIZE }, (_, i) => (
                      <div className="bk-slot" key={i} />
                    ))}
                  </div>
                </FitArea>
                <p className="bk-note">
                  点一下放入，或拖到左页的槽位；点「详情」或双击已上阵卡可直接升级。共{" "}
                  {pickerResult.total} 张。
                </p>
              </>
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

// 卡面只跟随卡实例变化，输入、选槽和拖放高亮不重新生成卡面树。
const DeckFace = memo(function DeckFace({ row }: { row: ApiUserCard }) {
  return <GameCardFace card={toFace(row)} eager />
})
