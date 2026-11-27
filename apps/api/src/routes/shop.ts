import { and, eq, gte, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { CONTENT, type ItemId, type ItemStack, type ShopItemId } from "@choke/shared/content"
import { nextReset, periodKey } from "@choke/shared/reset"

import { requireSelf } from "../auth/guard"
import { db } from "../db/client"
import { shopPurchases, users } from "../db/schema"
import { grantItems, loadItems, mergeStacks, spendItems } from "../items"
import { recordLedger, type LedgerEntryInput } from "../ledger"
import { TxAbort, lockUser, runTx, type Tx } from "../tx"

const paramsSchema = z.object({ userId: z.string() })
const buyBodySchema = z.object({
  itemId: z.string().min(1),
  count: z.number().int().min(1).max(10).default(1),
})

async function getShopUsed(
  executor: Tx | typeof db,
  userId: string,
  itemId: ShopItemId,
  pKey: string,
): Promise<number> {
  const [row] = await executor
    .select({ count: shopPurchases.count })
    .from(shopPurchases)
    .where(
      and(
        eq(shopPurchases.userId, userId),
        eq(shopPurchases.itemId, itemId),
        eq(shopPurchases.periodKey, pKey),
      ),
    )
    .limit(1)
  return row?.count ?? 0
}

function pickGambleEntry<T extends { weight: number }>(pool: readonly T[]): T {
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0)
  let roll = Math.random() * total
  for (const entry of pool) {
    if (roll < entry.weight) return entry
    roll -= entry.weight
  }
  return pool[pool.length - 1]!
}

export async function shopRoutes(app: FastifyInstance) {
  /** 统一商店列表：返回分区商品、当前周期已购/剩余限购与下次重置时间 */
  app.get("/users/:userId/shop", async (request, reply) => {
    const { userId: paramUserId } = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, paramUserId)
    if (!userId) return

    const now = Date.now()
    const entries = await Promise.all(
      (Object.keys(CONTENT.shop) as ShopItemId[]).map(async (id) => {
        const def = CONTENT.shop[id]
        const pKey = periodKey(def.period, now)
        const used = await getShopUsed(db, userId, id, pKey)
        return {
          id,
          name: def.name,
          summary: def.summary,
          section: def.section,
          period: def.period,
          limit: def.limit,
          used,
          remaining: Math.max(0, def.limit - used),
          nextResetAt: nextReset(def.period, now),
          cost: def.cost,
          reward: def.reward,
        }
      }),
    )

    return { ok: true, data: { items: entries } }
  })

  /** 统一商店购买：限购校验 + 扣金币/碎片 + 发放固定或博弈绑定产出 */
  app.post("/users/:userId/shop/buy", async (request, reply) => {
    const { userId: paramUserId } = paramsSchema.parse(request.params)
    const userId = requireSelf(request, reply, paramUserId)
    if (!userId) return

    const body = buyBodySchema.parse(request.body)
    if (!Object.hasOwn(CONTENT.shop, body.itemId)) {
      return reply.code(400).send({
        ok: false,
        error: { code: "unknown_shop_item", message: `未知商店商品：${body.itemId}` },
      })
    }

    const itemId = body.itemId as ShopItemId
    const def = CONTENT.shop[itemId]
    const qty = body.count
    const now = Date.now()
    const pKey = periodKey(def.period, now)

    const result = await runTx(reply, async (tx) => {
      await lockUser(tx, userId)

      const used = await getShopUsed(tx, userId, itemId, pKey)
      if (used + qty > def.limit) {
        throw new TxAbort(
          400,
          "shop_limit_reached",
          `${def.name}本周期限购剩余不足（剩余 ${Math.max(0, def.limit - used)} / ${def.limit}）`,
          { used, limit: def.limit, remaining: Math.max(0, def.limit - used) },
        )
      }

      const [userRow] = await tx.select({ coins: users.coins }).from(users).where(eq(users.id, userId)).limit(1)
      if (!userRow) throw new TxAbort(404, "not_found", "用户不存在")

      const coinCost = (def.cost.coins ?? 0) * qty
      let coins = userRow.coins
      if (coinCost > 0) {
        const [wallet] = await tx
          .update(users)
          .set({ coins: sql`${users.coins} - ${coinCost}` })
          .where(and(eq(users.id, userId), gte(users.coins, coinCost)))
          .returning({ coins: users.coins })
        if (!wallet) {
          throw new TxAbort(400, "not_enough_coins", `金币不足：${userRow.coins} / ${coinCost}`, {
            need: coinCost,
            coins: userRow.coins,
          })
        }
        coins = wallet.coins
      }

      const costItems: ItemStack[] = (def.cost.items ?? []).map((s) => ({
        itemId: s.itemId as ItemId,
        count: s.count * qty,
      }))
      if (costItems.length > 0) {
        await spendItems(tx, userId, costItems)
      }

      const grantedItemsRaw: ItemStack[] = []

      if (def.reward.kind === "fixed") {
        for (const stack of def.reward.items) {
          grantedItemsRaw.push({ itemId: stack.itemId as ItemId, count: stack.count * qty })
        }
      } else {
        for (let i = 0; i < qty; i += 1) {
          const picked = pickGambleEntry(def.reward.pool)
          for (const s of picked.items) {
            grantedItemsRaw.push({ itemId: s.itemId as ItemId, count: s.count })
          }
        }
      }

      const grantedItems = mergeStacks(grantedItemsRaw)
      if (grantedItems.length > 0) {
        await grantItems(tx, userId, grantedItems)
      }

      await tx
        .insert(shopPurchases)
        .values({ userId, itemId, periodKey: pKey, count: qty })
        .onConflictDoUpdate({
          target: [shopPurchases.userId, shopPurchases.itemId, shopPurchases.periodKey],
          set: { count: sql`${shopPurchases.count} + ${qty}`, updatedAt: new Date() },
        })

      const ledger: LedgerEntryInput[] = []
      if (coinCost > 0) ledger.push({ kind: "coins", delta: -coinCost })
      for (const s of costItems) ledger.push({ kind: "item", ref: s.itemId, delta: -s.count })
      for (const s of grantedItems) ledger.push({ kind: "item", ref: s.itemId, delta: s.count })
      await recordLedger(tx, userId, ledger, { source: "shop", sourceRef: `${itemId}:${pKey}` })

      return {
        itemId,
        count: qty,
        used: used + qty,
        remaining: Math.max(0, def.limit - (used + qty)),
        coins,
        items: await loadItems(userId, tx),
        granted: { items: grantedItems },
      }
    })
    if (!result) return

    return { ok: true, data: result }
  })
}
