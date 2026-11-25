import { useState } from "react"

import { playSfx } from "@/audio/sfx"
import { GameCardFace } from "@/card/GameCardFace"
import { RARITY_LABEL } from "@/card/data"

import { toFace, type ApiUserCard } from "@/desk/session/api"
import { Pages } from "@/desk/shell/PanelFrame"
import { ConfirmBar } from "@/desk/shell/ConfirmBar"
import { GuestLoginButton } from "@/desk/login/GuestLoginButton"
import "@/desk/panels/player/account-panel.css"

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
  const avatarError = failedAvatar === avatarUrl
  const isGuest = !!userId?.startsWith("guest-")

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

          <div className="bk-list">
            <div className="bk-row account-row">
              <span>登录状态</span>
              <b>{isGuest ? "游客账户（未绑定 osu!）" : "已连接 osu!"}</b>
            </div>
            <div className="bk-row account-row">
              <span>osu! 主页</span>
              {userId?.startsWith("osu-") ? (
                <a
                  href={`https://osu.ppy.sh/users/${userId.replace("osu-", "")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开 ›
                </a>
              ) : (
                <b>{isGuest ? "未绑定" : "演示账号"}</b>
              )}
            </div>
          </div>

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
              {isGuest ? "游客没有本体卡" : "还没有获得"}
            </b>
            <p className="bk-note">
              {isGuest
                ? "本体卡来自 osu! 账号数据。用 osu! 登录后会生成你的本体卡；游客期间的卡包和进度不会转移。"
                : "本体卡在背包的「神秘卡包」里。开启后才会进入卡册和桌面。"}
            </p>
            {isGuest ? (
              <a className="bk-btn bk-btn--main" href="/auth/osu">
                用 osu! 登录
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
