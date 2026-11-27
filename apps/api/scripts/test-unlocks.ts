// pnpm test:unlocks —— 功能解锁表和玩家经验曲线：条件判断、表自洽、曲线落在目标区间。
import { CONTENT } from "@choke/shared/content"
import {
  PLAYER_MAX_LEVEL,
  TUTORIAL_GRADUATE_LEVEL,
  expToNextPlayerLevel,
} from "@choke/shared/player"
import {
  FEATURE_IDS,
  isUnlocked,
  lockMessage,
  lockReason,
  unlockLevelOf,
  type UnlockContext,
} from "@choke/shared/unlocks"

const failures: string[] = []
let count = 0
function check(name: string, ok: boolean, detail = "") {
  count += 1
  if (!ok) failures.push(`${name}${detail ? `：${detail}` : ""}`)
  console.log(`${ok ? "✔" : "✘"} ${name}${!ok && detail ? ` → ${detail}` : ""}`)
}

const ctx = (patch: Partial<UnlockContext> = {}): UnlockContext => ({
  level: 1,
  tutorialDone: false,
  linkedAccount: true,
  ...patch,
})

// 条件判断
check("新号：开包可用", isUnlocked("packs", ctx()))
check("没完成引导：背包锁，原因是引导", lockReason("backpack", ctx({ level: 3 }))?.kind === "tutorial")
check("完成引导且到等级：背包开", isUnlocked("backpack", ctx({ level: 3, tutorialDone: true })))
check(
  "完成引导但等级不够：融合锁，原因带所需等级",
  (() => {
    const reason = lockReason("fuse", ctx({ level: 3, tutorialDone: true }))
    return reason?.kind === "level" && reason.level === unlockLevelOf("fuse")
  })(),
)
check(
  "市场：游客锁，原因是账号（即使等级和引导都够）",
  lockReason("market", ctx({ level: 60, tutorialDone: true, linkedAccount: false }))?.kind === "account",
)
check("市场：绑定账号并完成引导就开", isUnlocked("market", ctx({ level: TUTORIAL_GRADUATE_LEVEL, tutorialDone: true })))
check(
  "提示文案带功能名",
  lockMessage("market", { kind: "account" }).includes(CONTENT.unlocks.market.name) &&
    lockMessage("fuse", { kind: "level", level: 4 }).includes("Lv.4"),
)

// 表自洽
check("解锁表不为空", FEATURE_IDS.length > 0)
check(
  "满级玩家（完成引导、绑定账号）全部解锁",
  FEATURE_IDS.every((id) => isUnlocked(id, ctx({ level: PLAYER_MAX_LEVEL, tutorialDone: true }))),
)
check(
  "所有功能在 Lv15 前解锁（前三天主要功能开完）",
  FEATURE_IDS.every((id) => unlockLevelOf(id) <= 15),
  FEATURE_IDS.filter((id) => unlockLevelOf(id) > 15).join(", "),
)

// 经验曲线
const need = (from: number, to: number) => {
  let sum = 0
  for (let level = from; level < to; level += 1) sum += expToNextPlayerLevel(level)
  return sum
}
check("教程两级不变：Lv1→3 共 250", need(1, 3) === 250, String(need(1, 3)))
check("Lv1→15 累计约 4,750（前三天目标）", need(1, 15) >= 4500 && need(1, 15) <= 5000, String(need(1, 15)))
check("Lv1→50 累计约 25,000（三周多干满）", need(1, 50) >= 24000 && need(1, 50) <= 26000, String(need(1, 50)))
check("Lv50→60 很陡：每级至少是 Lv49 的 4 倍", expToNextPlayerLevel(50) >= expToNextPlayerLevel(49) * 4)
check(
  "每一级的需求不比上一级少（教程两级除外后单调不降）",
  Array.from({ length: PLAYER_MAX_LEVEL - 3 }, (_, i) => i + 2).every(
    (level) => expToNextPlayerLevel(level + 1) >= expToNextPlayerLevel(level),
  ),
)

console.log(`\n${count} 项检查，未通过 ${failures.length}`)
if (failures.length > 0) {
  console.log(failures.map((f) => `  - ${f}`).join("\n"))
  process.exit(1)
}
