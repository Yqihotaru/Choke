import { prettifyError } from "zod"

import { CONTENT } from "./content"
import { isItemId } from "./items"
import { SIGN_IN_ID, questsSchema, type QuestReward, type QuestsContent } from "./quests"

/**
 * 校验 content/quests.json：格式 + 引用（物品、卡包要存在）+ 几条规则。
 * 不过就抛错，服务端因此拒绝启动，pnpm content:check 也会失败。
 */
export function parseQuestContent(raw: unknown): QuestsContent {
  const result = questsSchema.safeParse(raw)
  if (!result.success) throw new Error(`content/quests.json 校验失败：\n${prettifyError(result.error)}`)
  const content = result.data

  const problems: string[] = []
  const packIds = new Set(Object.keys(CONTENT.packs.packs))

  const checkReward = (where: string, reward: QuestReward) => {
    for (const { itemId } of reward.items ?? []) {
      if (!isItemId(itemId)) problems.push(`${where}：物品 ${itemId} 不存在`)
    }
    for (const { pool } of reward.packs ?? []) {
      if (!packIds.has(pool)) problems.push(`${where}：卡包 ${pool} 不存在`)
    }
  }

  checkReward("signIn.base", content.signIn.base)
  for (const [day, reward] of Object.entries(content.signIn.bonus)) checkReward(`signIn.bonus.${day}`, reward)

  for (const [questId, quest] of Object.entries(content.quests)) {
    const where = `quests.${questId}`
    if (questId === SIGN_IN_ID) problems.push(`${where}：id「${SIGN_IN_ID}」留给签到记录，任务不能用`)
    checkReward(`${where}.rewards`, quest.rewards)
    if (quest.mapKind && !quest.event.startsWith("expedition-")) {
      problems.push(`${where}：mapKind 只能配在 expedition-* 事件上`)
    }
    if (quest.event === "sign-in" && quest.period === "daily" && quest.target !== 1) {
      problems.push(`${where}：每天最多签到 1 次，日常签到任务的目标只能是 1`)
    }
    if (quest.event === "sign-in" && quest.period === "weekly" && quest.target > 7) {
      problems.push(`${where}：一周最多签到 7 次`)
    }
    if (quest.event === "sign-in" && quest.period === "monthly" && quest.target > 31) {
      problems.push(`${where}：一个月最多签到 31 次`)
    }
  }

  if (problems.length > 0) throw new Error(`content/quests.json 校验失败：\n${problems.map((p) => `  ${p}`).join("\n")}`)
  return content
}
