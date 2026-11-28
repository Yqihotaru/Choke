# Choke! Code Review 问题清单 v0.2

> 整理时间：2026-11-28
> 基线：HEAD `43fc49a`（远征 Ch1/Ch2 扩展 `1b74db4` 之后仅有一个 docs 提交）。
> 验证：`pnpm typecheck`、`pnpm lint`、`pnpm content:check`、`pnpm test:fast`、`pnpm test:db` 全部通过（DB 测试 12/12）。
> 本文件取代 v0.1 中尚未闭环的条目；v0.1 保留为历史记录。
>
> 阅读顺序按你的要求调整：**第一节是已修复（全部前置并标 ✅）**，第二节起才是待修问题；第五节单独记录「故意为之 / 已排除」，防止下次复查重复报（空白节点已按设计说明移到这里）。
> 编号延续 v0.1，新问题从 **#39** 开始。
> 2026-11-28：**#39 / #40 / #41 / #42 / #43 / #44 已修复**，证据见 §1.4。

---

## 一、已修复 / 已确认无需处理（前置）

### 1.1 本轮逐条读代码复核，确认已修（v0.1 编号）

| 编号 | 问题摘要 | 结论与证据 |
| --- | --- | --- |
| #1 | `removeUserCard` 未校验返回值 / 误改历史挂单 / 未拦在售 | ✅ 已修。`progression.ts:51-72` 先拦出征（`anyLocked`）再拦 `status='active'` 挂单，删除 0 行抛 `409 conflict`，并清 `deckSlots`；批量分解 / 回收 / 喂养 / 命座都复用此函数。 |
| #2 | `POST /reroll-skill` 未检查 `.returning()` | ✅ 已修。`progression.ts:1109` 用 `.returning({ id })` 判空后回滚。 |
| #3 / #22 | 体力药水一次买多瓶空扣金币 | ✅ 已消失。体力系统已取消，`routes/shop.ts` 里已无 `stamina` 相关逻辑。 |
| #4 | `skillReroll.coins` 缺整数校验 | ✅ 已修。`packages/shared/src/content/schema.ts:52-56` 为 `perRarity(int.nonnegative())`。 |
| #5 | 流水缺 `skill-reroll` / `shop` 中文标签 | ✅ 已修。`ledger.ts:52`（商店兑换）、`:54`（洗技能）。 |
| #6 | 分解后 `CardDetail` 僵尸弹窗 | ✅ 已修。`AlbumPanel.tsx:611-620`、`DeckPanel.tsx` 均已把 `<CardDetail>` 提到 `renderPage` 之外，与 `cachedPages.map` 平级。 |
| #7 | 卡组「详情」按钮 Enter 误触上阵 | ✅ 已修。`DeckPanel.tsx:763` 已补 `onKeyDown={(e) => e.stopPropagation()}`。 |
| #8 | `doReroll` 刷新失败误报洗技能失败 | ✅ 已修。`CardDetail.tsx:409-439` 直接用 POST 返回值更新保底数，`fetchSkillRerollInfo` 进独立 `catch`。 |
| #9 | 批量分解并发 / 陈旧选择 | ✅ 已修。`AlbumPanel.tsx:78-102` 在切号、筛选变化时重置选择与确认；`:139`、`:151` 用 `batchBusy` 拦截。 |
| #10 | `CardDetail.run()` 缺防连点 / 未传 busy / 已上架未禁用 | ✅ 已修。`CardDetail.tsx:273` 等处入口统一 `busy !== null` 拦截，按钮 `disabled` 覆盖 `busy` 与 `listed`。 |
| #11 | 登出 / 切号未清空 `detail` | ✅ 已修。`AlbumPanel.tsx:84-92`、`DeckPanel.tsx:75-81` 用 `prevUserId` 在渲染期重置。 |
| #12 | 游客图鉴被压暗 + 旧文案 | ✅ 已修。`CodexPanel.tsx:204` 仅 `userId` 存在时才暗化，`:334-359` 的开关也只在登录时渲染。 |
| #13 | `DeckPanel` 冗余 `setReload` 等 | ✅ 已修。`setReload` 现在只服务加载失败后的「重试」按钮（`DeckPanel.tsx:310-313`），不再在每次变更后重复拉取。 |
| #14 / #15 | 在售卡被消耗吞押金 / 批量分解遇出征卡整批回滚 | ✅ 已修。同 #1：在售与出征一律拒绝，批量接口逐张跳过。 |
| #16 | 分页排序无兜底字段 | ✅ 已修。`routes/cards.ts` 三处 `orderBy` 末尾都 `push` 了 `userCards.id`，翻页稳定。 |
| #17 | 一键领取一封坏邮件卡死整批 | ✅ 已修。`mail.ts:246-271` 每封独立事务、失败进 `failed` 列表，批量上限 20。 |
| #18 | 上架检查在事务外 / 并发 500 | ✅ 已修。`market.ts:256-347` 事务内 `lockUser` 后重查归属、卡组、出征、已上架，并捕获 `23505` 转 `already_listed`。 |
| #19 | 每次访问市场都开写事务清过期 | ✅ 已修（部分）。`market.ts:48-54` 已做 60 秒内存节流；列表查询本身也用 `createdAt > cutoff` 过滤。注意购买路径仍 `force`，见 **#51**。市场列表目前要求登录（旧条目的「是否允许游客浏览」已由现状回答）。 |
| #20 | 500 带数据库原文 | ✅ 已修。`error-handler.ts:17-26` 统一脱敏，细节只写日志。 |
| #21 | `/dev/mails` 只靠 `NODE_ENV` | ✅ 已修。`routes/mails.ts:95-96` 改为显式 `ENABLE_DEV_ROUTES=1`，默认关闭。 |
| #23 | 买卖双方互买死锁 | ✅ 已修。`market.ts:443-446` 两个 userId 排序后依次 `lockUser`；取消、过期清扫、封号同样遵循「挂单 → 用户」顺序。 |
| #24 | 邮件多卡发放死锁 | ✅ 已修。`rewards.ts:54-56` 发放前按 `cardId` 排序。 |
| #25 | 任务奖励合并超邮件上限后永远失败 | ✅ 已消失。`quests.ts:33-37` 改为 `grantAttachment` 直发，不再走邮件附件。 |

