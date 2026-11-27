import { useEffect, useState } from "react"

import { playSfx } from "@/audio/sfx"
import { GameCardFace } from "@/card/GameCardFace"
import { RARITY_LABEL } from "@/card/data"
import type { OsuDailyView } from "@choke/shared/osu-daily"
import type { QuestsOverview, ResettingPeriod } from "@choke/shared/quests"

import {
  ApiError,
  bindEmail,
  checkOsuDaily,
  claimAllQuests,
  claimQuestChest,
  fetchMe,
  fetchOsuDaily,
  fetchPendingBind,
  fetchQuests,
  signIn,
  toFace,
  type AccountKind,
  type AccountMe,
  type ApiUserCard,
  type PendingBind,
} from "@/desk/session/api"
import { emitDeskData } from "@/desk/session/events"
import { Pages } from "@/desk/shell/BookPages"
import { ConfirmBar } from "@/desk/shell/ConfirmBar"
import { GuestLoginButton } from "@/desk/login/GuestLoginButton"
import { BindChoice } from "@/desk/panels/player/BindChoice"
import {
  bindErrorText,
  markBindReturnConsumed,
  peekBindReturn,
} from "@/desk/panels/player/bind-return"
import "@/desk/panels/player/account-panel.css"

const PERIOD_LABEL: Record<ResettingPeriod, string> = {
  daily: "每日活跃",
  weekly: "每周活跃",
  monthly: "每月活跃",
}

const KIND_TEXT: Record<AccountKind, string> = {
  osu: "已连接 osu!",
  email: "邮箱账号（未绑定 osu!）",
  guest: "游客账户（未绑定 osu!）",
}

function kindOf(me: AccountMe): AccountKind {
  if (me.kind) return me.kind
  if (me.osuId != null) return "osu"
  return me.email ? "email" : "guest"
}

