/**
 * 开发用：创建固定测试账号 test-battle，发一批覆盖各职业/稀有度的卡，并组好 7 人卡组。
 * 可重复运行：会先清掉该账号旧的卡实例和卡组。
 *
 *   pnpm --filter @choke/api exec tsx scripts/seed-test-account.ts
 *
 * 输出一条 session cookie 值；浏览器里 document.cookie = "choke_session=<值>; path=/" 即可登录。
 * 会写入开发库：运行前建议先停掉 API。
 */
import { and, eq, sql } from "drizzle-orm"

import { makeSession } from "../src/auth/osu"
import { CARD_TYPES } from "../src/card-types"
import { db } from "../src/db/client"
import { cards, deckSlots, decks, userCards, users } from "../src/db/schema"
import { grantCard } from "../src/gacha/open"

const USER_ID = "test-battle"
const RARITIES = ["C", "UC", "R", "E", "L", "Mythic", "Prismatic"]
const PER_RARITY = 8

await db
  .insert(users)
  .values({
    id: USER_ID,
    username: "测试账号",
    onboarded: true,
    tutorialDone: true,
    playerLevel: 30,
    coins: 99999,
    essence: 99999,
  })
  .onConflictDoNothing()

await db.delete(deckSlots).where(eq(deckSlots.userId, USER_ID))
await db.delete(decks).where(eq(decks.userId, USER_ID))
await db.delete(userCards).where(eq(userCards.userId, USER_ID))

const granted: { id: number; job: string; rarity: string }[] = []
for (const rarity of RARITIES) {
  const rows = await db
    .select({ id: cards.id, job: cards.job })
    .from(cards)
    .where(and(eq(cards.rarity, rarity), eq(cards.cardType, CARD_TYPES.pool)))
    .orderBy(sql`random()`)
    .limit(PER_RARITY)
  for (const row of rows) {
    const g = await db.transaction((tx) => grantCard(tx, { userId: USER_ID, cardId: row.id }))
    granted.push({ id: g.userCardId, job: row.job, rarity })
  }
}

// 卡组：优先高稀有度，并尽量覆盖不同职业
const rank = (r: string) => RARITIES.indexOf(r)
const sorted = [...granted].sort((a, b) => rank(b.rarity) - rank(a.rarity))
const picked: typeof granted = []
const jobs = new Set<string>()
for (const g of sorted) {
  if (picked.length >= 7) break
  if (!jobs.has(g.job)) {
    jobs.add(g.job)
    picked.push(g)
  }
}
for (const g of sorted) {
  if (picked.length >= 7) break
  if (!picked.includes(g)) picked.push(g)
}

await db.insert(decks).values({ userId: USER_ID, name: "主卡组" })
await db
  .insert(deckSlots)
  .values(picked.map((g, i) => ({ userId: USER_ID, slot: i + 1, userCardId: g.id })))

console.log(`已发卡 ${granted.length} 张，卡组 ${picked.length} 人`)
console.log(`SESSION=${makeSession(USER_ID)}`)
process.exit(0)
