import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"

import { playSfx } from "@/audio/sfx"
import { GameCardFace } from "@/card/GameCardFace"
import {
  ELEMENT_COLOR,
  ELEMENT_LABEL,
  JOB_LABEL,
  RARITY_LABEL,
  battlePower,
  formatNo,
} from "@/card/data"
import { FOIL_COST, MARKET_MAX_PRICE, essenceOf } from "@/card/economy"
import {
  breakthroughCoinCost,
  constellationCap,
  expToNext,
  investedExp,
  isHeroCardId,
  levelCap,
  totalExpAtLevel,
} from "@choke/shared/progression"
import { ITEMS, SHARDS_PER_DISMANTLE, shardItemId, type ItemStack } from "@choke/shared/items"
import { skillById } from "@choke/shared/skills"
import { describeSkill } from "@choke/shared/skill-check"
import {
  RESONANCE_ATTRIBUTES,
  RESONANCE_ATTR_CAP,
  RESONANCE_TOTAL_CAP,
} from "@choke/shared/resonance"
import { useModal } from "@/ui/useModal"

import { useTutorialProgress } from "@/tutorial/store"
import { isModuleUnlocked, lockHintOf } from "@/tutorial/unlocks"

import {
  ApiError,
  allocateExpPool,
  ascendCard,
  dismantleCard,
  enhanceCard,
  fetchFuel,
  fetchMe,
  fetchResonance,
  fetchSkillRerollInfo,
  fetchUserCards,
  levelUpCard,
  listMarketCard,
  rerollCardSkill,
  toFace,
  type ApiUserCard,
  type ItemWallet,
  type ResonanceOverview,
  type SkillRerollInfo,
} from "@/desk/session/api"
import "@/desk/book.css"
import { ConfirmBar } from "@/desk/shell/ConfirmBar"
import { emitDeskData } from "@/desk/session/events"
import "@/desk/panels/cards/card-detail.css"
import "@/desk/panels/cards/card-detail-fx.css"

interface Props {
  card: ApiUserCard
  userId: string | null
  readOnly?: boolean
  onClose: () => void
  onChanged?: () => void
}

type Pending =
  | { kind: "ascend"; material?: ApiUserCard }
  | { kind: "list"; value: number }
  | { kind: "dismantle" }

interface Message {
  text: string
  error?: boolean
}

/** 分解成功后留这么久给玩家看反馈，再关弹窗 */
const DISMANTLE_CLOSE_MS = 1100

function describeStacks(stacks: readonly ItemStack[]): string {
  return stacks.map((stack) => `${ITEMS[stack.itemId]?.name ?? stack.itemId} ×${stack.count}`).join("、")
}

