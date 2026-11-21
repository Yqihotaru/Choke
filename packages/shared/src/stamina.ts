/**
 * 体力：每 6 分钟 1 点，上限 360。
 * 纯函数，前后端共用；数据库只存 value + updatedAt。
 */

export const STAMINA_MAX = 360
export const STAMINA_REGEN_MS = 6 * 60 * 1000

export interface StaminaSnapshot {
  value: number
  /** 上一次结算的时间戳（毫秒） */
  updatedAt: number
}

/** 把「上次结算点」推进到 now，返回当前体力和新的结算点。 */
export function settleStamina(
  snapshot: StaminaSnapshot,
  now: number = Date.now(),
): StaminaSnapshot {
  const value = Math.min(STAMINA_MAX, Math.max(0, Math.floor(snapshot.value)))
  if (value >= STAMINA_MAX) return { value, updatedAt: now }
  const elapsed = Math.max(0, now - snapshot.updatedAt)
  const gained = Math.floor(elapsed / STAMINA_REGEN_MS)
  if (gained <= 0) return { value, updatedAt: snapshot.updatedAt }
  const next = Math.min(STAMINA_MAX, value + gained)
  return {
    value: next,
    updatedAt: next >= STAMINA_MAX ? now : snapshot.updatedAt + gained * STAMINA_REGEN_MS,
  }
}

/** 距离下一点体力还有多少毫秒；满了返回 0。 */
export function staminaNextIn(
  snapshot: StaminaSnapshot,
  now: number = Date.now(),
): number {
  if (snapshot.value >= STAMINA_MAX) return 0
  const elapsed = Math.max(0, now - snapshot.updatedAt)
  return Math.max(0, STAMINA_REGEN_MS - (elapsed % STAMINA_REGEN_MS))
}

/** 扣体力：返回 null 表示不够。 */
export function spendStamina(
  snapshot: StaminaSnapshot,
  cost: number,
  now: number = Date.now(),
): StaminaSnapshot | null {
  const settled = settleStamina(snapshot, now)
  if (settled.value < cost) return null
  return { value: settled.value - cost, updatedAt: settled.updatedAt }
}
