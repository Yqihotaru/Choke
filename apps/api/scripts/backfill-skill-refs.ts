/**
 * 把已有 cards 行里的 skills（按名字）翻译成 skill_refs（按 id）。
 *
 *   pnpm --filter @choke/api exec tsx scripts/backfill-skill-refs.ts
 *
 * 幂等：已经有 skill_refs 的行会跳过；加 --force 则全部重算。
 * 注意 PGlite 单进程：运行前先停掉 API。
 */
import { refsFromCardSkills } from "@choke/shared/skills"
import type { CardSkill, Job } from "@choke/shared/types"
import { sql } from "drizzle-orm"

import { db } from "../src/db/client"
import { cards } from "../src/db/schema"

const force = process.argv.includes("--force")

const rows = await db
  .select({
    job: cards.job,
    skills: cards.skills,
    skillRefs: cards.skillRefs,
  })
  .from(cards)

/** 按「职业 + skills 原文」分组，同组一次 UPDATE，避免 20 万条逐行写。 */
const groups = new Map<string, { job: Job; skills: CardSkill[]; refs: unknown[]; total: number }>()

for (const row of rows) {
  const skills = (row.skills as CardSkill[]) ?? []
  const key = `${row.job}::${JSON.stringify(skills)}`
  const existing = groups.get(key)
  if (existing) {
    existing.total += 1
    continue
  }
  const existingRefs = (row.skillRefs as unknown[] | null) ?? []
  groups.set(key, {
    job: row.job as Job,
    skills,
    refs: existingRefs.length > 0 && !force ? existingRefs : refsFromCardSkills(skills, row.job as Job),
    total: 1,
  })
}

let updated = 0
let unresolved = 0

for (const group of groups.values()) {
  if (group.refs.length === 0 && group.skills.length > 0) unresolved += group.total
  await db
    .update(cards)
    .set({ skillRefs: group.refs })
    .where(
      sql`${cards.job} = ${group.job} AND ${cards.skills} = ${JSON.stringify(group.skills)}::jsonb`,
    )
  updated += group.total
}

const [{ count }] = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(cards)
  .where(sql`jsonb_array_length(${cards.skillRefs}) > 0`)

console.log(
  `skill_refs 回填完成：覆盖 ${updated} 张（${groups.size} 组），未能解析 ${unresolved}，已有 refs ${count} 张（共 ${rows.length}）`,
)
process.exit(0)