export function CardDetail({ card, userId, readOnly = false, onClose, onChanged }: Props) {
  const [current, setCurrent] = useState(card)
  const [fuel, setFuel] = useState<ApiUserCard[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [listed, setListed] = useState(false)
  const [essence, setEssence] = useState<number | null>(null)
  const [expPool, setExpPool] = useState<number | null>(null)
  const [expAllocInput, setExpAllocInput] = useState("")
  const [items, setItems] = useState<ItemWallet | null>(null)
  const [coins, setCoins] = useState<number | null>(null)
  const [rerollInfo, setRerollInfo] = useState<SkillRerollInfo | null>(null)
  const [resonance, setResonance] = useState<ResonanceOverview | null>(null)
  const [mirrorCards, setMirrorCards] = useState<ApiUserCard[]>([])
  const [mirrorPickerOpen, setMirrorPickerOpen] = useState(false)
  const [selectingSlot, setSelectingSlot] = useState<number | null>(null)
  const [tab, setTab] = useState<"train" | "skills" | "manage">(readOnly ? "skills" : "train")
  const [price, setPrice] = useState("30")
  const progress = useTutorialProgress(userId)
  const marketUnlocked = isModuleUnlocked("market", progress)
  const dialogRef = useRef<HTMLDivElement>(null)
  const fuelController = useRef<AbortController | null>(null)
  const closeTimer = useRef<number | undefined>(undefined)

  const face = useMemo(() => toFace(current), [current])

  /** 玩家自己关掉（×、点外面、Esc）：合上的一声 */
  const close = () => {
    playSfx("close")
    onClose()
  }

  // Esc 先收起确认条，再关弹窗
  useModal(dialogRef, {
    onClose: () => (pending ? setPending(null) : close()),
  })

  useEffect(() => {
    // 卡被抽出来放到面前
    playSfx("paper")
    return () => window.clearTimeout(closeTimer.current)
  }, [])

  useEffect(() => {
    if (readOnly || !userId) return
    let cancelled = false
    fetchMe()
      .then((data) => {
        if (!cancelled) {
          setEssence(data.essence)
          setExpPool(data.expPool ?? 0)
          setItems(data.items ?? {})
          setCoins(data.coins)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [readOnly, userId])

  /** 重新拉可熔卡：新请求顶掉还没回来的旧请求，关弹窗时一并取消 */
  const loadFuel = (userCardId: number) => {
    if (!userId) return
    fuelController.current?.abort()
    const controller = new AbortController()
    fuelController.current = controller
    fetchFuel(userId, userCardId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setFuel(data.rows)
      })
      .catch(() => {})
  }

  useEffect(() => {
    if (readOnly || !userId) return
    const controller = new AbortController()
    fuelController.current = controller
    fetchFuel(userId, card.userCardId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setFuel(data.rows)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [readOnly, userId, card.userCardId])

  useEffect(() => {
    if (readOnly || !userId || isHeroCardId(card.id)) return
    const controller = new AbortController()
    fetchSkillRerollInfo(userId, card.userCardId, controller.signal)
      .then((info) => {
        if (!controller.signal.aborted) setRerollInfo(info)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [readOnly, userId, card.id, card.userCardId])

  useEffect(() => {
    if (readOnly || !userId || !isHeroCardId(card.id)) return
    const controller = new AbortController()
    fetchResonance(userId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResonance(data)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setMessage({
          text: reason instanceof Error ? `读取共鸣记录失败：${reason.message}` : "读取共鸣记录失败",
          error: true,
        })
      })
    ;(async () => {
      try {
        const first = await fetchUserCards(userId, {
          cardType: "mirror",
          limit: 60,
          page: 0,
          signal: controller.signal,
        })
        const all = [...first.rows]
        const totalPages = Math.ceil(first.total / 60)
        for (let p = 1; p < totalPages; p += 1) {
          if (controller.signal.aborted) return
          const next = await fetchUserCards(userId, {
            cardType: "mirror",
            limit: 60,
            page: p,
            signal: controller.signal,
          })
          all.push(...next.rows)
        }
        if (!controller.signal.aborted) {
          setMirrorCards(all)
        }
      } catch (reason: unknown) {
        if (controller.signal.aborted) return
        setMessage({
          text: reason instanceof Error ? `读取镜像卡列表失败：${reason.message}` : "读取镜像卡列表失败",
          error: true,
        })
      }
    })()
    return () => controller.abort()
  }, [readOnly, userId, card.id])

  useEffect(() => () => fuelController.current?.abort(), [])

  const hero = isHeroCardId(current.id)
  const cap = levelCap(hero)
  const conCap = constellationCap(hero)
  const need = expToNext(current.level, current.rarity, hero)
  const maxed = current.level >= cap
  const canLevel = !maxed && current.exp >= need
  const btCoins = breakthroughCoinCost(current.level, hero)
  const ownShardId = shardItemId(current.rarity)
  const ownShardCount = items?.[ownShardId] ?? 0
  const sameCardFuel = fuel.filter((row) => row.id === current.id).length
  const resonatedSources = useMemo(
    () => new Set(resonance?.records.map((r) => r.sourceCardId) ?? []),
    [resonance],
  )
  const availableMirrors = useMemo(
    () => mirrorCards.filter((m) => !resonatedSources.has(m.id)),
    [mirrorCards, resonatedSources],
  )
  const canAscend =
    current.constellation < conCap && (hero ? availableMirrors.length > 0 : sameCardFuel > 0)
  const expPct = maxed ? 100 : Math.min(100, (current.exp / Math.max(1, need)) * 100)
  const expRoom = Math.max(
    0,
    totalExpAtLevel(cap, current.rarity, hero) - investedExp(current.level, current.exp, current.rarity, hero),
  )
  const dismantleEssence = essenceOf(current.rarity, current.foil)
  const bp = battlePower(face)

  async function run<
    T extends { card: ApiUserCard; essence?: number; items?: ItemWallet; coins?: number },
  >(
    label: string,
    action: () => Promise<T>,
    done: (result: T) => string,
    sound: () => void,
  ) {
    if (!userId || busy !== null) return
    setBusy(label)
    setMessage(null)
    try {
      const result = await action()
      sound()
      setCurrent(result.card)
      if (typeof result.essence === "number") setEssence(result.essence)
      if (result.items) setItems(result.items)
      if (typeof result.coins === "number") setCoins(result.coins)
      setMessage({ text: done(result) })
      onChanged?.()
      loadFuel(result.card.userCardId)
    } catch (error) {
      playSfx("error")
      const code = error instanceof ApiError ? error.code : undefined
      let text: string
      if (code === "card_listed") {
        setListed(true)
        text = "这张卡正在市场上架，请先下架后再操作"
      } else if (code === "in_expedition") {
        text = "这张卡正在远征出征中，暂不能操作"
      } else if (code === "not_enough_coins") {
        text = "金币不足"
      } else if (code === "not_enough_exp") {
        text = "经验不足"
      } else if (code === "not_enough_items") {
        text = "材料不足"
      } else if (code === "already_foil") {
        text = "这张卡已经是闪卡了"
      } else if (code === "feature_locked") {
        text = error instanceof ApiError ? error.message : "功能暂未解锁"
      } else {
        text = error instanceof Error ? error.message : "操作失败"
      }
      setMessage({ text, error: true })
    } finally {
      setBusy(null)
    }
  }

  const levelUp = () => {
    if (!userId) return
    return run(
      "level",
      () => levelUpCard(userId, current.userCardId),
      (result) => `升级成功，消耗 ${result.spent} EXP`,
      () => playSfx("levelup"),
    )
  }

  const allocateExp = async (amount: number) => {
    if (!userId || busy !== null || listed) return
    if (!Number.isInteger(amount) || amount <= 0) {
      setMessage({ text: "请输入大于 0 的整数经验值", error: true })
      return
    }
    setBusy("exp-pool")
    setMessage(null)
    try {
      const result = await allocateExpPool(userId, current.userCardId, amount)
      playSfx("levelup")
      setCurrent(result.card)
      setExpPool(result.expPool)
      setExpAllocInput("")
      setMessage({ text: `已从经验池分配 +${result.spent.toLocaleString("en-US")} EXP` })
      onChanged?.()
      emitDeskData("user")
    } catch (error) {
      playSfx("error")
      const code = error instanceof ApiError ? error.code : undefined
      if (code === "not_enough_exp_pool") {
        fetchMe()
          .then((me) => setExpPool(me.expPool ?? 0))
          .catch(() => {})
      }
      let text: string
      if (code === "card_listed") {
        setListed(true)
        text = "挂在市场上的卡不能分配经验，请先下架"
      } else if (code === "max_level") {
        text = "已经满级，不需要经验了"
      } else if (code === "exp_over_cap" || code === "not_enough_exp_pool") {
        text = error instanceof ApiError ? error.message : "经验分配失败"
      } else {
        text = error instanceof Error ? error.message : "经验分配失败"
      }
      setMessage({ text, error: true })
    } finally {
      setBusy(null)
    }
  }

  const ascend = async (material?: ApiUserCard) => {
    if (!userId || busy !== null) return
    setBusy("ascend")
    setMessage(null)
    try {
      const result = await ascendCard(userId, current.userCardId, material?.userCardId)
      playSfx("levelup", { rate: 1.25 })
      setCurrent(result.card)
      if (result.resonance && result.summary) {
        setResonance({ records: result.resonance, summary: result.summary })
      }
      if (material) {
        setMirrorCards((prev) => prev.filter((c) => c.userCardId !== result.consumedUserCardId))
        setMirrorPickerOpen(false)
      }
      const resMsg = result.addedResonance
        ? `命座 +1 · 共鸣 +${(result.addedResonance.valueBp / 100).toFixed(1)}% ${result.addedResonance.attribute}`
        : result.capped
          ? "命座 +1（共鸣槽位已满）"
          : "命座 +1"
      setMessage({ text: resMsg })
      onChanged?.()
      loadFuel(result.card.userCardId)
    } catch (error) {
      playSfx("error")
      const code = error instanceof ApiError ? error.code : undefined
      let text: string
      if (code === "duplicate_source") text = "该镜像卡已提供过共鸣，请换一张不同的镜像卡"
      else if (code === "invalid_material") text = "只能消耗镜像卡为本体卡升命座"
      else if (code === "in_expedition") text = "选中的镜像卡正在远征出征中，暂不能消耗"
      else if (code === "max_constellation") text = "命座已达上限"
      else if (code === "missing_material") text = "请先选择一张镜像卡"
      else text = error instanceof Error ? error.message : "升命座失败"
      setMessage({ text, error: true })
    } finally {
      setBusy(null)
    }
  }

  const doReroll = async (slot: number, skillId?: string) => {
    if (!userId || busy !== null || listed) return
    setBusy(`reroll-${slot}`)
    setMessage(null)
    try {
      const result = await rerollCardSkill(userId, current.userCardId, { slot, skillId })
      playSfx("shine")
      setCurrent(result.card)
      setCoins(result.coins)
      setItems(result.items)
      setSelectingSlot(null)
      setRerollInfo((prev) =>
        prev
          ? {
              ...prev,
              skillRerollCount: result.skillRerollCount,
              pityInterval: result.pityInterval,
              remainingUntilSelect: Math.max(0, result.pityInterval - 1 - result.skillRerollCount),
              selectReady: result.selectReady,
            }
          : prev,
      )
      const prevName = skillById(result.previousSkillId)?.name ?? result.previousSkillId
      const nextName = skillById(result.newSkillId)?.name ?? result.newSkillId
      setMessage({
        text: `${result.mode === "select" ? "自选洗技能" : "随机洗技能"}：${prevName} → ${nextName}`,
      })
      onChanged?.()
      fetchSkillRerollInfo(userId, current.userCardId)
        .then((freshInfo) => setRerollInfo(freshInfo))
        .catch(() => {})
    } catch (error) {
      playSfx("error")
      const code = error instanceof ApiError ? error.code : undefined
      if (code === "card_listed") {
        setListed(true)
        setSelectingSlot(null)
        setMessage({ text: "这张卡正在市场上架，请先下架后再洗技能", error: true })
      } else if (code === "in_expedition") {
        setSelectingSlot(null)
        setMessage({ text: "这张卡正在远征出征中，暂不能洗技能", error: true })
      } else if (code === "select_not_ready" || code === "skill_id_required") {
        fetchSkillRerollInfo(userId, current.userCardId)
          .then((fresh) => setRerollInfo(fresh))
          .catch(() => {})
        setMessage({ text: error instanceof Error ? error.message : "洗技能状态已变化，已刷新", error: true })
      } else if (code === "not_enough_coins") {
        setMessage({ text: error instanceof Error ? error.message : "金币不足，无法洗技能", error: true })
      } else if (code === "not_enough_items") {
        setMessage({ text: error instanceof Error ? error.message : "同品质碎片不足，无法洗技能", error: true })
      } else {
        setMessage({ text: error instanceof Error ? error.message : "洗技能失败", error: true })
      }
    } finally {
      setBusy(null)
    }
  }

  const enhance = () => {
    if (!userId) return
    return run(
      "foil",
      () => enhanceCard(userId, current.userCardId, "foil"),
      () => "已镀闪，卡面获得闪卡外观",
      () => playSfx("shine"),
    )
  }

  /** 通用分解：任意卡 → 碎片（闪卡另给精华），本体卡除外。成功后先给反馈，稍后再关弹窗。 */
  const dismantle = async () => {
    if (!userId || busy !== null) return
    setBusy("dismantle")
    setMessage(null)
    let ok = false
    try {
      const result = await dismantleCard(userId, current.userCardId)
      ok = true
      playSfx("shatter")
      setEssence(result.essence)
      setItems(result.items)
      setMessage({
        text:
          result.essenceGained > 0
            ? `已分解 · ${describeStacks(result.itemsGained)} · +${result.essenceGained} 精华`
            : `已分解 · ${describeStacks(result.itemsGained)}`,
      })
      onChanged?.()
      emitDeskData("packs")
      closeTimer.current = window.setTimeout(onClose, DISMANTLE_CLOSE_MS)
    } catch (error) {
      playSfx("error")
      setMessage({ text: error instanceof Error ? error.message : "分解失败", error: true })
    } finally {
      if (!ok) setBusy(null)
    }
  }

  const askList = () => {
    if (!userId || busy !== null) return
    if (!marketUnlocked) {
      setMessage({ text: `${lockHintOf("market", progress)}，现在不能上架`, error: true })
      return
    }
    const value = Number(price)
    if (!Number.isInteger(value) || value <= 0 || value > MARKET_MAX_PRICE) {
      setMessage({
        text: `价格必须是 1 – ${MARKET_MAX_PRICE.toLocaleString("en-US")} 的整数`,
        error: true,
      })
      return
    }
    setMessage(null)
    setPending({ kind: "list", value })
  }

  const list = async (value: number) => {
    if (!userId || busy !== null) return
    setBusy("list")
    setMessage(null)
    try {
      await listMarketCard(userId, current.userCardId, value)
      playSfx("coin")
      setListed(true)
      setMessage({ text: `已上架市场 · ${value.toLocaleString("en-US")} 金币` })
      onChanged?.()
      emitDeskData("packs")
    } catch (error) {
      playSfx("error")
      const code = error instanceof ApiError ? error.code : undefined
      let text: string
      if (code === "already_listed") {
        setListed(true)
        text = "这张卡已经在市场上架了"
      } else if (code === "in_deck") {
        text = "这张卡正在卡组中，请先从卡组移出后再上架"
      } else if (code === "in_expedition") {
        text = "这张卡正在远征出征中，暂不能上架"
      } else if (code === "not_enough_coins") {
        text = "金币不足以支付上架押金"
      } else if (code === "price_out_of_band" || code === "feature_locked") {
        text = error instanceof ApiError ? error.message : "无法上架"
      } else {
        text = error instanceof Error ? error.message : "上架失败"
      }
      setMessage({ text, error: true })
    } finally {
      setBusy(null)
    }
  }

  const confirmPending = () => {
    const action = pending
    setPending(null)
    if (!action) return
    if (action.kind === "ascend") void ascend(action.material)
    else if (action.kind === "list") void list(action.value)
    else void dismantle()
  }

  return createPortal(
    <div
      className="card-detail"
      role="dialog"
      aria-modal="true"
      aria-label={current.name}
      ref={dialogRef}
      onClick={close}
    >
      <div className="card-detail__panel" data-light onClick={(event) => event.stopPropagation()}>
        <button type="button" className="card-detail__close" onClick={close} aria-label="关闭">
          ×
        </button>

        <div className="card-detail__face">
          <GameCardFace card={face} />
        </div>

        <div className="card-detail__info">
          <div className="card-detail__eyebrow">
            {RARITY_LABEL[current.rarity]} · {JOB_LABEL[current.job]}
            {current.foil ? " · ✦ FLASH" : ""}
          </div>
          <h2 className="card-detail__name">{current.name}</h2>

          <div className="card-detail__stats">
            {readOnly ? (
              <>
                <div className="bk-stat">
                  <span>品质</span>
                  <b>{RARITY_LABEL[current.rarity]}</b>
                </div>
                <div className="bk-stat">
                  <span>战力</span>
                  <b>{bp.toLocaleString("en-US")}</b>
                </div>
                <div className="bk-stat">
                  <span>图鉴编号</span>
                  <b>{formatNo(current.no, current.total).replace("/", " / ")}</b>
                </div>
              </>
            ) : (
              <>
                <div className="bk-stat">
                  <span>等级</span>
                  <b>
                    Lv.{current.level} / {cap}
                  </b>
                </div>
                <div className="bk-stat">
                  <span>命座</span>
                  <b>
                    {current.constellation} / {conCap}
                  </b>
                </div>
                <div className="bk-stat">
                  <span>战力</span>
                  <b>{bp.toLocaleString("en-US")}</b>
                </div>
              </>
            )}
          </div>

          {!readOnly && (
            <div className="card-detail__tabs" role="tablist" aria-label="卡牌操作分区">
              <button
                type="button"
                role="tab"
                className="card-detail__tab"
                aria-selected={tab === "train"}
                onClick={() => {
                  playSfx("tick")
                  setTab("train")
                }}
              >
                养成
              </button>
              <button
                type="button"
                role="tab"
                className="card-detail__tab"
                aria-selected={tab === "skills"}
                onClick={() => {
                  playSfx("tick")
                  setTab("skills")
                }}
              >
                技能{rerollInfo?.selectReady ? " ★" : ""}
              </button>
              <button
                type="button"
                role="tab"
                className="card-detail__tab"
                aria-selected={tab === "manage"}
                onClick={() => {
                  playSfx("tick")
                  setTab("manage")
                }}
              >
                交易 / 处置
              </button>
            </div>
          )}

          {message && (
            <p
              className={`card-detail__message ${message.error ? "is-error" : ""}`}
              role={message.error ? "alert" : "status"}
            >
              {message.text}
            </p>
          )}

          {!readOnly && tab === "train" && (
            <div className="bk-box card-detail__level">
              <div className="card-detail__level-head">
                <span>{maxed ? "MAX LEVEL" : `EXP ${current.exp} / ${need}`}</span>
                <em>{maxed ? "已满级" : `${Math.round(expPct)}%`}</em>
              </div>
              <div className="bk-bar card-detail__exp" style={{ "--p": expPct } as CSSProperties}>
                <i />
              </div>
              <div className="card-detail__actions">
                {canLevel && (
                  <button
                    type="button"
                    className="bk-btn bk-btn--main"
                    onClick={() => void levelUp()}
                    disabled={busy !== null}
                  >
                    {busy === "level"
                      ? "突破中…"
                      : btCoins > 0
                        ? `突破升级（${btCoins} 金币）`
                        : `升级 · ${need} EXP`}
                  </button>
                )}
                <button
                  type="button"
                  className="bk-btn"
                  onClick={() => {
                    if (hero) setMirrorPickerOpen((open) => !open)
                    else setPending({ kind: "ascend" })
                  }}
                  disabled={!canAscend || busy !== null}
                  title={
                    hero
                      ? availableMirrors.length > 0
                        ? `选择 1 张镜像卡升命座（可用 ${availableMirrors.length} 张）`
                        : "没有可用的未共鸣镜像卡"
                      : sameCardFuel > 0
                        ? `消耗 1 张同名卡（剩余 ${sameCardFuel}）`
                        : "没有同名卡"
                  }
                >
                  {busy === "ascend" ? "升命中…" : `升命座 ${current.constellation}/${conCap}`}
                </button>
              </div>
              <div className="card-detail__wallet">
                <span>经验池</span>
                <b className="bk-num">{expPool != null ? expPool.toLocaleString("en-US") : "—"}</b>
                <em>远征累计获得，可自由分给任意卡</em>
              </div>
              {!maxed && expRoom > 0 && (expPool ?? 0) > 0 && !listed && (
                <div className="card-detail__actions">
                  {!canLevel && (
                    <button
                      type="button"
                      className="bk-btn bk-btn--sm bk-btn--main"
                      disabled={busy !== null}
                      onClick={() =>
                        void allocateExp(Math.min(expPool ?? 0, Math.max(1, need - current.exp)))
                      }
                    >
                      {busy === "exp-pool"
                        ? "分配中…"
                        : `补到下一级 (+${Math.min(expPool ?? 0, Math.max(1, need - current.exp)).toLocaleString("en-US")})`}
                    </button>
                  )}
                  <button
                    type="button"
                    className="bk-btn bk-btn--sm"
                    disabled={busy !== null}
                    onClick={() => void allocateExp(Math.min(expPool ?? 0, expRoom))}
                  >
                    {expPool! >= expRoom
                      ? `一次喂到满级 (+${expRoom.toLocaleString("en-US")})`
                      : `全部投入 (+${(expPool ?? 0).toLocaleString("en-US")})`}
                  </button>
                  <div className="card-detail__market-row">
                    <input
                      className="bk-input bk-num"
                      type="number"
                      min={1}
                      max={Math.min(expPool ?? 0, expRoom)}
                      placeholder="自定义"
                      value={expAllocInput}
                      onChange={(event) => setExpAllocInput(event.target.value)}
                      aria-label="自定义分配经验值"
                    />
                    <button
                      type="button"
                      className="bk-btn bk-btn--sm"
                      disabled={busy !== null || !expAllocInput.trim()}
                      onClick={() => void allocateExp(Number(expAllocInput))}
                    >
                      分配
                    </button>
                  </div>
                </div>
              )}
              {!hero && (
                <div className="card-detail__wallet">
                  <span>{RARITY_LABEL[current.rarity]} 碎片</span>
                  <b className="bk-num">{items ? ownShardCount : "—"}</b>
                  <em>用于洗技能</em>
                </div>
              )}
              <div className="card-detail__wallet">
                <span>闪卡精华</span>
                <b className="bk-num">{essence ?? "—"}</b>
                <em>只来自分解闪卡，只能用于镀闪</em>
              </div>
              <div className="card-detail__actions">
                <button
                  type="button"
                  className="bk-btn"
                  onClick={() => void enhance()}
                  disabled={current.foil || busy !== null || (essence ?? 0) < FOIL_COST}
                >
                  {current.foil ? "已是闪卡" : `精华镀闪 · ${FOIL_COST}`}
                </button>
              </div>
              {hero && resonance && (
                <div className="card-detail__resonance">
                  <div className="card-detail__resonance-head">
                    <span>本体共鸣</span>
                    <b className="bk-num">
                      {resonance.summary.totalSlots}/{RESONANCE_TOTAL_CAP}
                    </b>
                  </div>
                  <div className="card-detail__resonance-grid">
                    {RESONANCE_ATTRIBUTES.map((attr) => {
                      const bp = resonance.summary.totalBpByAttr[attr]
                      const cnt = resonance.summary.countsByAttr[attr]
                      return (
                        <div key={attr} className="card-detail__resonance-stat">
                          <span>{attr}</span>
                          <b className="bk-num">+{(bp / 100).toFixed(1)}%</b>
                          <em>
                            {cnt}/{RESONANCE_ATTR_CAP}
                          </em>
                        </div>
                      )
                    })}
                  </div>
                  {resonance.records.length > 0 ? (
                    <ul className="card-detail__resonance-list">
                      {resonance.records.map((rec) => (
                        <li key={rec.slot}>
                          <span>#{rec.slot}</span>
                          <b>{rec.sourceCardId}</b>
                          <em className="bk-num">
                            +{(rec.valueBp / 100).toFixed(1)}% {rec.attribute}
                          </em>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="card-detail__resonance-empty">
                      尚无共鸣记录，升命座吞噬镜像卡可获得属性加成。
                    </p>
                  )}
                </div>
              )}
              {hero && mirrorPickerOpen && current.constellation < conCap && (
                <div className="card-detail__mirror-picker">
                  <div className="card-detail__resonance-head">
                    <span>选择消耗的镜像卡（同时触发共鸣）</span>
                    <button
                      type="button"
                      className="bk-btn bk-btn--sm"
                      onClick={() => setMirrorPickerOpen(false)}
                    >
                      收起
                    </button>
                  </div>
                  {mirrorCards.length === 0 ? (
                    <p className="card-detail__resonance-empty">背包/卡册里还没有镜像卡。</p>
                  ) : (
                    <div className="card-detail__mirror-list">
                      {mirrorCards.map((m) => {
                        const alreadyUsed = resonatedSources.has(m.id)
                        return (
                          <button
                            key={m.userCardId}
                            type="button"
                            className="bk-btn bk-btn--sm"
                            disabled={alreadyUsed || busy !== null}
                            title={alreadyUsed ? "该镜像卡已提供过共鸣" : `消耗 ${m.name} 升命座`}
                            onClick={() => setPending({ kind: "ascend", material: m })}
                          >
                            {m.name} · {RARITY_LABEL[m.rarity]} Lv.{m.level}
                            {alreadyUsed ? "（已共鸣）" : ""}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
              {pending?.kind === "ascend" && (
                <ConfirmBar
                  busy={busy !== null}
                  confirmLabel="确认升命座"
                  message={
                    pending.material
                      ? `升命座：消耗镜像卡「${pending.material.name}」（Lv.${pending.material.level}），${current.name} 的命座 ${current.constellation} → ${current.constellation + 1}，并触发共鸣。消耗的卡不会返还。`
                      : `升命座：消耗 1 张同名卡（还剩 ${sameCardFuel} 张），${current.name} 的命座 ${current.constellation} → ${current.constellation + 1}。消耗的卡不会返还。`
                  }
                  onCancel={() => setPending(null)}
                  onConfirm={confirmPending}
                />
              )}
            </div>
          )}

          {!readOnly && tab === "manage" && !hero && (
            <div className="card-detail__market">
              <div className="bk-label">市场 · 金币 {coins ?? "—"}</div>
              {marketUnlocked ? (
                <>
                  <div className="card-detail__market-row">
                    <input
                      className="bk-input bk-num"
                      type="number"
                      min={1}
                      max={MARKET_MAX_PRICE}
                      value={price}
                      onChange={(event) => setPrice(event.target.value)}
                      aria-label="上架价格"
                    />
                    <span>金币</span>
                    <button
                      type="button"
                      className="bk-btn"
                      onClick={askList}
                      disabled={busy !== null || listed}
                    >
                      {busy === "list" ? "上架中…" : listed ? "已上架" : "上架市场"}
                    </button>
                  </div>
                  {pending?.kind === "list" && (
                    <ConfirmBar
                      busy={busy !== null}
                      confirmLabel="确认上架"
                      message={`以 ${pending.value.toLocaleString("en-US")} 金币上架 ${current.name}？上架后其他玩家可以直接买下，你可以随时下架。`}
                      onCancel={() => setPending(null)}
                      onConfirm={confirmPending}
                    />
                  )}
                  <p className="bk-note">
                    上架后其他玩家可以购买；下架后继续留在卡册。
                  </p>
                </>
              ) : (
                <p className="bk-note">{lockHintOf("market", progress)}，现在不能上架。</p>
              )}
            </div>
          )}

          {(readOnly || tab === "manage") && (
            <div className="card-detail__meta">
              <span>ID: {formatNo(current.no, current.total).replace("/", " / ")}</span>
              {current.country && <span>{current.country}</span>}
              {current.globalRank != null && <span>#{current.globalRank}</span>}
              {current.pp != null && (
                <span>{Math.round(Number(current.pp)).toLocaleString("en-US")}pp</span>
              )}
            </div>
          )}

          {(readOnly || tab === "skills") && (
            <div className="card-detail__skills">
              <div className="card-detail__reroll-head">
                <div className="bk-label">技能</div>
                {!readOnly && !hero && rerollInfo && (
                  <span className="card-detail__reroll-pity">
                    {rerollInfo.selectReady
                      ? `★ 已触发逢 ${rerollInfo.pityInterval} 自选`
                      : `洗技能保底 ${rerollInfo.skillRerollCount}/${rerollInfo.pityInterval - 1}`}
                    {" · "}
                    {rerollInfo.cost.shards} {RARITY_LABEL[current.rarity]} 碎片 + {rerollInfo.cost.coins} 金币
                  </span>
                )}
              </div>
              {face.skills.map((skill, i) => {
                const def = skillById(skill.id)
                const descText = def ? describeSkill(def) : ""
                const canReroll = !readOnly && !hero && rerollInfo && rerollInfo.candidates.length > 0
                const isPicking = selectingSlot === i && rerollInfo?.selectReady
                return (
                  <div className="card-detail__skill" key={`${skill.id}-${i}`}>
                    <div className="card-detail__skill-head">
                      <span
                        className="card-detail__element"
                        style={{ "--el": ELEMENT_COLOR[skill.element] } as CSSProperties}
                        title={ELEMENT_LABEL[skill.element]}
                      />
                      <b>{skill.name}</b>
                      <em>{ELEMENT_LABEL[skill.element]}</em>
                      <span className="card-detail__cost">
                        {skill.passive ? "被动" : `${skill.ap} AP`}
                      </span>
                      {canReroll && (
                        <button
                          type="button"
                          className={`bk-btn bk-btn--sm ${rerollInfo.selectReady ? "bk-btn--main" : "bk-btn--ghost"}`}
                          disabled={busy !== null || listed}
                          title={listed ? "已上架市场的卡不能洗技能" : undefined}
                          onClick={() => {
                            if (rerollInfo.selectReady) {
                              setSelectingSlot(isPicking ? null : i)
                            } else {
                              void doReroll(i)
                            }
                          }}
                        >
                          {busy === `reroll-${i}`
                            ? "洗技能中…"
                            : rerollInfo.selectReady
                              ? isPicking
                                ? "收起自选"
                                : "自选替换"
                              : "重洗"}
                        </button>
                      )}
                    </div>
                    {descText && <p className="card-detail__skill-desc">{descText}</p>}
                    {isPicking && rerollInfo && (
                      <div className="card-detail__reroll-pool">
                        {rerollInfo.candidates.map((cand) => (
                          <button
                            key={cand.id}
                            type="button"
                            className="card-detail__reroll-opt"
                            disabled={busy !== null}
                            onClick={() => void doReroll(i, cand.id)}
                          >
                            <div className="card-detail__reroll-opt-top">
                              <span
                                className="card-detail__element"
                                style={{ "--el": ELEMENT_COLOR[cand.element] } as CSSProperties}
                              />
                              <b>{cand.name}</b>
                              <em>{ELEMENT_LABEL[cand.element]}</em>
                              <span className="card-detail__cost">
                                {cand.passive ? "被动" : `${cand.ap} AP`}
                              </span>
                            </div>
                            {cand.desc && <p>{cand.desc}</p>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!readOnly && tab === "manage" && !hero && (
            <div className="card-detail__dispose">
              <div className="bk-label">处置</div>
              <div className="card-detail__actions">
                <button
                  type="button"
                  className="bk-btn bk-btn--danger"
                  onClick={() => setPending({ kind: "dismantle" })}
                  disabled={busy !== null || listed}
                  title={listed ? "已上架市场的卡不能分解" : undefined}
                >
                  {busy === "dismantle" ? "分解中…" : `分解此卡 · 得 ${SHARDS_PER_DISMANTLE} ${RARITY_LABEL[current.rarity]} 碎片`}
                </button>
              </div>
              {pending?.kind === "dismantle" && (
                <ConfirmBar
                  danger
                  busy={busy !== null}
                  confirmLabel="确认分解"
                  message={`分解这张 ${current.name}？获得 ${SHARDS_PER_DISMANTLE} 个 ${RARITY_LABEL[current.rarity]} 碎片${dismantleEssence > 0 ? ` + ${dismantleEssence} 精华` : ""}，卡会消失。`}
                  onCancel={() => setPending(null)}
                  onConfirm={confirmPending}
                />
              )}
            </div>
          )}

          {(readOnly || tab === "manage") && (
            <p className="bk-note">
              {readOnly
                ? "图鉴数据 · 基础数值（Lv.1 / 0 命座），实际养成的卡面以卡册为准。"
                : "分解只给碎片（闪卡另给精华），升过的等级不会返还。"}
            </p>
          )}

          {(readOnly || tab === "manage") && current.profileUrl && (
            <a className="bk-btn bk-btn--ghost card-detail__link" href={current.profileUrl} target="_blank" rel="noreferrer">
              查看 osu! 主页
              <i aria-hidden>›</i>
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
