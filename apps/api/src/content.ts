import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { parseBattleContent, type BattleContent } from "@choke/shared/battle/content"
import { parseWorldContent, type WorldContent } from "@choke/shared/expedition/content"
import { parseQuestContent } from "@choke/shared/quest-content"
import type { QuestsContent } from "@choke/shared/quests"
// import 时即完成 schema + 交叉引用校验；失败会直接抛错，服务端拒绝启动
import { CONTENT_FILES } from "@choke/shared/content"

export const CONTENT_DIR = path.resolve(import.meta.dirname, "../../../content")

/** 由服务端从磁盘读的内容：单文件 + 「一个文件一个 id」的目录 */
const BATTLE_FILE = "enemy-supports.json"
const QUESTS_FILE = "quests.json"
const BATTLE_DIRS = ["enemies", "encounters", "maps", "rewards", "stories", "events"] as const

function isDirEntry(file: string): boolean {
  return BATTLE_DIRS.some(
    (dir) => file.startsWith(`${dir}/`) && file.endsWith(".json") && !file.slice(dir.length + 1).includes("/"),
  )
}

function readJson(root: string, file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"))
  } catch (error) {
    throw new Error(`content/${file} 不是合法的 JSON：${(error as Error).message}`, { cause: error })
  }
}

function readDir(root: string, files: string[], dir: (typeof BATTLE_DIRS)[number]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const file of files) {
    if (!file.startsWith(`${dir}/`) || !isDirEntry(file)) continue
    out[path.basename(file, ".json")] = readJson(root, file)
  }
  return out
}

function listFiles(dir: string, prefix = ""): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      return entry.isDirectory() ? listFiles(path.join(dir, entry.name), rel) : [rel]
    })
    .sort()
}

/** content/ 里所有文件；有没接入的文件就报错，避免新加的内容被悄悄忽略 */
function checkFiles(root: string): string[] {
  const files = listFiles(root)
  const required = [...CONTENT_FILES, BATTLE_FILE, QUESTS_FILE]
  const known = new Set<string>(required)
  const unknown = files.filter((file) => !known.has(file) && !isDirEntry(file))
  const missing = required.filter((file) => !files.includes(file))
  if (unknown.length > 0 || missing.length > 0) {
    throw new Error(
      [
        "content/ 目录和已接入的文件对不上：",
        unknown.length > 0
          ? `  没接入：${unknown.join(", ")}（单文件在 packages/shared/src/content/index.ts 里接入；${BATTLE_DIRS.join(" / ")} 下只放 .json）`
          : "",
        missing.length > 0 ? `  缺少：${missing.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }
  return files
}

/**
 * 内容版本 = 全部内容文件的哈希（换行统一成 LF，Windows / Linux 检出结果一致）。
 * 出征记录开始时的版本，重放时用同一版内容。
 */
function hashContent(root: string, files: string[]): string {
  const hash = crypto.createHash("sha256")
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n")
    hash.update(`${file}\0${text}\0`)
  }
  return hash.digest("hex").slice(0, 12)
}

/**
 * 读取并校验一个内容目录：文件清单 → 战斗内容 schema 与交叉引用 → 版本号。任何一步不过都抛错。
 * 服务端用真实的 content/；测试拿临时目录的副本来改坏。
 */
export function loadContentDir(root: string): {
  version: string
  battle: BattleContent
  world: WorldContent
  quests: QuestsContent
} {
  const files = checkFiles(root)
  const battle = parseBattleContent({
    enemies: readDir(root, files, "enemies"),
    supports: readJson(root, BATTLE_FILE),
    encounters: readDir(root, files, "encounters"),
  })
  const world = parseWorldContent(
    {
      maps: readDir(root, files, "maps"),
      rewards: readDir(root, files, "rewards"),
      stories: readDir(root, files, "stories"),
      events: readDir(root, files, "events"),
    },
    battle,
  )
  const quests = parseQuestContent(readJson(root, QUESTS_FILE))
  return { version: hashContent(root, files), battle, world, quests }
}

const loaded = loadContentDir(CONTENT_DIR)

export const CONTENT_VERSION = loaded.version

/** 敌人 / 敌方支援 / 遭遇 */
export const BATTLE_CONTENT: BattleContent = loaded.battle

/** 地图 / 掉落表 / 剧情 */
export const WORLD_CONTENT: WorldContent = loaded.world

/** 签到奖励表 / 任务 */
export const QUEST_CONTENT: QuestsContent = loaded.quests
