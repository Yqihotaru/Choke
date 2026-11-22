import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"

import { playSfx } from "@/audio/sfx"
import { GameCardFace } from "@/card/GameCardFace"
import {
  ELEMENT_COLOR,
  ELEMENT_LABEL,
  RARITY_LABEL,
  battlePower,
  formatNo,
} from "@/card/data"
import { skillSeed, subjobFor } from "@/card/jobs"
import { FOIL_COST, MARKET_MAX_PRICE, essenceOf } from "@/card/economy"
import {
  constellationCap,
  expToNext,
  feedExpOf,
  isHeroCardId,
  levelCap,
  refundExpOf,
} from "@/card/progression"
import {
  EXP_ITEMS,
  ITEMS,
  SHARDS_PER_DISMANTLE,
  SHARD_ITEMS,
  expToItems,
  type ItemStack,
} from "@choke/shared/items"
import { useModal } from "@/ui/useModal"

import { useTutorialProgress } from "@/tutorial/store"
import { isModuleUnlocked, unlockLevelOf } from "@/tutorial/unlocks"

import {
  ascendCard,
  dismantleCard,
  enhanceCard,
  feedCard,
  fetchFuel,
  fetchMe,
  levelUpCard,
  listMarketCard,
  toFace,
  type ApiUserCard,
  type ItemWallet,
} from "./api"
import "./book.css"
import { ConfirmBar } from "./ConfirmBar"
import { emitDeskData } from "./events"
import "./card-detail.css"

interface Props {
  card: ApiUserCard
  userId: string | null
  readOnly?: boolean
  onClose: () => void
  onChanged?: () => void
}

type Pending =
  | { kind: "ascend" }
  | { kind: "melt"; source: ApiUserCard }
  | { kind: "list"; value: number }
  | { kind: "dismantle" }

interface Message {
  text: string
  error?: boolean
}

/** 分解成功后留这么久给玩家看反馈，再关弹窗 */
const DISMANTLE_CLOSE_MS = 1100

/** 先用经验道具、再用碎片，按单价从小到大凑够 need；尽量少溢出，也少动作为材料的碎片 */
function pickTopUp(wallet: ItemWallet, need: number): ItemStack[] {
  const picks: ItemStack[] = []
  let left = need
  const order = [...[...EXP_ITEMS].sort((a, b) => a.exp - b.exp), ...SHARD_ITEMS]
  for (const item of order) {
    if (left <= 0) break
    const owned = wallet[item.id] ?? 0
    const count = Math.min(owned, Math.ceil(left / item.exp))
    if (count > 0) {
      picks.push({ itemId: item.id, count })
      left -= count * item.exp
    }
  }
  return picks
}

function describeStacks(stacks: readonly ItemStack[]): string {
  return stacks.map((stack) => `${ITEMS[stack.itemId].name} ×${stack.count}`).join("、")
}

