import { CONTENT, type FeatureId } from "./content"

/** 功能解锁：条件在 content/unlocks.json。服务端据此拒绝请求，前端据此显示锁 */
export type { FeatureId }

export const FEATURE_IDS = Object.keys(CONTENT.unlocks) as FeatureId[]

export interface UnlockContext {
  level: number
  tutorialDone: boolean
  /** 绑定了 osu!；游客和只有邮箱的账号是 false */
  linkedAccount: boolean
}

export type LockReason =
  | { kind: "tutorial" }
  | { kind: "level"; level: number }
  | { kind: "account" }

export function unlockLevelOf(id: FeatureId): number {
  return CONTENT.unlocks[id].level
}

export function featureName(id: FeatureId): string {
  return CONTENT.unlocks[id].name
}

/** 没解锁返回原因，解锁了返回 null。先看账号，再看引导，最后看等级（玩家最容易补上的放最后） */
export function lockReason(id: FeatureId, ctx: UnlockContext): LockReason | null {
  const rule = CONTENT.unlocks[id]
  if (rule.linkedAccount && !ctx.linkedAccount) return { kind: "account" }
  if (rule.tutorial && !ctx.tutorialDone) return { kind: "tutorial" }
  if (ctx.level < rule.level) return { kind: "level", level: rule.level }
  return null
}

export function isUnlocked(id: FeatureId, ctx: UnlockContext): boolean {
  return lockReason(id, ctx) === null
}

/** 给玩家看的一句话 */
export function lockMessage(id: FeatureId, reason: LockReason): string {
  const name = featureName(id)
  switch (reason.kind) {
    case "account":
      return `${name}要绑定 osu! 账号才能使用，游客只能看`
    case "tutorial":
      return `完成新手引导后解锁${name}`
    case "level":
      return `${name}需要 Lv.${reason.level} 解锁`
  }
}
