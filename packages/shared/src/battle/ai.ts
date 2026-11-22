import type { Condition, EnemyAi, EnemyMove } from "./content"
import type { BattleState, EnemyIntent } from "./types"

/** 条件求值只读这几样：回合、敌人血量、敌方支援 */
type AiContext = Pick<BattleState, "turn" | "enemySupports"> & { enemy: Pick<BattleState["enemy"], "hp" | "hpMax"> }

export function evalCondition(cond: Condition, ctx: AiContext): boolean {
  if ("turnMod" in cond) return ctx.turn % cond.turnMod[0] === cond.turnMod[1]
  if ("turnAtLeast" in cond) return ctx.turn >= cond.turnAtLeast
  if ("supportStacks" in cond) {
    const { support, gte, lte } = cond.supportStacks
    const stacks = ctx.enemySupports.find((s) => s.id === support)?.stacks ?? 0
    return (gte === undefined || stacks >= gte) && (lte === undefined || stacks <= lte)
  }
  if ("hpBelow" in cond) return ctx.enemy.hp / ctx.enemy.hpMax < cond.hpBelow
  if ("all" in cond) return cond.all.every((c) => evalCondition(c, ctx))
  if ("any" in cond) return cond.any.some((c) => evalCondition(c, ctx))
  return !evalCondition(cond.not, ctx)
}

function buildIntent(moveId: string, move: EnemyMove, ctx: AiContext, index: number): EnemyIntent {
  let fields = { ...move }
  for (const { when, ...patch } of move.variants ?? []) {
    if (evalCondition(when, ctx)) fields = { ...fields, ...patch }
  }
  const intent: EnemyIntent = {
    id: `${moveId}-${ctx.turn}-${index}`,
    kind: fields.kind,
    label: fields.label,
    element: fields.element,
    power: fields.power,
    hits: fields.hits,
    desc: fields.desc,
  }
  if (fields.causesDown) intent.causesDown = true
  if (fields.uninterruptible) intent.uninterruptible = true
  if (fields.chargedUltimate) intent.isChargedUltimate = true
  if (fields.status) intent.statusId = fields.status
  return intent
}

/** 按脚本生成本回合的敌方意图（公开给玩家看） */
export function intentsFor(ai: EnemyAi, ctx: AiContext): EnemyIntent[] {
  const picked: string[] = []
  let lastWhen: boolean | null = null
  for (const entry of ai.script) {
    if ("always" in entry) {
      picked.push(entry.always)
      lastWhen = null
    } else if ("use" in entry) {
      lastWhen = evalCondition(entry.when, ctx)
      if (lastWhen) picked.push(entry.use)
    } else {
      if (lastWhen === false) picked.push(entry.otherwise)
      lastWhen = null
    }
  }
  return picked.map((moveId, index) => buildIntent(moveId, ai.moves[moveId]!, ctx, index))
}