### 1.2 v0.1 已记录修复、本轮未逐条复验

- **#26 镜像卡（第 6 张）演出**：v0.1 记录由 `5b41493` 完成，本轮未复验动画。
- **#27–#35 前端面板收尾**：v0.1 记录分别由 `28f6802`、`1199496`、`f3040f8` 完成。本轮抽查 `#33`（`BattlePanel` 加载失败禁用）与 `#34`（`refreshPacks` 依赖已收窄为 `[userId]`，`useDeskSession.ts:77-86`），未见回退。
- **#36 卡册筛选**：已切回服务端 `cardType` / `foil` 分页筛选。

### 1.3 本轮顺手确认（v0.1 未列）

- 出征到期结算幂等：`expedition/service.ts:810-824` 每条出征独立事务，`lockUser` + 行锁 + 状态复核，并发读不会重复发奖。
- 邮件领取、任务领奖、商店限购、教程推进都有行锁或 CAS（`mail.ts:230-243`、`quests.ts`、`shop.ts:103-116`、`progress.ts:126-145`），重复点击不会多发。
- 账号绑定二选一在事务内按 userId 排序加锁并复核双方状态（`account-binding.ts:261-301`），落选账号封存前会先放弃出征、退押金。

### 1.4 v0.2 落地修复（2026-11-28）

