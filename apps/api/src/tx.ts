import { eq } from "drizzle-orm"
import type { FastifyReply } from "fastify"

import { db } from "./db/client"
import { users } from "./db/schema"

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** 在事务内抛出即整体回滚；runTx 会把它转成统一的 {ok:false,error} 响应 */
export class TxAbort extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

/** 执行事务；被 TxAbort 回滚时已经回复客户端，返回 null */
export async function runTx<T>(
  reply: FastifyReply,
  fn: (tx: Tx) => Promise<T>,
): Promise<T | null> {
  try {
    return await db.transaction(fn)
  } catch (error) {
    if (!(error instanceof TxAbort)) throw error
    reply.code(error.status).send({
      ok: false,
      error: { code: error.code, message: error.message, ...error.extra },
    })
    return null
  }
}

/** 锁住该用户的行，让同一用户的「先查后写」事务串行执行 */
export async function lockUser(tx: Tx, userId: string) {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update")
}
