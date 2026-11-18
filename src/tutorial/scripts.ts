import raw from "./script.json"
import type { TutorialPlayableStep, TutorialScript } from "./types"

/**
 * 台本在 script.json 里，改台词、目标 id、经验值都不用碰代码。
 * 这里只做类型收口和格式化。
 */
export const TUTORIAL_STEP_ORDER = raw.steps as TutorialPlayableStep[]

export const TUTORIAL_SCRIPTS = raw.scripts as Record<
  TutorialPlayableStep,
  TutorialScript
>

export const TUTORIAL_CHARACTER = raw.character

/**
 * 台词里的 {packSize} / {deckSize} / {marketUnlockLevel} 由运行时代入，
 * 避免台本和配置各写一份数字。
 */
export function formatScriptText(
  text: string,
  values: Record<string, string | number | undefined>,
): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}
