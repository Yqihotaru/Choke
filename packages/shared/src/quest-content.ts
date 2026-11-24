import { prettifyError } from "zod"

import { CONTENT } from "./content"
import type { WorldContent } from "./expedition/content"
import { isItemId } from "./items"
import {
  QUEST_PERIODS,
  SIGN_IN_ID,
  questsSchema,
  type QuestReward,
  type QuestsContent,
} from "./quests"

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

  const pointsTotal = Object.fromEntries(QUEST_PERIODS.map((p) => [p, 0])) as Record<(typeof QUEST_PERIODS)[number], number>
  for (const quest of Object.values(content.quests)) {
    if (quest.period !== "once") pointsTotal[quest.period] += quest.points
  }
  for (const period of QUEST_PERIODS) {
    const chests = content.activity[period] ?? []
    chests.forEach((chest, i) => {
      const where = `activity.${period}[${i}]`
      checkReward(`${where}.rewards`, chest.rewards)
      if (i > 0 && chest.at <= chests[i - 1]!.at) problems.push(`${where}：at 必须比前一档大`)
    })
    const top = chests.at(-1)?.at ?? 0
    if (top > pointsTotal[period]) {
      problems.push(`activity.${period}：最大一档要 ${top} 点，但这个周期的任务活跃点加起来只有 ${pointsTotal[period]}，永远领不到`)
    }
  }

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
    if (quest.period === "once" && quest.points > 0) {
      problems.push(`${where}：一次性成就不给活跃点，points 必须是 0`)
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
