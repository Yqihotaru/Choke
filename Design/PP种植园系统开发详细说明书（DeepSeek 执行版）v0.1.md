# PP 种植园系统开发详细说明书（DeepSeek 执行版）v0.1

> **适用对象**：交由外部编码模型（如 DeepSeek）按本说明书**严格照做**，产出可运行、可过全量测试的种植园雏形。
> **核心原则**：**绝对隔离，只增不乱改**。禁止修改战斗引擎（`packages/shared/src/battle/`）、发牌/洗技能结构（`userCards.skillRefs`）和桌面 3D 活页书核心框架（`src/desk/shell/DeskBook.tsx`）。

---

## 0. 一键投喂给 DeepSeek 的执行指令（复制以下整段发给它）

```text
请严格按照 `Design/PP种植园系统开发详细说明书（DeepSeek 执行版）v0.1.md` 的全部规格实现 Choke! 种植园系统雏形：
1. 按顺序完成 §2（shared 纯逻辑）→ §3（SQL migration + Drizzle schema）→ §4（Fastify 路由 + 流水）→ §5（独立页面 /plantation 与桌面入口）→ §6（数据库测试 scripts/test-plantation.ts）。
2. 所有接口字段名、错误码、表结构、类型定义、包导出路径必须与文档完全一致，不得自创字段或改写现有核心表结构。
3. 完成后在 Windows PowerShell 依次执行以下验收命令，全部退出码为 0 才能汇报完成：
   pnpm typecheck; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; pnpm lint; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; pnpm build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; pnpm --filter @choke/api exec tsx scripts/test-plantation.ts; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; pnpm test
```

---

## 1. 本次雏形范围与红线（必读）

### 1.1 本次要做的（MVP 闭环）
1. **单人 6 格农田**：默认解锁前 4 格（`0..3`），可用金币解锁第 5、6 格（`4`、`5`）。
2. **4 种长周期作物**（`4h` / `6h` / `8h` / `12h`，永不枯萎）：种植 → 实时倒计时 → 成熟后单格收获或一键全部收获 → 产出 **金币 + 经验池（`expPool`）+ 少量普通卡包**。
3. **2 个打工席位**：玩家可将自己拥有的任意卡牌放入打工席（每席 1 张，不重复）；根据卡牌**稀有度**与 **`mods`（`DT`/`NC` 加速，`HR` 增产）**缩短成熟时间、提高产出。
4. **每日「抽鞭子（督促）」互动**：每天最多 5 次免费加速正在生长的田（立即推进 **15%** 成熟度），返回随机 osu! 梗吐槽气泡与动效，并记录动态日志。
5. **独立前端页面 `/plantation`**（附桌面顶部/导航快捷入口），复用项目统一字体与深色样式，**不改动 `DeskBook.tsx` 结构，避免和另一条前端分支冲突**。

### 1.2 本次明确不做的（禁止擅自扩展）
- ❌ 不做好友偷菜、好友列表、肿手鼠标彩蛋（留待后续社交阶段）。
- ❌ 不做料理台、调味料、大转盘。
- ❌ 不得修改 `userCards` 表结构，不得新增生活天赋列或占用战斗技能槽。
- ❌ 不得给打工卡加 `in_expedition` 式的锁卡限制（打工卡被分解/卖掉时，在查询接口里**自动过滤清理**即可）。
- ❌ 不改动 `content/unlocks.json` 的解锁测试逻辑（种植园设为**登录后直接可用**，方便内测体验）。

---

## 2. 共享层规格：`packages/shared/`

### 2.1 修改 `packages/shared/package.json`
在 `"exports"` 对象中新增一条（不要删改已有条目）：
```json
"./plantation": "./src/plantation.ts",
```

### 2.2 新建 `packages/shared/src/plantation.ts`
**完整规范与数值写死如下（可直接照抄并保持纯函数、无 Node/DOM 依赖）**：

