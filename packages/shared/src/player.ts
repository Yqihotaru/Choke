import { TUTORIAL_STEPS, type TutorialStep } from "./tutorial"

/** 玩家（账号）等级：只由服务端结算，客户端只读 */
export const PLAYER_MAX_LEVEL = 60

/** 跳过教程直接补到的等级（= 正常走完教程的等级） */
export const TUTORIAL_GRADUATE_LEVEL = 3

/** 升到下一级需要的经验；index 是当前等级 */
const PLAYER_EXP_REQUIRED: Record<number, number> = {
  1: 100,
  2: 150,
  3: 250,
  4: 400,
  5: 600,
  6: 900,
}

export function expToNextPlayerLevel(level: number): number {
  return PLAYER_EXP_REQUIRED[level] ?? Math.round(900 * Math.pow(1.22, Math.max(0, level - 6)))
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

/**
 * 离开某一步时发的经验。album-view 100（1→2），deck-view 80 + battle-view 70（2→3），
 * 所以正常走完教程正好 Lv.3。
 */
export const TUTORIAL_STEP_EXP: Partial<Record<TutorialStep, number>> = {
  "album-view": 100,
  "deck-view": 80,
  "battle-view": 70,
}

/** 教程是单向流水线：下一步固定；done 没有下一步 */
export function nextTutorialStep(step: TutorialStep): TutorialStep | null {
  const index = TUTORIAL_STEPS.indexOf(step)
  return index >= 0 && index < TUTORIAL_STEPS.length - 1 ? TUTORIAL_STEPS[index + 1]! : null
}

/** 副本每消耗 1 点体力给的玩家经验 */
export const PLAYER_EXP_PER_STAMINA = 1