- **#39 ✅ 地图排序 + 章节前置**：`mapSchema` 新增 `order` / `after`（主线必须有唯一 `order`；`after` 只能指向 `order` 更小的主线图；`content:check` 会拦缺 `order`、自指、倒序）。序章 / Ch1 / Ch2 的 `order` 为 0 / 1 / 2，Ch1 `after: story-prologue`、Ch2 `after: story-ch1`。`listMaps` 按 `order` 排序并把章节锁并入 `startable` / `lockedReason`；`startExpedition` 在事务内校验前置通关，未满足返回 `409 map_locked`。按讨论采用**严格模式**：没有「已通关本章可绕过前置」的豁免（测试库可丢弃，不需要照顾老号）。`MapSelect` 本来就按 API 顺序渲染并显示 `lockedReason`，无需改动。测试：`test-feature-locks` 覆盖排序、逐章解锁、直接开图 409；`test-content-errors` 新增 6 条反向用例。
- **#40 ✅ 战斗上传失败的中途提示**：`BattleHostHooks` 新增 `syncNote`，经典 / 新版两个舞台在顶部渲染同步横幅。`ExpeditionBattle` 在队列非空且上传失败时显示「还有 N 步没传到服务器」+「重试上传」，并禁止继续出招；`out_of_sync` / `invalid_action` / `too_many_actions` / `no_battle` 统一按服务端进度自动 `resync()` 一次，`resync` 期间锁操作；服务端已经没有这场战斗时给出明确提示。结算层原有的报错/重试按钮保留。验证：`pnpm typecheck`、`pnpm lint`、`pnpm build` 通过。
- **#41 ✅ onboard 原子化**：`grantPacks` / `grantStarterPacks` 增加可选 `tx`；`/auth/onboard` 的条件 UPDATE 与发新手包放进同一个事务。发包失败会回滚 `onboarded`，用户可以重试补领。测试：`test-account-binding` 覆盖重复引导只发一次、背包与流水不变。
- **#42 ✅ Ch2 宝箱奖励表**：`content/maps/story-ch2.json` 的 `n12` 改为 `story-ch2-chest`。
- **#43 ✅ 卡组写入与市场 / 出征规则对称**：`PUT /deck` 改成在事务内 `lockUser` 后重查归属，并对 `ids` 做 `listedUserCardIds`（`card_listed`）与 `anyLocked`（`in_expedition`）校验，和上架 / 出征共用同一把用户锁；被拒时原卡组保持不变。卡牌列表接口 `/users/:userId/cards` 为本人返回 `listed` / `locked` 标记，`Prepare` 据此标出「已上架 / 出征中」并禁用，`autoPick` / `applyDeck` 也会跳过并在提示里说明原因。测试：新增 `test-deck`（保存读回、挂单拒绝、出征拒绝、越权拒绝、被拒不清空原卡组）。
- **#44 ✅ 邮箱唯一索引 23505 收口**：新增 `apps/api/src/db/errors.ts` 的 `isUniqueViolation`；`/auth/email/register` 与 `bindEmail` 捕获 `23505` 转 `409 email_taken`，不再落成 500。`db/schema.ts` 补回 `users_email_unique_idx`（`lower(email)`，部分索引），与 `migrations/0002_email_auth.sql` 对齐。测试：`test-account-binding` 新增并发注册同一邮箱，断言结果是一个 200、一个 409。
- **验证**：`pnpm typecheck`、`pnpm lint`、`pnpm content:check`（版本 `b4bdf8bba927`）、`pnpm test:fast`（10/10）、`pnpm test:db`（13/13）全部通过。

---

## 二、P1（0 项）

暂无。#40 已修复，见 §1.4。

---

## 三、P2（4 项）

### #45 【新增】出征准备页最多只加载 1800 张卡，超出部分静默丢失

- **位置**：`src/expedition/cards.ts:4-11`（`for (let page = 0; page < 30; ...)`）
- **问题**：服务端单页上限 60（`apps/api/src/routes/cards.ts:356`），30 页正好 1800。卡超过 1800 张的账号会拿到被截断的卡池，`Prepare` 的筛选、自动编队、套用卡组都会少卡且无提示。
- **影响**：「数据在但用不了」的静默错误；配合 `autoPick` 按战力取前 N，高战力卡被漏掉时更严重。
- **建议**：改成 `while (rows.length < res.total)` + 足够大的安全上限，或按 `total` 计算页数；确实截断时显示「卡太多，仅显示前 N 张」。

### #46 【新增】登录 / 注册用同步 `scryptSync`，限流按 `request.ip` 却未配 `trustProxy`