export function AccountPanel({
  userId,
  username,
  publicId,
  avatarUrl,
  essence = 0,
  coins = 0,
  hero,
  onLogout,
  onOpenBackpack,
}: {
  userId: string | null
  username: string | null
  publicId?: number | null
  avatarUrl?: string | null
  essence?: number
  coins?: number
  hero?: ApiUserCard | null
  onLogout?: () => void
  onOpenBackpack?: () => void
}) {
  /** 记下加载失败的那个地址：换了头像地址就自然不算失败 */
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [quests, setQuests] = useState<QuestsOverview | null>(null)
  const [questBusy, setQuestBusy] = useState<"sign-in" | "claim-all" | `chest:${ResettingPeriod}:${number}` | null>(null)
  const [questMessage, setQuestMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [osuDaily, setOsuDaily] = useState<OsuDailyView | null>(null)
  const [osuDailyCooldown, setOsuDailyCooldown] = useState(0)
  const [osuDailyBusy, setOsuDailyBusy] = useState(false)
  const [osuDailyMessage, setOsuDailyMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const avatarError = failedAvatar === avatarUrl
  /** 账号类型以服务端为准（绑定之后邮箱号的 id 前缀不会变），没取回来前是 null */
  const [meState, setMe] = useState<AccountMe | null>(null)
  const [pendingState, setPending] = useState<PendingBind | null>(null)
  const me = userId ? meState : null
  const pending = userId ? pendingState : null
  const kind = me ? kindOf(me) : null
  const isGuest = kind === "guest"
  /** 从 osu! 授权回来的结果：只在面板第一次打开时显示一次 */
  const [bindReturn] = useState(peekBindReturn)
  const [bindMessage, setBindMessage] = useState<{ text: string; error?: boolean } | null>(() =>
    bindReturn?.result === "linked"
      ? { text: "已绑定 osu! 账号。去背包开神秘卡包，领取你的本体卡。" }
      : bindReturn?.result === "error"
        ? { text: bindErrorText(bindReturn.reason), error: true }
        : null,
  )
  const [emailForm, setEmailForm] = useState({ email: "", password: "" })
  const [emailBusy, setEmailBusy] = useState(false)

  useEffect(() => {
    markBindReturnConsumed()
    if (bindReturn?.result === "linked") {
      emitDeskData("user")
      emitDeskData("packs")
    }
  }, [bindReturn])

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    fetchMe(controller.signal)
      .then((data) => setMe(data))
      .catch(() => {})
    fetchPendingBind(controller.signal)
      .then((data) => {
        setPending(data.pending)
        if (bindReturn?.result === "choose" && !data.pending) {
          setBindMessage({ text: "这次绑定的确认已经过期，请重新点一次绑定 osu!", error: true })
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [userId, bindReturn])

  const handleBindEmail = async () => {
    if (emailBusy) return
    setEmailBusy(true)
    setBindMessage(null)
    try {
      const res = await bindEmail(emailForm.email.trim(), emailForm.password)
      setEmailForm({ email: "", password: "" })
      setMe(await fetchMe())
      emitDeskData("user")
      playSfx("success")
      setBindMessage({ text: `已绑定邮箱 ${res.email}，之后可以用它登录这个账号。` })
    } catch (reason) {
      playSfx("error")
      setBindMessage({ text: reason instanceof Error ? reason.message : "绑定邮箱失败", error: true })
    } finally {
      setEmailBusy(false)
    }
  }

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    fetchQuests(userId, controller.signal)
      .then((data) => setQuests(data))
      .catch(() => {})
    fetchOsuDaily(userId, controller.signal)
      .then((data) => {
        setOsuDaily(data)
        setOsuDailyCooldown(data.cooldownSeconds)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [userId])

  useEffect(() => {
    if (osuDailyCooldown <= 0) return
    const timer = window.setInterval(() => {
      setOsuDailyCooldown((prev) => (prev > 1 ? prev - 1 : 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [osuDailyCooldown])

  const handleSignIn = async () => {
    if (!userId || questBusy) return
    setQuestBusy("sign-in")
    setQuestMessage(null)
    try {
      await signIn(userId)
      const next = await fetchQuests(userId)
      setQuests(next)
      emitDeskData("user")
      emitDeskData("packs")
      emitDeskData("items")
      playSfx("success")
      setQuestMessage({ text: "今日已签到，可继续一键领任务与新手补给。" })
    } catch (reason) {
      playSfx("error")
      setQuestMessage({ text: reason instanceof Error ? reason.message : "签到失败", error: true })
    } finally {
      setQuestBusy(null)
    }
  }

  const handleClaimAll = async () => {
    if (!userId || questBusy) return
    setQuestBusy("claim-all")
    setQuestMessage(null)
    try {
      const res = await claimAllQuests(userId)
      const next = await fetchQuests(userId)
      setQuests(next)
      emitDeskData("user")
      emitDeskData("packs")
      emitDeskData("items")
      playSfx("levelup")
      const summary = res.rewards.map((r) => `${r.label} ×${r.count}`).join(" · ")
      setQuestMessage({ text: summary ? `已领取：${summary}` : "当前没有可领奖励" })
    } catch (reason) {
      playSfx("error")
      setQuestMessage({ text: reason instanceof Error ? reason.message : "领取失败", error: true })
    } finally {
      setQuestBusy(null)
    }
  }

  const handleClaimChest = async (period: ResettingPeriod, at: number) => {
    if (!userId || questBusy) return
    setQuestBusy(`chest:${period}:${at}`)
    setQuestMessage(null)
    try {
      const res = await claimQuestChest(userId, period, at)
      const next = await fetchQuests(userId)
      setQuests(next)
      emitDeskData("user")
      emitDeskData("packs")
      emitDeskData("items")
      playSfx("levelup")
      const summary = res.rewards.map((r) => `${r.label} ×${r.count}`).join(" · ")
      setQuestMessage({ text: summary ? `已领取宝箱：${summary}` : "已领取宝箱" })
    } catch (reason) {
      playSfx("error")
      const code = reason instanceof ApiError ? reason.code : undefined
      let text: string
      if (code === "not_done") text = "活跃点还不够，无法领取该宝箱"
      else if (code === "already_claimed") text = "这个宝箱已经领过了"
      else if (code === "not_found") text = "没有找到这个宝箱"
      else if (code === "feature_locked") text = reason instanceof ApiError ? reason.message : "功能暂未解锁"
      else text = reason instanceof Error ? reason.message : "领取宝箱失败"
      setQuestMessage({ text, error: true })
    } finally {
      setQuestBusy(null)
    }
  }

  const handleCheckOsuDaily = async () => {
    if (!userId || osuDailyBusy || osuDailyCooldown > 0) return
    setOsuDailyBusy(true)
    setOsuDailyMessage(null)
    try {
      const res = await checkOsuDaily(userId)
      const [nextDaily, nextQuests] = await Promise.all([
        fetchOsuDaily(userId),
        fetchQuests(userId).catch(() => null),
      ])
      setOsuDaily(nextDaily)
      setOsuDailyCooldown(nextDaily.cooldownSeconds)
      if (nextQuests) setQuests(nextQuests)
      if (res.passed) {
        playSfx("levelup")
        setOsuDailyMessage({
          text: res.alreadyPassed
            ? "今日推荐谱面已通过"
            : "成绩达标！已计入今日推荐谱面任务，可点击一键领奖励",
        })
      } else {
        playSfx("error")
        setOsuDailyMessage({
          text:
            res.reason === "no-score"
              ? "今天还没找到你在该谱面的 standard Pass 成绩"
              : `找到 ${res.found} 条今日成绩，但未达到最低要求`,
          error: true,
        })
      }
    } catch (reason) {
      playSfx("error")
      const code = reason instanceof ApiError ? reason.code : undefined
      if (code === "cooldown" || code === "osu_busy") {
        fetchOsuDaily(userId)
          .then((next) => {
            setOsuDaily(next)
            setOsuDailyCooldown(next.cooldownSeconds)
          })
          .catch(() => {})
      }
      let text: string
      if (code === "no_osu_daily") text = "今天没有推荐谱面"
      else if (code === "osu_not_linked") text = "需要绑定 osu! 账号才能检查成绩"
      else if (code === "osu_unavailable") text = "暂时连不上 osu!，请稍后再试"
      else if (code === "cooldown" || code === "osu_busy" || code === "feature_locked") {
        text = reason instanceof ApiError ? reason.message : "请稍后再试"
      } else {
        text = reason instanceof Error ? reason.message : "检查失败"
      }
      setOsuDailyMessage({ text, error: true })
    } finally {
      setOsuDailyBusy(false)
    }
  }

  if (!username) {
    return (
      <Pages
        left={
          <>
            <p className="account-text">
              用 osu! 或邮箱登录后，抽到的卡和保底进度都会绑定到你的账号。
            </p>
            <div className="login-actions">
              <a
                className="bk-btn bk-btn--main account-action"
                href="/auth/osu"
              >
                用 osu! 登录
              </a>
              <a className="bk-btn account-action" href="/login">
                用邮箱登录 / 注册
              </a>
              <GuestLoginButton className="bk-btn bk-btn--ghost account-action" />
            </div>
          </>
        }
        right={<div className="bk-empty">登录后，这里会显示你的本体卡。</div>}
      />
    )
  }

  if (pending) {
    return (
      <BindChoice
        pending={pending}
        onResolved={(kept) => {
          setPending(null)
          setBindMessage({
            text:
              kept === "keep-current"
                ? "已绑定 osu! 账号，原来的 osu! 账号已封存。去背包开神秘卡包，领取你的本体卡。"
                : "已切换到 osu! 账号，刚才的账号已封存。",
          })
          emitDeskData("user")
          emitDeskData("packs")
          emitDeskData("items")
        }}
        onClosed={(message) => {
          setPending(null)
          if (message) setBindMessage({ text: message, error: true })
        }}
      />
    )
  }

  return (
    <Pages
      left={
        <>
          <div className="account-id">
            <div className="account-id__avatar">
              {avatarUrl && !avatarError ? (
                <img
                  src={avatarUrl}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => setFailedAvatar(avatarUrl)}
                />
              ) : (
                username.slice(0, 1).toUpperCase()
              )}
            </div>
            <div className="account-id__text">
              <b>{username}</b>
              <span className="bk-num">
                {publicId != null
                  ? `CHOKE ID #${String(publicId).padStart(6, "0")}`
                  : userId}
              </span>
            </div>
          </div>

          <div className="account-stats">
            <div className="bk-box bk-stat">
              <b>{essence.toLocaleString("en-US")}</b>
              <span>闪卡精华</span>
            </div>
            <div className="bk-box bk-stat">
              <b>{coins.toLocaleString("en-US")}</b>
              <span>金币</span>
            </div>
          </div>

          <div className="bk-box account-quests">
            <div className="account-quests__head">
              <span className="bk-label">每日签到与奖励</span>
              {quests && (
                <span className="bk-num">
                  {quests.claimable > 0 ? `可领 ${quests.claimable} 项` : "暂无待领"}
                </span>
              )}
            </div>
            <div className="account-quests__actions">
              <button
                type="button"
                className="bk-btn bk-btn--sm bk-btn--main"
                disabled={!quests || quests.signIn.signedToday || questBusy !== null}
                onClick={() => void handleSignIn()}
              >
                {questBusy === "sign-in"
                  ? "签到中…"
                  : quests?.signIn.signedToday
                    ? "今日已签"
                    : "每日签到"}
              </button>
              <button
                type="button"
                className="bk-btn bk-btn--sm"
                disabled={!quests || quests.claimable === 0 || questBusy !== null}
                onClick={() => void handleClaimAll()}
              >
                {questBusy === "claim-all" ? "领取中…" : "一键领奖励"}
              </button>
            </div>
            {questMessage && (
              <span className={`account-quests__msg ${questMessage.error ? "bk-error" : ""}`}>
                {questMessage.text}
              </span>
            )}
            {quests && (
              <div className="account-chests">
                {(["daily", "weekly", "monthly"] as const).map((period) => {
                  const act = quests.activity[period]
                  if (!act || act.chests.length === 0) return null
                  return (
                    <div key={period} className="account-chests__row">
                      <div className="account-chests__meta">
                        <span>{PERIOD_LABEL[period]}</span>
                        <span className="bk-num">
                          {act.earned}/{act.cap}
                        </span>
                      </div>
                      <div className="account-chests__btns">
                        {act.chests.map((chest) => {
                          const busy = questBusy === `chest:${period}:${chest.at}`
                          const rewardTitle = chest.rewards
                            .map((r) => `${r.label} ×${r.count}`)
                            .join("、")
                          return (
                            <button
                              key={`${period}-${chest.at}`}
                              type="button"
                              title={rewardTitle}
                              className={`bk-btn bk-btn--sm ${chest.claimable ? "bk-btn--main" : ""}`}
                              disabled={!chest.claimable || questBusy !== null}
                              onClick={() => void handleClaimChest(period, chest.at)}
                            >
                              {busy
                                ? "领取中…"
                                : chest.claimed
                                  ? `${chest.at}点 已领`
                                  : chest.claimable
                                    ? `领 ${chest.at}点`
                                    : `${chest.at}点`}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {osuDaily && (
            <div className="bk-box account-quests">
              <div className="account-quests__head">
                <span className="bk-label">osu! 每日推荐谱面</span>
                <span className="bk-num">
                  {!osuDaily.beatmap ? "今日暂无" : osuDaily.passed ? "已通过" : "待挑战"}
                </span>
              </div>
              {osuDaily.beatmap ? (
                <>
                  <a
                    className="account-osu-daily__title"
                    href={osuDaily.beatmap.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {osuDaily.beatmap.title} ↗
                  </a>
                  <span className="account-hint">
                    {[
                      osuDaily.beatmap.minAccuracy !== undefined
                        ? `Acc ≥ ${osuDaily.beatmap.minAccuracy}%`
                        : null,
                      osuDaily.beatmap.minRank !== undefined
                        ? `评级 ≥ ${osuDaily.beatmap.minRank}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "任意 osu! standard Pass 成绩即可"}
                  </span>
                  <div className="account-quests__actions">
                    <button
                      type="button"
                      className="bk-btn bk-btn--sm bk-btn--main"
                      disabled={
                        osuDaily.passed ||
                        osuDailyBusy ||
                        osuDailyCooldown > 0 ||
                        (kind !== null && kind !== "osu")
                      }
                      onClick={() => void handleCheckOsuDaily()}
                    >
                      {osuDailyBusy
                        ? "检查中…"
                        : osuDaily.passed
                          ? "今日已通过"
                          : osuDailyCooldown > 0
                            ? `冷却 ${osuDailyCooldown}s`
                            : "检查成绩"}
                    </button>
                  </div>
                  {kind && kind !== "osu" && (
                    <span className="account-hint">绑定 osu! 账号后可检查成绩</span>
                  )}
                </>
              ) : (
                <span className="account-hint">今天还没有安排推荐谱面，明天再来看看。</span>
              )}
              {osuDailyMessage && (
                <span className={`account-quests__msg ${osuDailyMessage.error ? "bk-error" : ""}`}>
                  {osuDailyMessage.text}
                </span>
              )}
            </div>
          )}

          <div className="bk-list">
            <div className="bk-row account-row">
              <span>登录状态</span>
              <b>
                {kind ? KIND_TEXT[kind] : "…"}
                {kind === "osu" && me?.hasEmail ? " · 已绑定邮箱" : ""}
              </b>
            </div>
            <div className="bk-row account-row">
              <span>osu! 主页</span>
              {me?.osuId != null ? (
                <a
                  href={`https://osu.ppy.sh/users/${me.osuId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开 ›
                </a>
              ) : (
                <b>未绑定</b>
              )}
            </div>
          </div>

          {kind && (kind !== "osu" || !me?.hasEmail || bindMessage) && (
            <div className="bk-box account-bind">
              <span className="bk-label">账号绑定</span>
              {kind !== "osu" && (
                <>
                  <p className="account-hint">
                    绑定 osu! 账号后才能在市场买卖，还会补发一个神秘卡包领本体卡。进度会保留；如果那个 osu! 账号已经玩过，会让你二选一。
                  </p>
                  <a className="bk-btn bk-btn--main bk-btn--sm account-action" href="/auth/osu/bind">
                    绑定 osu! 账号
                  </a>
                </>
              )}
              {me && !me.hasEmail && (
                <form
                  className="account-bind__email"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void handleBindEmail()
                  }}
                >
                  <p className="account-hint">
                    绑定邮箱后，换设备也能用邮箱和密码登录这个账号。
                  </p>
                  <input
                    className="bk-input"
                    type="email"
                    autoComplete="email"
                    placeholder="邮箱"
                    value={emailForm.email}
                    onChange={(event) => setEmailForm((f) => ({ ...f, email: event.target.value }))}
                  />
                  <input
                    className="bk-input"
                    type="password"
                    autoComplete="new-password"
                    placeholder="密码（至少 8 位）"
                    value={emailForm.password}
                    onChange={(event) => setEmailForm((f) => ({ ...f, password: event.target.value }))}
                  />
                  <button
                    type="submit"
                    className="bk-btn bk-btn--sm account-action"
                    disabled={emailBusy || !emailForm.email.trim() || emailForm.password.length < 8}
                  >
                    {emailBusy ? "绑定中…" : "绑定邮箱"}
                  </button>
                </form>
              )}
              {bindMessage && (
                <span className={`account-quests__msg ${bindMessage.error ? "bk-error" : ""}`}>
                  {bindMessage.text}
                </span>
              )}
            </div>
          )}

          {confirmLogout ? (
            <div className="account-logout">
              <ConfirmBar
                danger
                confirmLabel="确认退出"
                message={
                  isGuest
                    ? "退出登录？游客账号没有绑定 osu! 或邮箱，退出后可能找回不了这里的卡册和进度。"
                    : "退出登录？卡册和进度都保存在账号里，下次登录就能回来。"
                }
                onCancel={() => setConfirmLogout(false)}
                onConfirm={() => {
                  playSfx("click")
                  setConfirmLogout(false)
                  onLogout?.()
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className="bk-btn bk-btn--danger account-action account-logout"
              onClick={() => setConfirmLogout(true)}
            >
              退出登录
            </button>
          )}
        </>
      }
      right={
        hero ? (
          <div className="account-hero">
            <span className="bk-label">我的本体卡</span>
            <div className="account-hero__face">
              <GameCardFace card={toFace(hero)} />
            </div>
            <b className="account-hero__name">{hero.name}</b>
            <span className="account-hero__meta">
              {RARITY_LABEL[hero.rarity]} · Lv.{hero.level}
            </span>
            <p className="bk-note">
              本体卡已绑定，抽到自己的镜像卡会单独记进卡册。
            </p>
          </div>
        ) : (
          <div className="account-hero">
            <span className="bk-label">我的本体卡</span>
            <div className="account-hero__face bk-slot">?</div>
            <b className="account-hero__name">
              {kind && kind !== "osu" ? "还没有本体卡" : "还没有获得"}
            </b>
            <p className="bk-note">
              {kind === "guest"
                ? "本体卡来自 osu! 账号数据。绑定 osu! 账号后会补发神秘卡包，开启就能得到你的本体卡，现在的进度会保留。"
                : kind === "email"
                  ? "本体卡来自 osu! 账号数据。绑定 osu! 账号后，背包里的神秘卡包就能领出你的本体卡，现在的进度会保留。"
                  : "本体卡在背包的「神秘卡包」里。开启后才会进入卡册和桌面。"}
            </p>
            {kind && kind !== "osu" ? (
              <a className="bk-btn bk-btn--main" href="/auth/osu/bind">
                绑定 osu! 账号
              </a>
            ) : (
              <button
                type="button"
                className="bk-btn bk-btn--main"
                onClick={onOpenBackpack}
              >
                去背包开神秘卡包
              </button>
            )}
          </div>
        )
      }
    />
  )
}