```ts
import type { Rarity } from "./types"

export const MAX_PLOTS = 6
export const INITIAL_UNLOCKED_PLOTS = 4
export const MAX_WORKERS = 2
export const DAILY_WHIP_LIMIT = 5
export const WHIP_BOOST_RATIO = 0.15
export const MAX_SPEED_BONUS = 0.5
export const MAX_YIELD_BONUS = 0.8

/** 解锁第 5 块（slot=4）与第 6 块（slot=5）地所需金币 */
export const PLOT_UNLOCK_COSTS: Readonly<Record<number, number>> = {
  4: 500,
  5: 1200,
}

export const CROP_IDS = ["jump-wheat", "stream-corn", "tech-chili", "pp-tree"] as const
export type CropId = (typeof CROP_IDS)[number]

export interface CropDef {
  id: CropId
  name: string
  /** 成熟基础时长（毫秒） */
  durationMs: number
  /** 播种花费金币（0 表示免费） */
  seedCost: number
  /** 展示用虚拟 pp 数值（仅前端飘字 +XX pp! 用） */
  displayPp: number
  /** 基础产出 */
  reward: {
    coins: number
    expPool: number
    /** 固定产出普通卡包数（0 或 1） */
    normalPacks: number
  }
  desc: string
}

export const CROPS: Readonly<Record<CropId, CropDef>> = {
  "jump-wheat": {
    id: "jump-wheat",
    name: "Jump 小麦",
    durationMs: 4 * 60 * 60 * 1000, // 4 小时
    seedCost: 0,
    displayPp: 18,
    reward: { coins: 120, expPool: 180, normalPacks: 0 },
    desc: "4 小时成熟，零成本日常金币与入门经验池补给。",
  },
  "stream-corn": {
    id: "stream-corn",
    name: "Stream 玉米",
    durationMs: 6 * 60 * 60 * 1000, // 6 小时
    seedCost: 40,
    displayPp: 32,
    reward: { coins: 80, expPool: 420, normalPacks: 0 },
    desc: "6 小时成熟，高额经验池产出，专治新卡缺经验。",
  },
  "tech-chili": {
    id: "tech-chili",
    name: "Tech 辣椒",
    durationMs: 8 * 60 * 60 * 1000, // 8 小时
    seedCost: 60,
    displayPp: 46,
    reward: { coins: 220, expPool: 360, normalPacks: 0 },
    desc: "8 小时成熟，金币与经验池均衡双收。",
  },
  "pp-tree": {
    id: "pp-tree",
    name: "高星 PP 树",
    durationMs: 12 * 60 * 60 * 1000, // 12 小时
    seedCost: 120,
    displayPp: 85,
    reward: { coins: 260, expPool: 750, normalPacks: 1 },
    desc: "12 小时成熟，睡前种下，醒来收获大把经验池与 1 个普通卡包。",
  },
}

const RARITY_SPEED_BONUS: Readonly<Record<Rarity, number>> = {
  C: 0,
  UC: 0.03,
  R: 0.06,
  E: 0.1,
  L: 0.15,
  Mythic: 0.2,
  Prismatic: 0.25,
}

const RARITY_YIELD_BONUS: Readonly<Record<Rarity, number>> = {
  C: 0.02,
  UC: 0.05,
  R: 0.08,
  E: 0.12,
  L: 0.18,
  Mythic: 0.24,
  Prismatic: 0.3,
}

export interface WorkerSnapshot {
  slot: number
  userCardId: number
  cardId: string
  name: string
  rarity: Rarity
  level: number
  mods: string[]
  speedBonus: number
  yieldBonus: number
}

export function isCropId(value: string): value is CropId {
  return (CROP_IDS as readonly string[]).includes(value)
}

export function calcWorkerBonus(rarity: Rarity, mods: readonly string[]): { speedBonus: number; yieldBonus: number } {
  const hasDt = mods.includes("DT") || mods.includes("NC")
  const hasHr = mods.includes("HR")
  return {
    speedBonus: RARITY_SPEED_BONUS[rarity] + (hasDt ? 0.08 : 0),
    yieldBonus: RARITY_YIELD_BONUS[rarity] + (hasHr ? 0.1 : 0),
  }
}

export function totalWorkerBonuses(workers: readonly { speedBonus: number; yieldBonus: number }[]): {
  speedBonus: number
  yieldBonus: number
} {
  const rawSpeed = workers.reduce((sum, w) => sum + w.speedBonus, 0)
  const rawYield = workers.reduce((sum, w) => sum + w.yieldBonus, 0)
  return {
    speedBonus: Math.min(MAX_SPEED_BONUS, rawSpeed),
    yieldBonus: Math.min(MAX_YIELD_BONUS, rawYield),
  }
}

export function effectiveDurationMs(cropId: CropId, speedBonus: number): number {
  const clamped = Math.max(0, Math.min(MAX_SPEED_BONUS, speedBonus))
  return Math.max(60_000, Math.round(CROPS[cropId].durationMs * (1 - clamped)))
}

export interface PlotSnapshot {
  slot: number
  unlocked: boolean
  unlockCost: number | null
  cropId: CropId | null
  plantedAt: number | null
  boostMs: number
  effectiveDurationMs: number
  elapsedMs: number
  remainingMs: number
  /** 0..1 */
  progress: number
  ready: boolean
}

export function evaluatePlot(
  slot: number,
  unlocked: boolean,
  row: { cropId: CropId; plantedAt: number; boostMs: number } | null,
  speedBonus: number,
  now: number,
): PlotSnapshot {
  const unlockCost = unlocked ? null : (PLOT_UNLOCK_COSTS[slot] ?? null)
  if (!unlocked || !row) {
    return {
      slot,
      unlocked,
      unlockCost,
      cropId: null,
      plantedAt: null,
      boostMs: 0,
      effectiveDurationMs: 0,
      elapsedMs: 0,
      remainingMs: 0,
      progress: 0,
      ready: false,
    }
  }
  const dur = effectiveDurationMs(row.cropId, speedBonus)
  const elapsedMs = Math.max(0, now - row.plantedAt + row.boostMs)
  const remainingMs = Math.max(0, dur - elapsedMs)
  const progress = Math.min(1, elapsedMs / dur)
  return {
    slot,
    unlocked,
    unlockCost: null,
    cropId: row.cropId,
    plantedAt: row.plantedAt,
    boostMs: row.boostMs,
    effectiveDurationMs: dur,
    elapsedMs,
    remainingMs,
    progress,
    ready: remainingMs === 0,
  }
}

export function computeHarvestReward(cropId: CropId, yieldBonus: number): {
  coins: number
  expPool: number
  normalPacks: number
  displayPp: number
} {
  const base = CROPS[cropId]
  const mult = 1 + Math.max(0, Math.min(MAX_YIELD_BONUS, yieldBonus))
  return {
    coins: Math.round(base.reward.coins * mult),
    expPool: Math.round(base.reward.expPool * mult),
    normalPacks: base.reward.normalPacks,
    displayPp: Math.round(base.displayPp * mult),
  }
}

export const WHIP_QUOTES: readonly string[] = [
  "别抽了，手要断了！",
  "刚才那下 Choke 掉 50pp！",
  "再抽我就转战 mania 了！",
  "已开启 DT，浇水手速拉满！",
  "Cursor 抖成这样还怎么收菜！",
  "UR 掉进 70 了，庄稼长势喜人！",
  "别催了，727 毫秒内一定长好！",
  "谁把 HR 开了，田边怎么变红了？",
]

export interface PlantationLogView {
  id: number
  kind: "plant" | "whip" | "harvest" | "unlock" | "workers"
  message: string
  createdAt: string
}

export interface PlantationView {
  unlockedPlots: number
  maxPlots: number
  whipUsed: number
  whipLimit: number
  whipRemaining: number
  whipDay: string
  speedBonus: number
  yieldBonus: number
  plots: PlotSnapshot[]
  workers: WorkerSnapshot[]
  logs: PlantationLogView[]
}
```

