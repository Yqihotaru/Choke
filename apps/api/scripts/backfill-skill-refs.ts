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
import { eq } from "drizzle-orm"

import { db } from "../src/db/client"
import { cards } from "../src/db/schema"

const force = process.argv.includes("--force")

const rows = await db
  .select({
    id: cards.id,
    job: cards.job,
    skills: cards.skills,
    skillRefs: cards.skillRefs,
  })
  .from(cards)

let updated = 0
let skipped = 0
let unresolved = 0

for (const row of rows) {
  const existing = (row.skillRefs as unknown[] | null) ?? []
  if (!force && existing.length > 0) {
    skipped += 1
    continue
  }
  const skills = (row.skills as CardSkill[]) ?? []
  const refs = refsFromCardSkills(skills, row.job as Job)
  if (refs.length === 0 && skills.length > 0) unresolved += 1
  await db.update(cards).set({ skillRefs: refs }).where(eq(cards.id, row.id))
  updated += 1
}

console.log(
  `skill_refs 回填完成：更新 ${updated}，跳过 ${skipped}，未能解析 ${unresolved}（共 ${rows.length}）`,
)
process.exit(0)
