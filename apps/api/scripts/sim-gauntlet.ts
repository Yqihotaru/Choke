// 多场连战不回血模拟（只读，不碰数据库）：各流派探针队（L60 3命座）按远征路线连续作战，
// 血量（hpRatio）跨场继承、中途不进篝火，统计全通率与每场战后剩余血量。
// 用法：pnpm --filter @choke/api exec tsx scripts/sim-gauntlet.ts [种子数]
import { resolveEncounter } from "@choke/shared/battle/content"

import { BATTLE_CONTENT } from "../src/content"
import { BENCH, playBot, testApMax } from "./lib/battle-bot"
import { buildTeam, PROBE_LABEL, PROBES, type TeamSpec } from "./lib/archetypes"

const SEEDS = Number(process.argv[2] ?? 20)

const TEAMS: Record<string, TeamSpec> = {
  ...PROBES,
  break: { front: "bash", damage: "break", support: "buff" },
}

const GAUNTLETS: { name: string; stages: string[] }[] = [
  { name: "3连普通 (ghost→frost→rock)", stages: ["ghost", "frost-dancer", "rock-drummer"] },
  { name: "3连常规 (chime→brawler→dusk)", stages: ["wind-chime", "bare-brawler", "dusk-warden"] },
  { name: "3连精英 (ember→halo→dusk)", stages: ["ember-scribe", "halo-chorister", "dusk-warden"] },
  { name: "4连含BOSS (ghost→ember→halo→colossus)", stages: ["ghost", "ember-scribe", "halo-chorister", "colossus-metronome"] },
]

function runFight(encounterId: string, deck: ReturnType<typeof buildTeam>, seed: string, hpRatio: number) {
  const spec = resolveEncounter(BATTLE_CONTENT, encounterId)!
  const { state } = playBot(spec, deck, seed, BENCH, { apMax: testApMax(deck), hpRatio, policy: "smart" })
  return {
    won: state.phase === "won",
    hpRatioEnd: state.teamHp / Math.max(1, state.teamHpMax),
  }
}

console.log(`\n多场连战不回血模拟：L60 3 命座 · 聪明机器人 · 每组 ${SEEDS} 种子\n`)
for (const g of GAUNTLETS) {
  console.log(`【${g.name}】`)
  const rows: Record<string, Record<string, string>> = {}
  for (const [key, spec] of Object.entries(TEAMS)) {
    const deck = buildTeam(spec, 1000)
    let clears = 0
    let totalCleared = 0
    let endHpSum = 0
    const stageHp = g.stages.map(() => 0)
    const stageSurvived = g.stages.map(() => 0)

    for (let s = 0; s < SEEDS; s += 1) {
      let hpRatio = 1
      let cleared = 0
      for (let i = 0; i < g.stages.length; i += 1) {
        const res = runFight(g.stages[i]!, deck, `gauntlet-${g.name}-${key}-${s}-${i}`, hpRatio)
        if (!res.won) break
        cleared += 1
        hpRatio = res.hpRatioEnd
        stageHp[i]! += hpRatio
        stageSurvived[i]! += 1
      }
      totalCleared += cleared
      if (cleared === g.stages.length) {
        clears += 1
        endHpSum += hpRatio
      }
    }

    const label = PROBE_LABEL[key] ?? key
    const row: Record<string, string> = {
      全通率: `${Math.round((clears / SEEDS) * 100)}%`,
      平均过关: `${(totalCleared / SEEDS).toFixed(1)}/${g.stages.length}`,
      通关剩血: clears ? `${Math.round((endHpSum / clears) * 100)}%` : "—",
    }
    g.stages.forEach((_, i) => {
      row[`第${i + 1}场后剩血`] = stageSurvived[i] ? `${Math.round((stageHp[i]! / stageSurvived[i]!) * 100)}%` : "全灭"
    })
    rows[label] = row
  }
  console.table(rows)
}
