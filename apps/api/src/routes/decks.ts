import { and, eq, getTableColumns, inArray } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { requireSelf } from "../auth/guard"
import { DECK_SIZE } from "../config"
import { db } from "../db/client"
import { cards, decks, deckSlots, userCards } from "../db/schema"
import { EXPEDITION_LOCK_MESSAGE, anyLocked, listedUserCardIds } from "../expedition/locks"
import { TxAbort, lockUser, runTx } from "../tx"

type DeckCardRow = Record<string, unknown>

async function loadDeck(userId: string) {
  const [deck] = await db.select().from(decks).where(eq(decks.userId, userId)).limit(1)

  const rows = await db
    .select({
      slot: deckSlots.slot,
      ...getTableColumns(cards),
      userCardId: userCards.id,
      level: userCards.level,
      constellation: userCards.constellation,
      exp: userCards.exp,
      serial: userCards.serial,
      rollBp: userCards.rollBp,
      skillRefs: userCards.skillRefs,
      foil: userCards.foil,
      obtainedAt: userCards.obtainedAt,
    })
    .from(deckSlots)
    .innerJoin(
      userCards,
      and(eq(userCards.id, deckSlots.userCardId), eq(userCards.userId, userId)),
    )
    .innerJoin(cards, eq(cards.id, userCards.cardId))
    .where(eq(deckSlots.userId, userId))

  const slots = Array.from({ length: DECK_SIZE }, (_, i) => ({
    slot: i + 1,
    card: null as DeckCardRow | null,
  }))

  for (const row of rows) {
    const { slot, ...card } = row
    if (slot >= 1 && slot <= DECK_SIZE) {
      slots[slot - 1] = { slot, card }
    }
  }

  return {
    name: deck?.name ?? "主卡组",
    slots,
    updatedAt: deck?.updatedAt ?? null,
  }
}

export async function deckRoutes(app: FastifyInstance) {
  app.get("/users/:userId/deck", async (request, reply) => {
    const params = z.object({ userId: z.string() }).parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    return { ok: true, data: await loadDeck(userId) }
  })

  app.put("/users/:userId/deck", async (request, reply) => {
    const params = z.object({ userId: z.string() }).parse(request.params)
    const userId = requireSelf(request, reply, params.userId)
    if (!userId) return
    const body = z
      .object({
        slots: z.array(z.number().int().positive().nullable()).length(DECK_SIZE),
      })
      .parse(request.body)

    const ids = body.slots.filter((value): value is number => value !== null)
    if (new Set(ids).size !== ids.length) {
      return reply.code(400).send({
        ok: false,
        error: { code: "duplicate_card", message: "同一张卡不能放进两个槽位" },
      })
    }

    // 归属、上架、出征状态都在事务内重查：和上架 / 出征走同一把用户锁，避免两边同时通过
    const saved = await runTx(reply, async (tx) => {
      if (ids.length > 0) {
        await lockUser(tx, userId)
        const owned = await tx
          .select({ id: userCards.id })
          .from(userCards)
          .where(and(eq(userCards.userId, userId), inArray(userCards.id, ids)))

        if (owned.length !== ids.length) {
          throw new TxAbort(400, "card_not_owned", "有卡不在这个账号的卡册里")
        }
        if ((await listedUserCardIds(tx, ids)).size > 0) {
          throw new TxAbort(400, "card_listed", "有卡正在市场里挂着，先下架再放进卡组")
        }
        if (await anyLocked(tx, userId, ids)) {
          throw new TxAbort(400, "in_expedition", EXPEDITION_LOCK_MESSAGE)
        }
      }

      await tx
        .insert(decks)
        .values({ userId, name: "主卡组" })
        .onConflictDoUpdate({
          target: decks.userId,
          set: { updatedAt: new Date() },
        })

      await tx.delete(deckSlots).where(eq(deckSlots.userId, userId))

      const rows = body.slots.flatMap((id, index) =>
        id === null ? [] : [{ userId, slot: index + 1, userCardId: id }],
      )
      if (rows.length > 0) {
        await tx.insert(deckSlots).values(rows)
      }
      return true
    })
    if (!saved) return

    return { ok: true, data: await loadDeck(userId) }
  })
}
