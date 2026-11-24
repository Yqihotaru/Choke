/**
 * 体力：0–360 每 6 分钟 1 点（240/天）；溢出槽 360–720 每 12 分钟 1 点。
 * 纯函数，前后端共用；数据库只存 value + updatedAt。
 */

export const STAMINA_MAX = 360
export const STAMINA_OVERFLOW_MAX = 720
export const STAMINA_REGEN_MS = 6 * 60 * 1000
export const STAMINA_OVERFLOW_REGEN_MS = 12 * 60 * 1000

export const STAMINA_POTION_COST = 100
export const STAMINA_POTION_GAIN = 60
export const STAMINA_POTION_DAILY_LIMIT = 2

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
  let value = Math.min(STAMINA_OVERFLOW_MAX, Math.max(0, Math.floor(snapshot.value)))
  if (value >= STAMINA_OVERFLOW_MAX) return { value, updatedAt: now }

  let updatedAt = snapshot.updatedAt
  let elapsed = Math.max(0, now - updatedAt)

  if (value < STAMINA_MAX) {
    const baseGain = Math.min(STAMINA_MAX - value, Math.floor(elapsed / STAMINA_REGEN_MS))
    if (baseGain > 0) {
      const used = baseGain * STAMINA_REGEN_MS
      value += baseGain
      updatedAt += used
      elapsed -= used
    }
  }

  if (value >= STAMINA_MAX && value < STAMINA_OVERFLOW_MAX) {
    const overflowGain = Math.min(
      STAMINA_OVERFLOW_MAX - value,
      Math.floor(elapsed / STAMINA_OVERFLOW_REGEN_MS),
    )
    if (overflowGain > 0) {
      value += overflowGain
      updatedAt += overflowGain * STAMINA_OVERFLOW_REGEN_MS
    }
  }

  return {
    value,
    updatedAt: value >= STAMINA_OVERFLOW_MAX ? now : updatedAt,
  }
}

/** 距离下一点体力还有多少毫秒；达到 720 总上限返回 0。 */
export function staminaNextIn(
  snapshot: StaminaSnapshot,
  now: number = Date.now(),
): number {
  const settled = settleStamina(snapshot, now)
  if (settled.value >= STAMINA_OVERFLOW_MAX) return 0
  const interval = settled.value < STAMINA_MAX ? STAMINA_REGEN_MS : STAMINA_OVERFLOW_REGEN_MS
  const elapsed = Math.max(0, now - settled.updatedAt)
  return Math.max(0, interval - (elapsed % interval))
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
