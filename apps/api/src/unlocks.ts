import { eq } from "drizzle-orm"
import type { FastifyReply } from "fastify"

import {
  featureName,
  lockMessage,
  lockReason,
  unlockLevelOf,
  type FeatureId,
  type LockReason,
  type UnlockContext,
} from "@choke/shared/unlocks"

import { db } from "./db/client"
import { users } from "./db/schema"
import { TxAbort } from "./tx"

type Exec = Pick<typeof db, "select">

/** 解锁判断用的三个事实，全部以数据库为准：等级、是否完成引导、是否绑定了 osu! */
export async function loadUnlockContext(userId: string, exec: Exec = db): Promise<UnlockContext | null> {
  const [row] = await exec
    .select({ level: users.playerLevel, tutorialDone: users.tutorialDone, osuId: users.osuId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!row) return null
  return { level: row.level, tutorialDone: row.tutorialDone, linkedAccount: row.osuId != null }
}

/** 统一的拒绝：403 + feature_locked，附带功能、原因和所需等级，前端据此显示锁 */
export function featureLockedAbort(feature: FeatureId, reason: LockReason): TxAbort {
  return new TxAbort(403, "feature_locked", lockMessage(feature, reason), {
    feature,
    featureName: featureName(feature),
    reason: reason.kind,
    level: reason.kind === "level" ? reason.level : unlockLevelOf(feature),
  })
}

/** 业务函数里用：没解锁就抛 TxAbort（由 runTx / guardAbort 转成响应） */
export async function assertFeature(userId: string, feature: FeatureId, exec: Exec = db): Promise<void> {
  const ctx = await loadUnlockContext(userId, exec)
  if (!ctx) throw new TxAbort(404, "not_found", "用户不存在")
  const reason = lockReason(feature, ctx)
  if (reason) throw featureLockedAbort(feature, reason)
}

/** 路由里用：没解锁就直接回复 403 并返回 false */
export async function requireFeature(reply: FastifyReply, userId: string, feature: FeatureId): Promise<boolean> {
  try {
    await assertFeature(userId, feature)
    return true
  } catch (error) {
    if (!(error instanceof TxAbort)) throw error
    reply.code(error.status).send({
      ok: false,
      error: { code: error.code, message: error.message, ...error.extra },
    })
    return false
  }
}