---

## 3. 数据库迁移与 Schema：`apps/api/`

### 3.1 新建迁移 `apps/api/migrations/0021_plantation.sql`
必须使用 `CREATE TABLE IF NOT EXISTS` 与标准 PostgreSQL 类型（兼容真 PostgreSQL 与测试 PGlite）：

```sql
-- 种植园主状态：已开垦块数、每日抽鞭子计数、打工席（最多2个）
CREATE TABLE IF NOT EXISTS plantation_states (
  user_id text PRIMARY KEY,
  unlocked_plots integer NOT NULL DEFAULT 4,
  whip_day text NOT NULL DEFAULT '',
  whip_used integer NOT NULL DEFAULT 0,
  workers jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 农田地块：每格独立记录作物、种下时间与抽鞭子累计加速毫秒数
CREATE TABLE IF NOT EXISTS plantation_plots (
  user_id text NOT NULL,
  slot integer NOT NULL,
  crop_id text NOT NULL,
  planted_at bigint NOT NULL,
  boost_ms bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, slot)
);

-- 种植园动态日记：播种、督促吐槽、收获战报
CREATE TABLE IF NOT EXISTS plantation_logs (
  id serial PRIMARY KEY,
  user_id text NOT NULL,
  kind text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plantation_logs_user_id_idx ON plantation_logs (user_id, id DESC);
```