export function CardDetail({ card, userId, readOnly = false, onClose, onChanged }: Props) {
  const [current, setCurrent] = useState(card)
  const [fuel, setFuel] = useState<ApiUserCard[]>([])
  const [fuelOpen, setFuelOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [listed, setListed] = useState(false)
  const [essence, setEssence] = useState<number | null>(null)
  const [items, setItems] = useState<ItemWallet | null>(null)
  const [coins, setCoins] = useState<number | null>(null)
  const [isGuest, setIsGuest] = useState(false)
  const [price, setPrice] = useState("30")
  const progress = useTutorialProgress(userId)
  const marketUnlocked = isModuleUnlocked("market", progress)
  const dialogRef = useRef<HTMLDivElement>(null)
  const fuelController = useRef<AbortController | null>(null)
  const closeTimer = useRef<number | undefined>(undefined)

  const face = useMemo(() => toFace(current), [current])

  // Esc 先收起确认条，再关弹窗
  useModal(dialogRef, {
    onClose: () => (pending ? setPending(null) : onClose()),
  })

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  useEffect(() => {
    if (readOnly || !userId) return
    let cancelled = false
    fetchMe()
      .then((data) => {
        if (!cancelled) {
          setEssence(data.essence)
          setItems(data.items ?? {})
          setCoins(data.coins)
          setIsGuest(!!data.isGuest)
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

  useEffect(() => () => fuelController.current?.abort(), [])

  const hero = isHeroCardId(current.id)
  const cap = levelCap(hero)
  const conCap = constellationCap(hero)
  const need = expToNext(current.level, current.rarity, hero)
  const maxed = current.level >= cap
  const canLevel = !maxed && current.exp >= need
  const sameCardFuel = fuel.filter((row) => row.id === current.id).length
  const canAscend = current.constellation < conCap && sameCardFuel > 0
  const expPct = maxed ? 100 : Math.min(100, (current.exp / Math.max(1, need)) * 100)
  /** 物品只补到够升下一级为止，不多扣 */
  const topUpPicks = maxed || canLevel ? [] : pickTopUp(items ?? {}, need - current.exp)
  const itemExpTotal = Object.entries(items ?? {}).reduce(
    (sum, [id, count]) => sum + ITEMS[id as keyof typeof ITEMS].exp * (count ?? 0),
    0,
  )
  const dismantleRefund = expToItems(refundExpOf(current.level, current.exp, current.rarity, hero))
  const dismantleEssence = essenceOf(current.rarity, current.foil)
  const bp = battlePower(face)

  async function run<T extends { card: ApiUserCard }>(
    label: string,
    action: () => Promise<T>,
    done: (result: T) => string,
    sound: () => void,
  ) {
    if (!userId) return
    setBusy(label)
    setMessage(null)
    try {
      const result = await action()
      sound()
      setCurrent(result.card)
      const maybeWallet = result as { essence?: number; items?: ItemWallet }
      if (typeof maybeWallet.essence === "number") setEssence(maybeWallet.essence)
      if (maybeWallet.items) setItems(maybeWallet.items)
      setMessage({ text: done(result) })
      onChanged?.()
      loadFuel(result.card.userCardId)
    } catch (error) {
      playSfx("error")
      setMessage({ text: error instanceof Error ? error.message : "操作失败", error: true })
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

  const ascend = () => {
    if (!userId) return
    return run(
      "ascend",
      () => ascendCard(userId, current.userCardId),
      () => "命座 +1",
      () => playSfx("levelup", { rate: 1.25 }),
    )
  }

  const feedDone = (result: { gained: number; levelsGained: number; wasted: number; essenceGained: number }) =>
    [
      `+${result.gained} EXP`,
      result.levelsGained > 0 ? `升了 ${result.levelsGained} 级` : "",
      result.wasted > 0 ? `满级溢出 ${result.wasted}` : "",
      result.essenceGained > 0 ? `+${result.essenceGained} 精华` : "",
    ]
      .filter(Boolean)
      .join(" · ")

  const melt = (source: ApiUserCard) => {
    if (!userId) return
    return run(
      `melt-${source.userCardId}`,
      () => feedCard(userId, current.userCardId, { cards: [source.userCardId] }),
      feedDone,
      () => playSfx("melt"),
    )
  }

  const topUp = () => {
    if (!userId || topUpPicks.length === 0) return
    return run(
      "items",
      () => feedCard(userId, current.userCardId, { items: topUpPicks }),
      feedDone,
      () => playSfx("melt"),
    )
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

  /** 通用分解：任意卡 → 碎片（闪卡另给精华），保留最后一张。成功后先给反馈，稍后再关弹窗。 */
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
      setMessage({ text: `市场达到 Lv.${unlockLevelOf("market")} 解锁后才能上架`, error: true })
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
      setMessage({ text: error instanceof Error ? error.message : "上架失败", error: true })
    } finally {
      setBusy(null)
    }
  }

  const confirmPending = () => {
    const action = pending
    setPending(null)
    if (!action) return
    if (action.kind === "ascend") void ascend()
    else if (action.kind === "melt") void melt(action.source)
    else if (action.kind === "list") void list(action.value)
    else void dismantle()
  }

  const askMelt = (source: ApiUserCard) => {
    if (busy === null) setPending({ kind: "melt", source })
  }

  return createPortal(
    <div
      className="card-detail"
      role="dialog"
      aria-modal="true"
      aria-label={current.name}
      ref={dialogRef}
      onClick={onClose}
    >
      <div className="card-detail__panel" data-light onClick={(event) => event.stopPropagation()}>
        <button type="button" className="card-detail__close" onClick={onClose} aria-label="关闭">
          ×
        </button>

        <div className="card-detail__face">
          <GameCardFace card={face} />
        </div>

        <div className="card-detail__info">
          <div className="card-detail__eyebrow">
            {RARITY_LABEL[current.rarity]} · {subjobFor(skillSeed(current.id), current.job).label}
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
            <div className="bk-box card-detail__level">
              <div className="card-detail__level-head">
                <span>{maxed ? "MAX LEVEL" : `EXP ${current.exp} / ${need}`}</span>
                <em>{maxed ? "已满级" : `${Math.round(expPct)}%`}</em>
              </div>
              <div className="bk-bar card-detail__exp" style={{ "--p": expPct } as CSSProperties}>
                <i />
              </div>
              <div className="card-detail__actions">
                <button
                  type="button"
                  className="bk-btn bk-btn--main"
                  onClick={() => void levelUp()}
                  disabled={!canLevel || busy !== null}
                >
                  {busy === "level" ? "升级中…" : maxed ? "已满级" : `升级 · ${need} EXP`}
                </button>
                <button
                  type="button"
                  className="bk-btn"
                  onClick={() => setPending({ kind: "ascend" })}
                  disabled={!canAscend || busy !== null}
                  title={sameCardFuel > 0 ? `消耗 1 张同名卡（剩余 ${sameCardFuel}）` : "没有同名卡"}
                >
                  {busy === "ascend" ? "升命中…" : `升命座 ${current.constellation}/${conCap}`}
                </button>
                <button
                  type="button"
                  className="bk-btn"
                  onClick={() => setFuelOpen((open) => !open)}
                  disabled={maxed || busy !== null}
                  aria-expanded={fuelOpen && !maxed}
                >
                  喂卡换经验
                </button>
              </div>
              <div className="card-detail__wallet">
                <span>碎片 / 经验乐谱</span>
                <b className="bk-num">{items ? itemExpTotal.toLocaleString("en-US") : "—"}</b>
                <em>可折算 EXP</em>
              </div>
              <div className="card-detail__actions">
                <button
                  type="button"
                  className="bk-btn"
                  onClick={() => void topUp()}
                  disabled={topUpPicks.length === 0 || busy !== null}
                  title={topUpPicks.length > 0 ? describeStacks(topUpPicks) : undefined}
                >
                  {busy === "items"
                    ? "补经验中…"
                    : maxed
                      ? "已满级"
                      : canLevel
                        ? "经验已够升级"
                        : topUpPicks.length > 0
                          ? "补到下一级"
                          : "没有可用物品"}
                </button>
                {!hero && (
                  <button
                    type="button"
                    className="bk-btn bk-btn--danger"
                    onClick={() => setPending({ kind: "dismantle" })}
                    disabled={busy !== null}
                  >
                    {busy === "dismantle" ? "分解中…" : `分解 · ${SHARDS_PER_DISMANTLE} 碎片`}
                  </button>
                )}
              </div>
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
              {pending?.kind === "ascend" && (
                <ConfirmBar
                  confirmLabel="确认升命座"
                  message={`升命座：消耗 1 张同名卡（还剩 ${sameCardFuel} 张），${current.name} 的命座 ${current.constellation} → ${current.constellation + 1}。消耗的卡不会返还。`}
                  onCancel={() => setPending(null)}
                  onConfirm={confirmPending}
                />
              )}
              {pending?.kind === "dismantle" && (
                <ConfirmBar
                  danger
                  confirmLabel="确认分解"
                  message={`分解这张 ${current.name}？获得 ${SHARDS_PER_DISMANTLE} 个 ${current.rarity} 碎片${dismantleRefund.length > 0 ? `，返还 ${describeStacks(dismantleRefund)}` : ""}${dismantleEssence > 0 ? ` + ${dismantleEssence} 精华` : ""}，卡会消失（最后一张不能分解）。`}
                  onCancel={() => setPending(null)}
                  onConfirm={confirmPending}
                />
              )}
              {message && (
                <p
                  className={`card-detail__message ${message.error ? "is-error" : ""}`}
                  role={message.error ? "alert" : "status"}
                >
                  {message.text}
                </p>
              )}
            </div>
          )}

          {!readOnly && fuelOpen && !maxed && (
            <div className="card-detail__fuel">
              <div className="bk-label">可喂重复卡 · 同名卡 {sameCardFuel} 张</div>
              {pending?.kind === "melt" && (
                <ConfirmBar
                  danger
                  confirmLabel="确认喂掉"
                  message={`喂掉这张 ${pending.source.name}（${RARITY_LABEL[pending.source.rarity]}${pending.source.foil ? " · 闪" : ""} · Lv.${pending.source.level}）？获得 ${feedExpOf(pending.source)} EXP${pending.source.foil ? ` + ${essenceOf(pending.source.rarity, true)} 精华` : ""}，这张卡会消失。`}
                  onCancel={() => setPending(null)}
                  onConfirm={confirmPending}
                />
              )}
              {fuel.length === 0 ? (
                <p className="bk-note">没有重复卡。再抽到同一张卡后才能喂。</p>
              ) : (
                <div className="card-detail__fuel-grid">
                  {fuel.map((row) => (
                    <div
                      key={row.userCardId}
                      className={`card-detail__fuel-card ${busy === `melt-${row.userCardId}` ? "is-busy" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-disabled={busy !== null}
                      aria-label={`喂掉 ${row.name}，${RARITY_LABEL[row.rarity]}${row.foil ? "，闪卡" : ""}，Lv.${row.level}，获得 ${feedExpOf(row)} EXP`}
                      onClick={() => askMelt(row)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          askMelt(row)
                        }
                      }}
                    >
                      <GameCardFace card={toFace(row)} />
                      <span>+{feedExpOf(row)} EXP</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!readOnly && !hero && (
            <div className="card-detail__market">
              <div className="bk-label">市场 · 金币 {coins ?? "—"}</div>
              {isGuest ? (
                <p className="bk-note">
                  游客账号不能使用市场。请先退出，用 osu! 或邮箱登录后再交易。
                </p>
              ) : marketUnlocked ? (
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
                <p className="bk-note">
                  市场达到 Lv.{unlockLevelOf("market")} 解锁后才能上架。
                </p>
              )}
            </div>
          )}

          <div className="card-detail__meta">
            <span>ID: {formatNo(current.no, current.total).replace("/", " / ")}</span>
            {current.country && <span>{current.country}</span>}
            {current.globalRank != null && <span>#{current.globalRank}</span>}
            {current.pp != null && (
              <span>{Math.round(Number(current.pp)).toLocaleString("en-US")}pp</span>
            )}
          </div>

          <div className="card-detail__skills">
            <div className="bk-label">技能</div>
            {face.skills.map((skill, i) => (
              <div className="card-detail__skill" key={i}>
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
              </div>
            ))}
          </div>

          <p className="bk-note">
            {readOnly
              ? "图鉴数据 · 基础数值（Lv.1 / 0 命座），实际养成的卡面以卡册为准。"
              : "经验来自喂卡、碎片和经验乐谱。直接喂卡比分解成碎片再喂多 25%；升过级的卡按投入经验的 75% 返还。"}
          </p>

          {current.profileUrl && (
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