- **位置**：`apps/api/src/auth/email.ts:6-19`、`apps/api/src/auth/rate-limit.ts:9-21`、`apps/api/src/index.ts:29`
- **问题**：`scryptSync` 在请求线程里跑（约几十到上百毫秒），登录 / 注册虽按 IP 限 10 次/分、5 次/10 分，但单进程 Node 是单线程，连续请求会卡住所有用户。另外 `rate-limit.ts` 注释自己写了「反向代理后需要 trustProxy」，`index.ts` 没配：部署到 Nginx / Cloudflare 后所有请求共享代理 IP，限流退化成全局计数（正常用户被一起限死，攻击者反而不受限）。
- **建议**：改用异步 `crypto.scrypt`（或 `promisify`）并给登录加进程级并发闸；部署侧显式开启 `trustProxy`（建议用 `TRUST_PROXY` 环境变量控制），限流 key 改成「IP + 账号标识」。

### #47 【新增】`/auth/guest` 是带副作用的 GET，可被跨站触发

- **位置**：`apps/api/src/routes/auth.ts:210-231`
- **问题**：`GET` 请求会创建账号、发新手包、写 session cookie 并 302 回首页。GET 会被预取、爬虫、`<img>` / `<a>` 触发；跨站顶层导航也能接受这个 Set-Cookie，效果是把受害者「切换登录」成一个全新游客号（login CSRF / 会话覆盖），并持续产生垃圾账号。
- **影响**：玩家误点后像突然丢号（数据还在，但桌面状态全变）；无成本建号也会污染 `users` 与活跃统计。
- **建议**：改成 `POST /auth/guest`（前端按钮走 fetch），或加短期 nonce + `Origin` 校验；保留现有 IP 限流。

### #48 【新增】卡牌详情 / 账号面板的备用数据加载静默失败

- **位置**：`src/desk/panels/cards/CardDetail.tsx:145`（`fetchMe` → 精华 / 经验池 / 金币）、`:161`、`:172`（可熔卡）、`:183`（洗技能信息）；`src/desk/panels/player/AccountPanel.tsx:113`（`fetchMe`）、`:121`（`fetchPendingBind`）
- **问题**：`catch(() => {})` 吞掉失败，state 停在初始 `null`。精华、经验池、可熔卡失败时按钮变灰或显示为空，玩家无法区分「确实是 0」和「没加载出来」；`AccountPanel` 的 `me` 失败时整个面板退化成「未登录 / 空资料」，看起来像掉登录。
- **影响**：用户反复刷新或以为账号异常；这类「看起来像空数据」的错误比直接报错更难排查。
- **建议**：改成 `setLoadError(...)` + 可重试错误条（`CardDetail.tsx:194-200` 的 `fetchResonance` 已是正确范式），至少把按钮 `title` 从「数据为空」改成「读取失败，点击重试」。

---

## 四、P3（5 项）

### #49 【新增】`requireBattle` 用 `TxAbort(500)` 报「找不到这场战斗」

- **位置**：`apps/api/src/expedition/service.ts:487`
- **问题**：这是状态不一致（战斗行缺失 / 已结束），不是服务器内部错误；500 会被脱敏成「服务器出错了」，前端没有可操作信息。
- **建议**：改 `409 battle_missing`，客户端引导「返回地图重新进入」。

### #50 【新增】战斗节点插入没有处理唯一索引冲突

- **位置**：`apps/api/src/expedition/service.ts:370-377`；索引见 `apps/api/migrations/*` 的 `expedition_battles_node_idx (expedition_id, node_id)`
- **问题**：当前地图都是 DAG，正常流程不会二次进入同一战斗节点，所以暂时碰不到；以后加可回头的图、或同一请求被重试两次时，这里会抛 `23505` → 500，而不是复用已有战斗。
- **建议**：`onConflictDoNothing()` 后重查，或先查后插；与 `#49` 共用「找不到 / 已存在」的 409 分支。

### #51 【新增】每次购买都强制全表扫过期挂单，且节流时间戳先于事务落库

