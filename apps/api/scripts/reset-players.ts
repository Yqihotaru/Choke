/**
 * 清空所有玩家数据，保留卡牌定义（cards）。
 *
 *   pnpm --filter @choke/api exec tsx scripts/reset-players.ts --yes
 *
 * 会删除：users / user_cards / decks / deck_slots / user_packs /
 *         pack_tokens / pack_openings / pity / market_listings
 * 会重置：users.public_id 序列（新玩家从 1 开始）
 * 不会动：cards（含 pulled 累计发行数、skill_refs）
 *
 * 注意 PGlite 单进程：运行前先停掉 API。
 */
import { client } from "../src/db/client"

if (!process.argv.includes("--yes")) {
  console.error("这会删除所有玩家数据。确认后加 --yes 再运行。")
  process.exit(1)
}

const tables = [
  "market_listings",
  "pack_tokens",
  "pack_openings",
  "pity",
  "user_packs",
  "deck_slots",
  "decks",
  "user_cards",
  "users",
]

async function countOf(table: string): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table}`,
  )
  return Number(result.rows[0]?.count ?? 0)
}

for (const table of tables) {
  const before = await countOf(table)
  await client.exec(`DELETE FROM ${table}`)
  console.log(`  ${table.padEnd(16)} ${before} → ${await countOf(table)}`)
}

await client.exec("ALTER SEQUENCE IF EXISTS users_public_id_seq RESTART WITH 1")

console.log(`玩家数据已清空；cards 保留 ${await countOf("cards")} 张。`)
process.exit(0)
