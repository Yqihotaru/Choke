// pnpm test:expedition —— 远征点数：发点表、价格、分配校验、稀有度权限、AP 上限传进引擎。
import { resolveEncounter } from "@choke/shared/battle/content"
import { createBattle } from "@choke/shared/battle/engine"
import {
  BASE_AP_MAX,
  BASE_SLOTS,
  FREE_ALLOCATION,
  FULL_ALLOCATION_COST,
  MAX_SLOTS,
  UPGRADED_AP_MAX,
  allocationCost,
  allocationError,
  apMaxOf,
  cardAllowed,
  firstDisallowedCard,
  totalPoints,
  type ExpeditionAllocation,
} from "@choke/shared/expedition-points"
import { PLAYER_MAX_LEVEL } from "@choke/shared/player"
import type { Rarity } from "@choke/shared/types"

import { BATTLE_CONTENT } from "../src/content"
import { face, inputs } from "./lib/battle-bot"

const failures: string[] = []
let count = 0
function check(name: string, ok: boolean, detail = "") {
  count += 1
  if (!ok) failures.push(`${name}${detail ? `：${detail}` : ""}`)
  console.log(`${ok ? "✔" : "✘"} ${name}${!ok && detail ? ` → ${detail}` : ""}`)
}

const alloc = (patch: Partial<ExpeditionAllocation> = {}): ExpeditionAllocation => ({ ...FREE_ALLOCATION, ...patch })

// ---------- 1. 发点表 ----------
check("发点：1 级 8 点", totalPoints(1) === 8, `${totalPoints(1)}`)
check("发点：2 级还是 8 点（没到下一档）", totalPoints(2) === 8)
check("发点：3 级 11 点", totalPoints(3) === 11, `${totalPoints(3)}`)
check("发点：50 级累计 41 点", totalPoints(50) === 41, `${totalPoints(50)}`)
check("发点：50 级以后不再增加", totalPoints(PLAYER_MAX_LEVEL) === totalPoints(50))
check("发点：随等级单调不降", Array.from({ length: PLAYER_MAX_LEVEL }, (_, i) => totalPoints(i + 1)).every((v, i, a) => i === 0 || v >= a[i - 1]!))

// ---------- 2. 价格 ----------
check("价格：免费分配 0 点", allocationCost(FREE_ALLOCATION) === 0)
check("价格：卡槽 5 个 3 点", allocationCost(alloc({ slots: 5 })) === 3)
check("价格：卡槽 7 个 9 点", allocationCost(alloc({ slots: 7 })) === 9)
check("价格：AP 升级 8 点", allocationCost(alloc({ apUpgrade: true })) === 8)
check("价格：L 3 点", allocationCost(alloc({ maxRarity: "L" })) === 3)
check("价格：Mythic 要连 L 一起买，共 8 点", allocationCost(alloc({ maxRarity: "Mythic" })) === 8)
check("价格：Prismatic 连前两档共 16 点", allocationCost(alloc({ maxRarity: "Prismatic" })) === 16)
check("价格：全点 33 点", FULL_ALLOCATION_COST === 33, `${FULL_ALLOCATION_COST}`)
check("目标：50 级点数够全点", totalPoints(50) >= FULL_ALLOCATION_COST)
check("目标：1 级点不满", totalPoints(1) < FULL_ALLOCATION_COST)

