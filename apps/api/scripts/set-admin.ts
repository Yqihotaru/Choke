/**
 * 设置 / 撤销管理员。这是唯一能改 is_admin 的地方，网页和接口都改不了。
 *
 *   pnpm admin:set <用户 id | osu! 数字 id>          设为管理员
 *   pnpm admin:set <用户 id | osu! 数字 id> --off    撤销
 */
import { eq } from "drizzle-orm"

import { db, sql } from "../src/db/client"
import { users } from "../src/db/schema"

const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
const off = process.argv.includes("--off")
const target = args[0]
if (!target) {
  console.error("用法：pnpm admin:set <用户 id | osu! 数字 id> [--off]")
  process.exit(1)
}

const userId = /^\d+$/.test(target) ? `osu-${target}` : target
const [updated] = await db
  .update(users)
  .set({ isAdmin: !off })
  .where(eq(users.id, userId))
  .returning({ id: users.id, username: users.username, isAdmin: users.isAdmin })

if (!updated) {
  console.error(`找不到用户：${userId}`)
  await sql?.end()
  process.exit(1)
}
console.log(`${updated.username}（${updated.id}）现在${updated.isAdmin ? "是" : "不是"}管理员`)
await sql?.end()
process.exit(0)