### 3.2 修改 `apps/api/src/db/schema.ts`
在文件末尾追加 3 张 Drizzle 表定义（注意 `primaryKey` 需从 `"drizzle-orm/pg-core"` 确认已导入；如未导入则补充导入）：

```ts
export interface PlantationWorkerRow {
  slot: number
  userCardId: number
}

export const plantationStates = pgTable("plantation_states", {
  userId: text("user_id").primaryKey(),
  unlockedPlots: integer("unlocked_plots").notNull().default(4),
  whipDay: text("whip_day").notNull().default(""),
  whipUsed: integer("whip_used").notNull().default(0),
  workers: jsonb("workers").$type<PlantationWorkerRow[]>().notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export const plantationPlots = pgTable(
  "plantation_plots",
  {
    userId: text("user_id").notNull(),
    slot: integer("slot").notNull(),
    cropId: text("crop_id").notNull(),
    plantedAt: bigint("planted_at", { mode: "number" }).notNull(),
    boostMs: bigint("boost_ms", { mode: "number" }).notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.slot] })],
)

export const plantationLogs = pgTable(
  "plantation_logs",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("plantation_logs_user_id_idx").on(table.userId, table.id.desc())],
)
```

---

## 4. 后端服务与接口：`apps/api/`

### 4.1 修改 `apps/api/src/ledger.ts`
在 `SOURCE_LABELS` 中补充以下 3 个来源中文名：
```ts
  "plantation-unlock": "种植园开垦",
  "plantation-seed": "种植园播种",
  "plantation-harvest": "种植园收获",
```

### 4.2 新建 `apps/api/src/routes/plantation.ts`