// ---------- 3. 分配校验 ----------
check("校验：免费分配永远合法（0 级也行）", allocationError(FREE_ALLOCATION, 1) === null)
check("校验：1 级 8 点能买 AP 升级", allocationError(alloc({ apUpgrade: true }), 1) === null)
check("校验：1 级买 AP 升级 + 1 个卡槽超点数", allocationError(alloc({ apUpgrade: true, slots: 5 }), 1) !== null)
check("校验：50 级全点合法", allocationError({ slots: MAX_SLOTS, apUpgrade: true, maxRarity: "Prismatic" }, 50) === null)
check("校验：45 级（38 点）全点合法", allocationError({ slots: MAX_SLOTS, apUpgrade: true, maxRarity: "Prismatic" }, 45) === null)
check("校验：全点在 20 级（23 点）买不起", allocationError({ slots: MAX_SLOTS, apUpgrade: true, maxRarity: "Prismatic" }, 20) !== null)
check("校验：卡槽少于基础值被拒", allocationError(alloc({ slots: BASE_SLOTS - 1 }), 50) !== null)
check("校验：卡槽超过上限被拒", allocationError(alloc({ slots: MAX_SLOTS + 1 }), 50) !== null)
check("校验：卡槽不是整数被拒", allocationError(alloc({ slots: 4.5 }), 50) !== null)
check("校验：稀有度写错被拒", allocationError({ ...FREE_ALLOCATION, maxRarity: "SSR" }, 50) !== null)
check("校验：稀有度低于免费档被拒", allocationError(alloc({ maxRarity: "C" }), 50) !== null)
check("校验：apUpgrade 不是布尔被拒", allocationError({ ...FREE_ALLOCATION, apUpgrade: 1 }, 50) !== null)
check("校验：缺字段被拒", allocationError({ slots: 4 }, 50) !== null)
check("校验：null 和字符串被拒", allocationError(null, 50) !== null && allocationError("x", 50) !== null)
check("校验：只有 Mythic 没点 L 的状态表示不出来（点到 Mythic 就含 L 的价）", allocationCost(alloc({ maxRarity: "Mythic" })) > allocationCost(alloc({ maxRarity: "L" })))

// ---------- 4. 稀有度权限 ----------
const rarities: Rarity[] = ["C", "UC", "R", "E", "L", "Mythic", "Prismatic"]
const allowedUnder = (maxRarity: Rarity) => rarities.filter((rarity) => cardAllowed(alloc({ maxRarity }), { rarity }))
check("权限：免费档只能带 C、UC、R、E", allowedUnder("E").join() === "C,UC,R,E", allowedUnder("E").join())
check("权限：点了 L 多带 L", allowedUnder("L").join() === "C,UC,R,E,L")
check("权限：点了 Mythic 多带 Mythic", allowedUnder("Mythic").join() === "C,UC,R,E,L,Mythic")
check("权限：点满带所有", allowedUnder("Prismatic").length === rarities.length)
check("权限：本体卡不受限制（免费档也能带 Prismatic 本体卡）", cardAllowed(FREE_ALLOCATION, { rarity: "Prismatic", isHero: true }))
check(
  "权限：找出第一张违规的卡",
  firstDisallowedCard(FREE_ALLOCATION, [{ rarity: "R" }, { rarity: "L" }, { rarity: "Mythic" }]) === 1,
)
check("权限：全部合法返回 -1", firstDisallowedCard(FREE_ALLOCATION, [{ rarity: "R" }, { rarity: "Prismatic", isHero: true }]) === -1)

// ---------- 5. AP 上限进引擎 ----------
check("AP：基础 6，升级后 10", BASE_AP_MAX === 6 && UPGRADED_AP_MAX === 10)
check("AP：apMaxOf 跟分配走", apMaxOf(FREE_ALLOCATION) === 6 && apMaxOf(alloc({ apUpgrade: true })) === 10)
{
  const spec = resolveEncounter(BATTLE_CONTENT, "tutorial-ghost")!
  const cards = inputs([face("a", "tank", "R", 20, 0, ["bulwark_quake"])], 10)
  for (const apMax of [6, 10]) {
    check(`引擎：开战参数 apMax=${apMax} 原样生效`, createBattle(spec, cards, { seed: "ap", apMax }).apMax === apMax)
  }
  // 本体卡 / Mythic 不再自动抬高 AP 上限
  const high = inputs([face("m", "tank", "Mythic", 20, 0, ["bulwark_quake"])], 20)
  check("引擎：带 Mythic 也不会自动升 AP 上限", createBattle(spec, high, { seed: "ap", apMax: 6 }).apMax === 6)
}

console.log(`\n${count} 项检查，未通过 ${failures.length}`)
if (failures.length > 0) {
  console.log(failures.map((f) => `  - ${f}`).join("\n"))
  process.exit(1)
}
