import { and, eq, gte, sql } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { CONTENT, type ItemId, type ItemStack, type PackId, type ShopItemId } from "@choke/shared/content"
import { nextReset, periodKey } from "@choke/shared/reset"
import { STAMINA_OVERFLOW_MAX, settleStamina } from "@choke/shared/stamina"

import { requireSelf } from "../auth/guard"
import { db } from "../db/client"
import { ledgerEntries, shopPurchases, userPacks, users } from "../db/schema"
import { grantItems, loadItems, mergeStacks, spendItems } from "../items"
import { recordLedger, type LedgerEntryInput } from "../ledger"
import { TxAbort, lockUser, runTx, type Tx } from "../tx"

const paramsSchema = z.object({ userId: z.string() })
const buyBodySchema = z.object({
  itemId: z.string().min(1),
  count: z.number().int().min(1).max(10).default(1),
})

/** 与 routes/dungeons.ts 的体力药共用每日限购计数 */
async function countStaminaPotionsToday(executor: Tx | typeof db, userId: string, dayKey: string): Promise<number> {
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.userId, userId),
        eq(ledgerEntries.kind, "coins"),
        eq(ledgerEntries.source, "stamina-potion"),
        eq(ledgerEntries.sourceRef, dayKey),
      ),
    )
  return row?.count ?? 0
}

async function getShopUsed(
  executor: Tx | typeof db,
  userId: string,
  itemId: ShopItemId,
  pKey: string,
): Promise<number> {
  if (itemId === "stamina-potion") {
    return countStaminaPotionsToday(executor, userId, pKey)
  }
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

      const [userRow] = await tx
        .select({
          coins: users.coins,
          stamina: users.stamina,
          staminaUpdatedAt: users.staminaUpdatedAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
      if (!userRow) throw new TxAbort(404, "not_found", "用户不存在")

      const staminaPerUnit = def.reward.kind === "fixed" ? (def.reward.stamina ?? 0) : 0
      let settledStamina: ReturnType<typeof settleStamina> | null = null
      if (staminaPerUnit > 0) {
        settledStamina = settleStamina({ value: userRow.stamina, updatedAt: userRow.staminaUpdatedAt }, now)
        if (settledStamina.value >= STAMINA_OVERFLOW_MAX) {
          throw new TxAbort(400, "stamina_full", `体力已达上限（${STAMINA_OVERFLOW_MAX}），无需购买`)
        }
        if (settledStamina.value + (qty - 1) * staminaPerUnit >= STAMINA_OVERFLOW_MAX) {
          const maxBottles = Math.ceil((STAMINA_OVERFLOW_MAX - settledStamina.value) / staminaPerUnit)
          throw new TxAbort(
            400,
            "stamina_full",
            `当前只需 ${maxBottles} 瓶即可回满体力上限（${STAMINA_OVERFLOW_MAX}），请减少购买数量`,
          )
        }
      }

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

      let staminaGained = 0
      const grantedItemsRaw: ItemStack[] = []
      const grantedPacks: { pool: PackId; count: number }[] = []

      if (def.reward.kind === "fixed") {
        if (staminaPerUnit > 0 && settledStamina) {
          const nextValue = Math.min(STAMINA_OVERFLOW_MAX, settledStamina.value + staminaPerUnit * qty)
          const nextUpdatedAt = nextValue >= STAMINA_OVERFLOW_MAX ? now : settledStamina.updatedAt
          staminaGained = nextValue - settledStamina.value
          await tx
            .update(users)
            .set({ stamina: nextValue, staminaUpdatedAt: nextUpdatedAt })
            .where(eq(users.id, userId))
        }
        if (def.reward.items?.length) {
          for (const s of def.reward.items) {
            grantedItemsRaw.push({ itemId: s.itemId as ItemId, count: s.count * qty })
          }
        }
        if (def.reward.packs?.length) {
          for (const p of def.reward.packs) {
            const add = p.count * qty
            const pool = p.pool as PackId
            grantedPacks.push({ pool, count: add })
            await tx
              .insert(userPacks)
              .values({ userId, pool, count: add })
              .onConflictDoUpdate({
                target: [userPacks.userId, userPacks.pool],
                set: { count: sql`${userPacks.count} + ${add}` },
              })
          }
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

      if (itemId === "stamina-potion") {
        // 与旧 /stamina/potion 保持同一限购口径：每次写一条 coins 流水
        const unitCoin = def.cost.coins ?? 0
        let leftStamina = staminaGained
        for (let i = 0; i < qty; i += 1) {
          const unitGain = i === qty - 1 ? leftStamina : Math.min(leftStamina, staminaPerUnit)
          leftStamina -= unitGain
          await recordLedger(
            tx,
            userId,
            [
              { kind: "coins", delta: -unitCoin },
              { kind: "stamina", delta: unitGain },
            ],
            { source: "stamina-potion", sourceRef: pKey },
          )
        }
      } else {
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
        if (staminaGained > 0) ledger.push({ kind: "stamina", delta: staminaGained })
        for (const s of grantedItems) ledger.push({ kind: "item", ref: s.itemId, delta: s.count })
        for (const p of grantedPacks) ledger.push({ kind: "pack", ref: p.pool, delta: p.count })
        await recordLedger(tx, userId, ledger, { source: "shop", sourceRef: `${itemId}:${pKey}` })
      }

      return {
        itemId,
        count: qty,
        used: used + qty,
        remaining: Math.max(0, def.limit - (used + qty)),
        coins,
        items: await loadItems(userId, tx),
        granted: {
          stamina: staminaGained,
          items: grantedItems,
          packs: grantedPacks,
        },
      }
    })
    if (!result) return

    return { ok: true, data: result }
  })
}