#### 必须遵循的后端规范
1. **鉴权**：全部接口使用 `requireSelf(request, reply, paramUserId)`。
2. **并发与事务**：所有写操作全部包在 `runTx(async (tx) => { await lockUser(tx, userId); ... })` 内（可参考 `apps/api/src/routes/shop.ts` 和 `apps/api/src/tx.ts`）。
3. **每日重置日期 key**：统一调用 `@choke/shared/reset` 里的 `periodKey("daily", now)`。
4. **流水与经验池**：
   - 扣金币前检查 `users.coins >= cost`，不足时抛 `new TxAbort(400, "not_enough_coins", "金币不足")`，扣款后调用 `recordLedger(tx, userId, [{ kind: "coins", delta: -cost }], { source: ... })`。
   - 收获加金币调用 `recordLedger(tx, userId, [{ kind: "coins", delta: coins }], { source: "plantation-harvest", sourceRef: ... })`。
   - 收获加经验池直接调用 `apps/api/src/card-exp.ts` 的 `addExpPool(tx, userId, expPool, { source: "plantation-harvest", sourceRef: ... })`（它内部会自动更新 `users.expPool` 并记流水）。
   - 收获加普通卡包使用 `userPacks` 的 `onConflictDoUpdate` 并调用 `recordLedger(tx, userId, [{ kind: "pack", ref: "normal", delta: normalPacks }], { source: "plantation-harvest", sourceRef: ... })`。
5. **打工卡读取与自动清理**：
   - 查询 `state.workers` 对应的 `userCards`（`innerJoin(cards, eq(cards.id, userCards.cardId))`）且 `eq(userCards.userId, userId)`；
   - 如果原卡已被分解或卖给别人，自动过滤掉不存在的卡（并在写操作或懒清理时写回），**绝不报错阻塞整个种植园加载**。
6. **日志裁剪**：写入一条新日志后，无需复杂定时清理，查询列表时按 `desc(plantationLogs.id)` `.limit(20)` 返回即可。

#### 接口清单（共 6 个，全部返回 `{ ok: true, data: ... }`）

| Method | Path | Body (Zod) | 核心业务与校验 | 返回 `data` |
|---|---|---|---|---|
| `GET` | `/users/:userId/plantation` | — | 懒插入 `plantationStates`（若不存在），读出地块/打工卡/最近 20 条日志并返回 `PlantationView` | `{ ...PlantationView, coins: number, expPool: number }` |
| `POST` | `/users/:userId/plantation/unlock-plot` | — | `nextSlot = state.unlockedPlots`；若 `>= MAX_PLOTS` 抛 `400 all_unlocked`；扣 `PLOT_UNLOCK_COSTS[nextSlot]` 金币；`unlockedPlots + 1`；记流水与日志 | `{ plantation: PlantationView, coins: number }` |
| `POST` | `/users/:userId/plantation/plant` | `{ slot: int(0..5), cropId: string }` | 校验 `isCropId(cropId)`；校验 `slot < state.unlockedPlots`；校验该 `slot` 当前无作物（否则 `400 plot_occupied`）；若 `seedCost > 0` 扣金币并记流水；插入 `plantationPlots`（`plantedAt: now, boostMs: 0`）；记日志 | `{ plantation: PlantationView, coins: number }` |
| `POST` | `/users/:userId/plantation/whip` | `{ slot: int(0..5) }` | 按 `periodKey("daily", now)` 重置或读取当日 `whipUsed`；若 `>= DAILY_WHIP_LIMIT` 抛 `400 whip_limit_reached`；校验该地有作物且未成熟（`!ready`，否则 `400 already_ready`）；计算 `addMs = Math.floor(effectiveDurationMs * WHIP_BOOST_RATIO)` 更新 `boostMs`；`whipUsed + 1`；随机选一条 `WHIP_QUOTES` 台词并写入日志 | `{ plantation: PlantationView, quote: string, boostedMs: number }` |
| `POST` | `/users/:userId/plantation/harvest` | `{ slot: int(0..5) }` | 校验该地有作物且 `ready === true`（否则 `400 not_ready`）；按当前打工席 `yieldBonus` 计算收获；删除该地块行；发放 `coins` / `addExpPool` / `normalPacks` + 记流水 + 写日志 | `{ plantation: PlantationView, gained: { coins, expPool, normalPacks, displayPp }, coins: number, expPool: number }` |
| `POST` | `/users/:userId/plantation/harvest-all` | — | 一键收获所有 `ready === true` 的地块，合并发放与记账（无熟地则 `400 nothing_to_harvest`） | `{ plantation: PlantationView, gained: { coins, expPool, normalPacks, displayPp }, harvestedCount: number, coins: number, expPool: number }` |
| `PUT` | `/users/:userId/plantation/workers` | `{ cardIds: array(int).max(2) }` | 去重后逐张校验均属于 `userId`（否则 `404 card_not_found`）；按顺序保存 `[{ slot: i, userCardId }]`；写入日志 | `{ plantation: PlantationView }` |

