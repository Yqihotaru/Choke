import { battlePower } from "@/card/data"
import type { Recommend } from "@choke/shared/battle/content"
import { recommendLineup, type Lineup, type LineupCard } from "@choke/shared/lineup"

import { toFace, type ApiUserCard } from "@/desk/session/api"

export function toLineupCard(row: ApiUserCard): LineupCard {
  const face = toFace(row)
  return {
    key: row.userCardId,
    job: row.job,
    rarity: row.rarity,
    isHero: face.isHero,
    power: battlePower(face),
    skillIds: face.skills.map((skill) => skill.id),
  }
}

/** 按推荐从一堆卡里挑出阵容；rows 按站位排好 */
export function pickLineup(
  rows: readonly ApiUserCard[],
  recommend: Recommend,
  size?: number,
): { rows: ApiUserCard[]; lineup: Lineup } {
  const lineup = recommendLineup(rows.map(toLineupCard), recommend, { size })
  const byKey = new Map(rows.map((row) => [row.userCardId, row]))
  return { rows: lineup.picks.map((pick) => byKey.get(pick.key)!), lineup }
}
