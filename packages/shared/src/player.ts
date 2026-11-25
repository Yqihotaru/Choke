import { CONTENT } from "./content"
import { TUTORIAL_STEPS, type TutorialStep } from "./tutorial"

/** 玩家（账号）等级：只由服务端结算，客户端只读。数值在 content/progression.json 的 player 段 */
const PLAYER = CONTENT.progression.player

export const PLAYER_MAX_LEVEL = PLAYER.maxLevel

/** 跳过教程直接补到的等级（= 正常走完教程的等级） */
export const TUTORIAL_GRADUATE_LEVEL = PLAYER.tutorialGraduateLevel

/** 升到下一级需要的经验：先查表，表之后按最后一项指数增长 */
export function expToNextPlayerLevel(level: number): number {
  const table = PLAYER.expTable
  const fromTable = table[level - 1]
  if (fromTable !== undefined) return fromTable
  return Math.round(table[table.length - 1]! * Math.pow(PLAYER.expGrowthRate, Math.max(0, level - table.length)))
}

export function addPlayerExp(
  state: { level: number; exp: number },
  amount: number,
): { level: number; exp: number } {
  let level = state.level
  let exp = state.exp + Math.max(0, Math.round(amount))
  while (level < PLAYER_MAX_LEVEL && exp >= expToNextPlayerLevel(level)) {
    exp -= expToNextPlayerLevel(level)
    level += 1
  }
  if (level >= PLAYER_MAX_LEVEL) return { level: PLAYER_MAX_LEVEL, exp: 0 }
  return { level, exp }
}

/** 离开某一步时发的经验 */
export const TUTORIAL_STEP_EXP: Partial<Record<TutorialStep, number>> = PLAYER.tutorialStepExp

/** 教程是单向流水线：下一步固定；done 没有下一步 */
export function nextTutorialStep(step: TutorialStep): TutorialStep | null {
  const index = TUTORIAL_STEPS.indexOf(step)
  return index >= 0 && index < TUTORIAL_STEPS.length - 1 ? TUTORIAL_STEPS[index + 1]! : null
}

/** 副本每消耗 1 点体力给的玩家经验 */
export const PLAYER_EXP_PER_STAMINA = PLAYER.expPerStamina

/** 市场的参考等级（条件在 content/unlocks.json，市场还要完成引导、绑定账号） */
export const MARKET_UNLOCK_LEVEL = CONTENT.unlocks.market.level