### 4.3 修改 `apps/api/src/index.ts`
导入并注册路由：
```ts
import { plantationRoutes } from "./routes/plantation"
// ...
await app.register(plantationRoutes)
```

---

## 5. 前端实现规格：`src/plantation/` & `src/App.tsx`

### 5.1 路由接入（避免冲突，独立成页）
1. 修改 `src/App.tsx`：
   仿照 `ExpeditionPage` 的写法新增懒加载页面 `/plantation`：
   ```ts
   const PlantationPage = lazy(() =>
     import("@/plantation/PlantationPage").then((m) => ({ default: m.PlantationPage }))
   )
   ```
   在 `if (path.endsWith("expedition"))` 之后加入：
   ```tsx
   if (path.endsWith("plantation")) {
     return (
       <Suspense fallback={FALLBACK}>
         <PlantationPage />
       </Suspense>
     )
   }
   ```
2. 桌面入口（极轻改动）：
   检查 `src/desk/DeskPage.tsx` 或 `src/desk/panels/player/AboutPanel.tsx` / `src/expedition/ExpeditionPage.tsx` 导航栏，在桌面左上或远征左侧导航中**仅增加 1 个普通链接 `<a href="/plantation">🌱 PP 种植园</a>`**（不改动任何 `DeskBook` / `TutorialOverlay` / `DeckPanel` 逻辑）。

### 5.2 前端 API 封装：新建 `src/plantation/api.ts`
**独立文件封装请求，不要修改 `src/desk/session/api.ts`**，只需复用其中的 `fetchMe`、`fetchUserCards`、`toFace`、`ApiError` 即可：
- 导出类型与请求函数：
  - `fetchPlantation(userId)` → `GET /api/users/${userId}/plantation`
  - `unlockPlot(userId)` → `POST /api/users/${userId}/plantation/unlock-plot`
  - `plantCrop(userId, slot, cropId)` → `POST /api/users/${userId}/plantation/plant`
  - `whipPlot(userId, slot)` → `POST /api/users/${userId}/plantation/whip`
  - `harvestPlot(userId, slot)` → `POST /api/users/${userId}/plantation/harvest`
  - `harvestAllPlots(userId)` → `POST /api/users/${userId}/plantation/harvest-all`
  - `setPlantationWorkers(userId, cardIds)` → `PUT /api/users/${userId}/plantation/workers`
- 注意：非 `GET` 请求出错时解析 `{ error: { code, message } }` 并抛出含可读中文 `message` 的 `Error`。

### 5.3 前端页面与样式：新建 `src/plantation/PlantationPage.tsx` & `src/plantation/plantation.css`
1. **视觉规范（必须与 Choke! 统一，不能做成简陋白框控制台）**：
   - 背景 `#110e16`，主卡片 `#1a1622`，次级底 `#231e2e`，边框 `#322b42`，主题强调色 `#e0407b`（osu! 粉）与 `#22b07d`（成熟绿）。
   - 字体：`Outfit Variable, Outfit, HYWenHei, PingFang SC, Microsoft YaHei, sans-serif`；数值/倒计时统一用 `JetBrains Mono Variable, JetBrains Mono, monospace` + `font-variant-numeric: tabular-nums`。
