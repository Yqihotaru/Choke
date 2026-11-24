import { useEffect, useState } from "react"

import { fetchCardStats, fetchGameConfig, type CardStats, type GameConfig } from "@/desk/session/api"

let configCache: GameConfig | null = null
let statsCache: CardStats | null = null

/** 一次会话只拉一次规则配置；多个面板共用同一份。 */
export function useGameConfig(): GameConfig | null {
  const [config, setConfig] = useState<GameConfig | null>(configCache)

  useEffect(() => {
    if (configCache) return
    let cancelled = false
    fetchGameConfig()
      .then((data) => {
        configCache = data
        if (!cancelled) setConfig(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return config
}

/** 公共卡池统计（总张数、各品质张数），邀请函等处用来显示真实数字。 */
export function useCardStats(): CardStats | null {
  const [stats, setStats] = useState<CardStats | null>(statsCache)

  useEffect(() => {
    if (statsCache) return
    let cancelled = false
    fetchCardStats()
      .then((data) => {
        statsCache = data
        if (!cancelled) setStats(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return stats
}
