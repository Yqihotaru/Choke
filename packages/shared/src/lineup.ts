import type { Recommend } from "./battle/content"
import { cardAllowed, FREE_ALLOCATION, type ExpeditionAllocation } from "./expedition-points"
import { skillById } from "./skills"
import { ELEMENT_LABEL, RARITIES, type Element, type Job, type Rarity } from "./types"

/**
 * 推荐上阵：给一堆卡和一份"推荐技能 / 属性"，挑出最该带的几张。
 * 教程的一键上阵、选关处的"按推荐上阵"都用它；纯函数，同样的输入永远得到同样的结果。
 */

/** 站位从前到后 */
export const LINEUP_ORDER: readonly Job[] = ["tank", "warrior", "mage", "support"]

export const LINEUP_JOB_LABEL: Record<Job, string> = {
  tank: "坦克",
  warrior: "战士",
  mage: "法师",
  support: "辅助",
}

/** 推荐技能比推荐属性更值钱 */
const SKILL_SCORE = 10
const ELEMENT_SCORE = 3

export interface LineupCard {
  /** 调用方自己的卡标识（通常是 userCardId），结果里原样带回 */
  key: number
  job: Job
  rarity: Rarity
  isHero?: boolean
  /** 战力，越高越优先 */
  power: number
  skillIds: readonly string[]
}

export type LineupMatch = { kind: "skill" | "element"; skillId: string; skillName: string; element: Element }

export interface LineupPick {
  key: number
  job: Job
  /** job = 本职业里最合适的一张；fill = 职业不够，按分数补位 */
  role: "job" | "fill"
  score: number
  matches: LineupMatch[]
}

export interface Lineup {
  /** 已按站位排好：坦克、战士、法师、辅助 */
  picks: LineupPick[]
  /** 这份推荐里有技能或属性吗 */
  wanted: boolean
  /** 挑出来的卡里有没有对上推荐的 */
  hit: boolean
}

interface Scored {
  card: LineupCard
  score: number
  matches: LineupMatch[]
}

function scoreCard(card: LineupCard, recommend: Recommend): Scored {
  const matches: LineupMatch[] = []
  for (const skillId of new Set(card.skillIds)) {
    const def = skillById(skillId)
    if (!def) continue
    if (recommend.skills.includes(skillId)) {
      matches.push({ kind: "skill", skillId, skillName: def.name, element: def.element })
    } else if ((def.power ?? 0) > 0 && recommend.elements.includes(def.element)) {
      matches.push({ kind: "element", skillId, skillName: def.name, element: def.element })
    }
  }
  const score = matches.reduce((sum, m) => sum + (m.kind === "skill" ? SKILL_SCORE : ELEMENT_SCORE), 0)
  return { card, score, matches }
}

/** 分数高的在前；分数一样看战力，再看稀有度，最后按 key，保证结果固定 */
function compare(a: Scored, b: Scored): number {
  return (
    b.score - a.score ||
    b.card.power - a.card.power ||
    RARITIES.indexOf(b.card.rarity) - RARITIES.indexOf(a.card.rarity) ||
    a.card.key - b.card.key
  )
}

/**
 * 规则：
 * 1. 只考虑这份分配带得了的卡（默认免费档：E 及以下加本体卡）。
 * 2. 每个职业先选一张最合适的（对口分最高，其次战力）；职业之间也按这个顺序排，名额不够时先满足前面的。
 * 3. 名额还有剩，就从剩下的卡里按同样的顺序补。
 * 4. 最后按站位排好。
 */
export function recommendLineup(
  cards: readonly LineupCard[],
  recommend: Recommend,
  options: { size?: number; allocation?: ExpeditionAllocation } = {},
): Lineup {
  const allocation = options.allocation ?? FREE_ALLOCATION
  const size = Math.max(0, options.size ?? allocation.slots)
  const ranked = cards
    .filter((card) => cardAllowed(allocation, card))
    .map((card) => scoreCard(card, recommend))
    .sort(compare)

  const chosen: { scored: Scored; role: LineupPick["role"] }[] = []
  const taken = new Set<number>()
  const bestPerJob = LINEUP_ORDER.flatMap((job) => ranked.find((s) => s.card.job === job) ?? []).sort(compare)
  for (const scored of bestPerJob) {
    if (chosen.length >= size) break
    chosen.push({ scored, role: "job" })
    taken.add(scored.card.key)
  }
  for (const scored of ranked) {
    if (chosen.length >= size) break
    if (taken.has(scored.card.key)) continue
    chosen.push({ scored, role: "fill" })
    taken.add(scored.card.key)
  }

  chosen.sort((a, b) => LINEUP_ORDER.indexOf(a.scored.card.job) - LINEUP_ORDER.indexOf(b.scored.card.job) || compare(a.scored, b.scored))
  const picks = chosen.map(({ scored, role }) => ({
    key: scored.card.key,
    job: scored.card.job,
    role,
    score: scored.score,
    matches: scored.matches,
  }))
  return {
    picks,
    wanted: recommend.skills.length + recommend.elements.length > 0,
    hit: picks.some((pick) => pick.matches.length > 0),
  }
}

/** 一句话说明这张卡为什么上场（给教程和选关提示用） */
export function pickReason(pick: LineupPick): string {
  const job = LINEUP_JOB_LABEL[pick.job]
  if (pick.matches.length > 0) {
    const parts = pick.matches.map((m) =>
      m.kind === "skill" ? `带推荐技能【${m.skillName}】` : `【${m.skillName}】是${ELEMENT_LABEL[m.element]}属性攻击`,
    )
    return `${job}：${parts.join("，")}`
  }
  return pick.role === "job" ? `${job}：这个职业里战力最强` : `${job}：补位，战力靠前`
}

/** 推荐的一句话：给选关处和教程提示用，比如"推荐火属性攻击" */
export function recommendText(recommend: Recommend): string {
  const parts: string[] = []
  if (recommend.elements.length > 0) parts.push(`${recommend.elements.map((el) => ELEMENT_LABEL[el]).join("、")}属性攻击`)
  const names = recommend.skills.flatMap((id) => skillById(id)?.name ?? [])
  if (names.length > 0) parts.push(`技能${names.map((n) => `【${n}】`).join("")}`)
  return parts.length > 0 ? `推荐：${parts.join("，")}` : "没有特别的推荐"
}