2. **功能与交互细节**：
   - 顶栏：`<a href="/">← 返回桌面</a>`、标题「PP 种植园」、当前金币 & 经验池实时余额、今日督促剩余次数（`whipRemaining / 5`）、**「一键收菜」**主按钮（无熟地时 disabled）。
   - **实时倒计时**：用 `useEffect` 每 `1000ms` 更新 `now` 状态，前端根据 `plantedAt + boostMs` 与 `effectiveDurationMs` 实时计算当前剩余 `HH:MM:SS` 与进度百分比，无需每秒轮询后端；倒计时归零自动切换为「可收获」发光状态！
   - **农田 6 格卡片**：
     - **未解锁**：显示解锁所需金币 +「开垦新田」按钮。
     - **空闲**：内联展示 4 种作物的选择按钮（名称、时长、种子费、预期产出），点一下直接播种。
     - **生长中**：展示简洁**扁平作物 SVG 图标**（麦穗 / 玉米 / 辣椒 / PP 树，纯内联 SVG）、动态进度条、剩余倒计时、以及**「抽一鞭子 (+15%)」**按钮（点击触发卡片 CSS `@keyframes` 抖动 + 飘出气泡吐槽 `quote` + `playSfx("hit")` 或 `playSfx("click")`）。
     - **已成熟**：卡片绿色高亮微光 + `+XX pp!` 徽章 +「收获」按钮（点击触发飘字 `+XX 金币 / +XX 经验池` + `playSfx("pick")`）。
   - **右侧栏**：
     - **打工席（2 格）**：显示当前已派驻卡牌（名字、Lv、稀有度色边、加速/增产百分比），点击可打开选卡弹窗（通过 `fetchUserCards` 分页/搜索选卡，支持清空或替换）。
     - **农场动态**：展示最近 20 条种植/督促/收获战报日志。

---

## 6. 自动化测试规格：`apps/api/scripts/test-plantation.ts`

1. 使用本仓库规范的 `setupTestDb("plantation")` 模板（与 `apps/api/scripts/test-ledger.ts` 完全一致的 `Fastify` + `@fastify/cookie` + `handleError` + `makeSession` 模式）。
2. 必须覆盖并断言通过以下用例：
   - **懒初始化与鉴权**：未登录 / 越权访问他人种植园返回 `401`/`403`；本人首次 `GET` 自动返回 4 块已解锁地 + 2 块未解锁地，`whipRemaining === 5`。
   - **播种与金币校验**：金币不足种高价作物返回 `400 not_enough_coins`；种 `jump-wheat`（免费）成功，再往同一格种返回 `400 plot_occupied`。
   - **抽鞭子加速与每日上限**：连续抽 5 次每次推进 15% 进度且返回吐槽台词；第 6 次返回 `400 whip_limit_reached`；跨天（或改 `whipDay`）后重置计数。
   - **成熟与收获结算**：未成熟地块调用 `harvest` 返回 `400 not_ready`；将 `plantedAt` 回拨至成熟后调用 `harvest`（及 `harvest-all`），断言地块清空、`users.coins` 和 `users.expPool` 正确到账、且 `ledger_entries` 中写明了 `plantation-harvest` 流水。
   - **打工席加成与失效自动清理**：设置 1 张带 `DT`+`HR` 的高稀有度打工卡，`GET` 返回正确 `speedBonus`/`yieldBonus` 且缩短 `effectiveDurationMs`、放大收获收益；把该卡从 `user_cards` 删除后再次 `GET`，接口正常返回 `200` 且自动清理失效打工席。
   - **开垦第 5 块地**：金币足够时 `unlock-plot` 成功扣除 `500` 金币并解锁 `slot=4`（`unlockedPlots === 5`）。

---

## 7. 最后自检清单（交付前必跑）

1. 检查没有改动无关测试（`pnpm test` 全部 24 项——原 23 项 + 新增 `plantation`——全部通过）。
2. 检查没有任何 ESLint error / TypeScript error（`pnpm typecheck` 与 `pnpm lint` 与 `pnpm build` 全绿）。
3. 将改动文件清单与测试输出汇总给用户，不谎报未跑过的检查。
