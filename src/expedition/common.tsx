import { useState, type ReactNode } from "react"

import { ITEMS, type ItemId } from "@choke/shared/items"
import type { Reward } from "@choke/shared/expedition/content"

import { ApiError } from "@/desk/session/api"

const THEME_KEY = "choke:expedition-theme"

export type ExTheme = "light" | "dark"

/** 浅色 / 深色：记在本机，第一次按系统设置 */
export function useExpeditionTheme(): [ExTheme, () => void] {
  const [theme, setTheme] = useState<ExTheme>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY)
      if (saved === "light" || saved === "dark") return saved
    } catch {
      /* 读不到就按系统 */
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  })
  const toggle = () =>
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark"
      try {
        localStorage.setItem(THEME_KEY, next)
      } catch {
        /* 存不了就只在本次生效 */
      }
      return next
    })
  return [theme, toggle]
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message
  return "出了点问题，请稍后再试"
}

/** 离某个时刻还有多久，大白话：2 天 3 小时 / 5 小时 20 分 / 12 分钟 */
export function remainingText(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return "已结束"
  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes % 60} 分`
  return `${Math.max(1, minutes)} 分钟`
}

export const HOUR_MS = 3_600_000
export const endsWithinHour = (iso: string, now = Date.now()) => {
  const ms = new Date(iso).getTime() - now
  return ms > 0 && ms < HOUR_MS
}

/** 一份奖励摊成一排小标签 */
export function RewardChips({ reward }: { reward: Reward }) {
  const chips: ReactNode[] = []
  if (reward.playerExp) chips.push(<span key="exp">玩家经验 +{reward.playerExp}</span>)
  if (reward.coins) chips.push(<span key="coins">金币 +{reward.coins}</span>)
  if (reward.essence) chips.push(<span key="essence">精华 +{reward.essence}</span>)
  if (reward.stamina) chips.push(<span key="stamina">体力 +{reward.stamina}</span>)
  reward.items?.forEach((item) =>
    chips.push(
      <span key={`item-${item.itemId}`}>
        {ITEMS[item.itemId as ItemId]?.name ?? item.itemId} ×{item.count}
      </span>,
    ),
  )
  reward.packs?.forEach((pack) => chips.push(<span key={`pack-${pack.pool}`}>{pack.pool} 卡包 ×{pack.count}</span>))
  reward.cards?.forEach((card, i) => chips.push(<span key={`card-${i}`}>卡牌 {card.cardId} ×{card.count}</span>))
  if (chips.length === 0) return <span className="ex-chip">没有奖励</span>
  return (
    <ul className="ex-rewards">
      {chips.map((chip, i) => (
        <li className="ex-chip" key={i}>
          {chip}
        </li>
      ))}
    </ul>
  )
}
