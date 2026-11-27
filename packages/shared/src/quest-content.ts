import { prettifyError } from "zod"

import { CONTENT } from "./content"
import type { WorldContent } from "./expedition/content"
import { isItemId } from "./items"
import { SIGN_IN_ID, questsSchema, type QuestReward, type QuestsContent } from "./quests"

/**
 * 校验 content/quests.json：格式 + 引用（物品、卡包、地图要存在）+ 几条规则。
 * 不过就抛错，服务端因此拒绝启动，pnpm content:check 也会失败。
 * world 不传就不核对 mapId（只有单测会这样）。
 */
export function parseQuestContent(raw: unknown, world?: Pick<WorldContent, "maps">): QuestsContent {
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
    const isExpeditionEvent = quest.event.startsWith("expedition-")
    if (quest.mapKind && !isExpeditionEvent) {
      problems.push(`${where}：mapKind 只能配在 expedition-* 事件上`)
    }
    if (quest.mapId) {
      if (!isExpeditionEvent) problems.push(`${where}：mapId 只能配在 expedition-* 事件上`)
      else if (world && !world.maps[quest.mapId]) problems.push(`${where}：地图 ${quest.mapId} 不存在`)
      else if (world && quest.mapKind && world.maps[quest.mapId]!.kind !== quest.mapKind) {
        problems.push(`${where}：地图 ${quest.mapId} 不是 ${quest.mapKind} 地图`)
      }
    }
    if (quest.minRarity && quest.event !== "card-obtain") {
      problems.push(`${where}：minRarity 只能配在 card-obtain 事件上`)
    }
    if (quest.event === "expedition-tier" && quest.target > 5) {
      problems.push(`${where}：难度档位最高是 5`)
    }
  }

  if (problems.length > 0) throw new Error(`content/quests.json 校验失败：\n${problems.map((p) => `  ${p}`).join("\n")}`)
  return content
}