- **位置**：`apps/api/src/routes/market.ts:409`（`expireStaleListings(true)`）、`:51-54`（先写 `lastExpirySweepAt` 再开事务）
- **问题**：购买路径用 `force = true` 绕过 60 秒节流，每次买都全量扫描 active 挂单并逐行退押金；事务失败时时间戳已推进，后面 60 秒的列表请求都不会再清扫。
- **建议**：购买路径改用非强制清扫（事务内 `market.ts:436-438` 已有 TTL 二次校验），或把清扫挪到后台任务；`lastExpirySweepAt` 改为事务成功后再赋值。

### #52 【新增】未匹配路由 / 非法 JSON 返回 Fastify 默认结构

- **位置**：`apps/api/src/index.ts`（没有 `setNotFoundHandler`）；前端 `src/desk/session/api.ts:118`
- **问题**：404 走 Fastify 默认 `{"statusCode":404,"error":"Not Found",...}`，不是统一的 `{ok:false,error:{code,message}}`；前端只能落到「请求失败」。
- **建议**：加 `setNotFoundHandler` 回统一结构，顺带把 body 解析失败也转成 `bad_request`。

### #53 【新增】卡池缺卡时服务端非空断言、客户端静默丢卡

- **位置**：`apps/api/src/expedition/service.ts:193-196`（`row!`）、`:491-493`（`byId.get(uid)!`）；`src/expedition/ExpeditionBattle.tsx:20-26`（客户端 `flatMap` 静默丢卡）
- **问题**：服务端靠非空断言，卡池与 lineup 不一致时直接 500；客户端则静默少一张卡重放，本地局面与服务端不同步（只在内容版本变化 / 数据损坏时出现）。
- **建议**：两侧都显式校验，服务端回 `409 pool_mismatch` 并提示刷新重进，客户端缺卡时直接 `resync`。

---

## 五、故意为之 / 已排除（不是问题）

- **主线里的「空白节点」是故意的**：作用是拖长单次出征时长，并给后续「可能有的对话 / 事件」预留位置。Ch1 目前 26 个节点里 10 个 empty、Ch2 22 个里 9 个 empty，属于预期密度。**不作为问题、不改**。如果之后玩家反馈节奏拖沓，可以再讨论「连续空地自动穿过」之类的调优，但那是体验调整，不是 bug。
- **商店与洗技能不设功能门**：测试期故意放行（`content/unlocks.json` 里 `level: 1`）。
- **硬壳（护盾）低于 100 的伤害按 100 算**：按设计，不改。
- **同归于尽判定前后不一致**：回合顺序是我方先敌方后，该情形不存在，不处理。
- **`BattleStage` hooks 顺序报错**：所有 hooks 都在提前 return 之前，之前的报错是热更新残留，刷新即消失。
- **市场必须登录浏览**：v0.1 #19 留的「是否允许游客浏览」已由现状回答（`market.ts:126` 要 session）。

---

## 六、仍待主线处理（不在本轮清单）

这些是 v0.1 明确划给主线、或依赖后续引擎 / 经济定稿的事项，本轮只记状态：

- 新手包「最后一包保底」并发多触发、神秘包领本体卡不在事务里（`apps/api/src/routes/packs.ts`）。
- 挂机包改按时间累计（要改 `db/schema.ts`）。
- `maxStars` 估算不准（`packages/shared/src/expedition/content.ts`）。
- #37 法师「叠 4 层侧面支援魔法阵」引擎钩子：等「上阵 ×5 + 替补」引擎重构后补 `magic_circle` 支援类型。
- #38 剩余经济常量（`FOIL_COST`、`MARKET_MAX_PRICE`、`SHARDS_PER_DISMANTLE`、单批上限 60）待 `/api/config` 统一下发。

---

## 七、建议修复顺序

> #39 / #40 / #41 / #42 / #43 / #44 已于 2026-11-28 完成（见 1.4）。

1. 其余 P2 / P3 按迭代排（#45 卡池截断、#46 同步 scrypt + trustProxy、#47 guest GET、#48 备用数据静默失败）。
