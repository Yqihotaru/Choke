// 我方回合"还有没有能做的操作"判断（自动结束回合用）：开局有、AP 花光后没有、有倒下的卡且有替补就还能换人。
import { withAction } from "@choke/shared/battle/actions"
import { resolveEncounter } from "@choke/shared/battle/content"
import { canUseSkillReason, createBattle, hasLegalAction } from "@choke/shared/battle/engine"
import type { BattleState } from "@choke/shared/battle/types"

import { BATTLE_CONTENT } from "../src/content"
import { BENCH, DECKS, testApMax } from "./lib/battle-bot"

const failures: string[] = []
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures.push(`${name}${detail ? `：${detail}` : ""}`)
  console.log(`${ok ? "✔" : "✘"} ${name}${!ok && detail ? ` → ${detail}` : ""}`)
}

const deck = DECKS.normal!
const encounter = resolveEncounter(BATTLE_CONTENT, "ghost")!
const fresh = () => createBattle(encounter, deck, { seed: "legal-action", apMax: testApMax(deck), bench: BENCH })

const start = fresh()
check("开局有操作可做", hasLegalAction(start))

const ended = structuredClone(start) as BattleState
ended.phase = "won"
check("战斗已结束时没有操作", !hasLegalAction(ended))

const broke = structuredClone(start) as BattleState
broke.ap = 0
broke.hasActedThisTurn = true
check("AP 为 0、已经行动过：没有操作", !hasLegalAction(broke))

const noBenchSwap = structuredClone(broke) as BattleState
noBenchSwap.hasActedThisTurn = false
check("AP 为 0 但本回合还没行动：还能换人", hasLegalAction(noBenchSwap))

const downed = structuredClone(broke) as BattleState
downed.cards[0]!.down = true
check("AP 为 0 但场上有倒下的卡且有替补：还能换人", hasLegalAction(downed))

const cooling = structuredClone(downed) as BattleState
cooling.swapCooldown = 1
check("换人冷却中：不能换", !hasLegalAction(cooling))

const noReserve = structuredClone(downed) as BattleState
noReserve.bench = []
check("没有替补：不能换", !hasLegalAction(noReserve))

const oneAp = structuredClone(broke) as BattleState
oneAp.ap = 1
oneAp.defenseTier = 0
check("还剩 1 AP：至少能升防御", hasLegalAction(oneAp))

// 真实打一遍：不停出技能，回合内最终必然走到"没有操作"，此时结束回合能顺利进入下一回合
let state = fresh()
let steps = 0
while (hasLegalAction(state) && steps < 200) {
  steps += 1
  const current = state
  const pick = current.cards
    .flatMap((card, i) => card.skills.map((s) => ({ i, id: s.id })))
    .find(({ i, id }) => canUseSkillReason(current, i, id) === null)
  const act = pick
    ? withAction(current, { type: "skill", card: pick.i, skill: pick.id })
    : withAction(current, { type: "defend" })
  if (act.error) break
  state = act.state
}
check("出完能出的之后进入'没有操作'或战斗结束", !hasLegalAction(state) || state.phase !== "player", `steps=${steps}`)

if (failures.length) {
  console.error(`\n失败 ${failures.length} 项：\n${failures.join("\n")}`)
  process.exit(1)
}
console.log("\n全部通过")
