import { useCallback, useEffect, useState } from "react"

import { fetchMe, fetchPackInventory, logout as apiLogout } from "./api"
import { onDeskData } from "./events"
import type { DeskUser } from "./desk-page-model"

export interface DeskPackState {
  userId: string
  data: Record<string, number>
}

/**
 * 桌面会话：账号、钱包、卡包库存。
 * 只负责「谁登录了 / 他有多少卡包」，不碰桌面布局和拖拽。
 */
export function useDeskSession() {
  const [user, setUser] = useState<DeskUser | null>(null)
  /** /auth/me 回来过一次（登没登录都算），邀请函等它再决定要不要弹 */
  const [userReady, setUserReady] = useState(false)
  const [packState, setPackState] = useState<DeskPackState | null>(null)

  const refreshUser = useCallback(() => {
    fetchMe()
      .then((d) => {
        setUser({
          id: d.id,
          username: d.username,
          publicId: d.publicId ?? null,
          avatarUrl: d.avatarUrl ?? null,
          essence: Number(d.essence ?? 0),
          coins: Number(d.coins ?? 0),
          hero: d.hero ?? null,
          onboarded: !!d.onboarded,
        })
      })
      .catch(() => setUser(null))
      .finally(() => setUserReady(true))
  }, [])

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  const refreshPacks = useCallback(() => {
    if (!user) return
    fetchPackInventory(user.id)
      .then((d) => {
        setPackState({ userId: user.id, data: d.packs })
      })
      .catch(() => {})
  }, [user])

  useEffect(() => {
    refreshPacks()
  }, [refreshPacks])

  useEffect(() => {
    return onDeskData("packs", () => refreshPacks())
  }, [refreshPacks])

  const logout = useCallback(() => {
    apiLogout()
      .catch(() => {})
      .finally(() => setUser(null))
  }, [])

  return {
    user,
    setUser,
    userReady,
    packState,
    setPackState,
    refreshUser,
    refreshPacks,
    logout,
  }
}
