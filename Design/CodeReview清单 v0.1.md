# Choke! Code Review 问题清单 v0.1

> 2026-11-27 更新：第一至二节为 11-26 的原清单；第三至五节并入 11-27 的全量复查新发现（后端路由、前端面板、远征与战斗各一轮）。编号延续。**商店和洗技能不设功能门是故意的（测试期不锁），不算问题。**
> **已修复**：第一批后端清雷（`#1–#5、#14–#15、#17–#25`，提交 `786d5cf`）✅；第二批前端面板（`#6–#13、#26–#29、#31–#35`，提交 `f48f146`，仅 `#30` same-key 需浏览器实测确认）✅。

> 整理时间：2026-11-26
> 审查范围：近期落地的碎片突破、逢 5 自选洗技能、统一商店、批量分解、卡册/卡组/图鉴/卡牌详情页改造，以及战斗层破盾与去硬编码。
> 审查结论：**战斗层（`battle/config.ts`、`battle/engine.ts`）与 `packages/shared/src/progression.ts` 纯函数零问题通过**；以下为待修的 3 个 P0、6 个 P1、4 个 P2 实锤问题（已排除确认故意放行的「商店解锁校验」）。

---

## 一、后端与共享层（`apps/api/`、`packages/shared/`）

### P0 · 严重（并发刷资源 / 数据不一致）

1. **`removeUserCard` 返回值未校验 + 误改历史挂单 + 未拦截在售卡**
   - **位置**：`apps/api/src/routes/progression.ts`（`removeUserCard` L76–91、批量分解 L890、喂养 L595、命座 L391、回收 L1020）；`apps/api/src/routes/market.ts`（`market/buy` L417–481）
   - **问题**：
     - `removeUserCard` 删除 0 行时仅返回 `false`，但批量分解/喂养/回收未校验返回值，且 `market/buy` 未锁 `listing.sellerId`，极端并发下可能出现“卡已被买走，卖家依然拿到分解/回收产物”的刷资源漏洞。
     - `removeUserCard` 内 `UPDATE market_listings SET status = 'cancelled' WHERE user_card_id = ...` 漏了 `eq(marketListings.status, "active")`，会误改历史已成交/过期单，且取消在售单时未退押金。
   - **建议修法**：在 `removeUserCard` 中先拦截 `status = 'active'` 的在售挂单（与 `reroll-skill` 一致），删除 0 行直接抛 `TxAbort(409, "conflict", ...)`；在 `market/buy` 里同时对 `listing.sellerId` 加锁。

2. **`POST /reroll-skill` 更新 `user_cards` 未检查 `.returning()`**
   - **位置**：`apps/api/src/routes/progression.ts` L1197–1200
   - **问题**：扣完金币与碎片后执行 `UPDATE user_cards SET skill_refs = ..., skill_reroll_count = ...` 但未检查 `.returning()`；极端并发下若卡被转走，会白扣金币和碎片并返回 `card: null`。
   - **建议修法**：加 `.returning({ id: userCards.id })`，为空时抛 `TxAbort(409, "conflict", ...)` 回滚事务。

### P1 · 高优（多买空扣）

3. **商店一次买多瓶体力药接近 720 上限时，可能空扣金币**
   - **位置**：`apps/api/src/routes/shop.ts` L149–154
   - **问题**：当前只判断 `settledStamina.value >= STAMINA_OVERFLOW_MAX`；当体力为 `710/720` 且一次买 `count: 2` 时，第 2 瓶回 0 体力却仍扣 100 金币。
   - **建议修法**：改为校验 `settledStamina.value + (qty - 1) * staminaPerUnit >= STAMINA_OVERFLOW_MAX` 时拦截。

### P2 · 中等（校验与文案）

4. **`skillReroll.coins` schema 漏了整数校验**
   - **位置**：`packages/shared/src/content/schema.ts` L58
   - **问题**：用了 `perRarity(nonNegative)` 而非 `perRarity(int.nonnegative())`，若配小数会过校验但在 PostgreSQL `integer` 列运行时报错。
   - **建议修法**：改为 `perRarity(int.nonnegative())`。

5. **流水账本缺少 `"skill-reroll"` 与 `"shop"` 的中文来源标签**
   - **位置**：`apps/api/src/ledger.ts` L33–60
   - **建议修法**：在 `SOURCE_LABELS` 补齐 `"skill-reroll": "洗技能"`、`"shop": "商店兑换"`。

---

## 二、前端卡片面板（`src/desk/panels/cards/`、`src/desk/session/api.ts`）

### P0 · 严重（僵尸弹窗）

6. **分解分页最后一张卡后，`CardDetail` 变成永不关闭的“僵尸弹窗”**
   - **位置**：`AlbumPanel.tsx` L128–131 & L420–428、`DeckPanel.tsx` L152–155 & L738–749、`CardDetail.tsx` L138–142 & L362–364
   - **问题**：`<CardDetail>` 挂在 `renderPage` 内部。在第 2 页及以后分解该页唯一一张卡时，`book.invalidate()` 导致页码钳制回退 1 页，卸载旧页（清掉 1100ms 自动关闭定时器）并在新页重新挂载一个带已删卡的 `CardDetail`，不断触发 404 且永不自动关闭。
   - **建议修法**：将 `<CardDetail>` 提到 `AlbumPanel` / `DeckPanel` / `CodexPanel` 顶层渲染（与 `cachedPages.map(...)` 平级）。

### P1 · 高优（交互 / 竞态 / 状态陈旧）

7. **卡组右页候选卡「详情」按钮按 Enter/Space 会误触上阵**
   - **位置**：`src/desk/panels/cards/DeckPanel.tsx` L690–713
   - **问题**：`.deck-pick__detail` 拦截了 `onClick` 与 `onPointerDown`，但漏了 `onKeyDown={(e) => e.stopPropagation()}`，键盘用户聚焦该按钮按 Enter 会冒泡到外层触发 `assign()`。

8. **`CardDetail` 的 `doReroll` 刷新失败会误报洗技能失败**
   - **位置**：`src/desk/panels/cards/CardDetail.tsx` L307–332
   - **问题**：`POST /reroll-skill` 成功后，在同一 `try` 块里 `await fetchSkillRerollInfo`，一旦 GET 失败会跳进 `catch` 把成功提示覆写成「洗技能失败」且保底数陈旧。
   - **建议修法**：直接用 POST 返回的 `skillRerollCount / pityInterval / selectReady` 更新状态，把 `fetchSkillRerollInfo` 隔进独立 `try/catch` 并加卸载中止守卫。

9. **卡册批量分解态的并发与陈旧选择**
   - **位置**：`src/desk/panels/cards/AlbumPanel.tsx` L68–77, L190–217, L301–316
   - **问题**：`batchBusy` 请求中未拦截勾选/退出按钮；切换筛选/排序/页码或 `book.revision` 变更时未重置 `batchConfirm` 与清理可能已在别处消失的 `selectedIds`。

10. **`CardDetail` 的 `run()` 缺 `busy` 防连点，`<ConfirmBar>` 漏传 `busy`，且已上架卡未禁用变更操作**
    - **位置**：`src/desk/panels/cards/CardDetail.tsx` L219–227, L398, L599–816
    - **建议修法**：`run()` 开头加 `if (busy !== null) return`（或 ref 锁），所有 `<ConfirmBar>` 传入 `busy={busy !== null}`，`listed === true` 时禁用分解/洗技能。

11. **登出或切换账号未清空 `detail` 与批量分解状态**
    - **位置**：`AlbumPanel.tsx` L59–64、`DeckPanel.tsx` L75
    - **建议修法**：监听 `userId` 变化时重置 `detail` 与 `AlbumPanel` 的批量状态。

### P2 · 中等（体验与类型同步）

12. **`CodexPanel` 未登录游客全图鉴被压暗 42% + 旧 tooltip 文案**
    - **位置**：`src/desk/panels/cards/CodexPanel.tsx` L99, L171, L204, L351–359
    - **建议修法**：仅在 `Boolean(userId)` 时启用未见暗化与显示「暗化未见」开关，并把 `title` 改为“未收集的卡以半透明暗化显示”。

13. **`DeckPanel` 冗余 `setReload` + 批量分解提示遗漏经验乐谱 + `api.ts` 返回类型补全**
    - **位置**：`DeckPanel.tsx` L744–747（`fetchDeck` 已监听 `book.revision`，无需再调 `setReload`）；`AlbumPanel.tsx` L204–209（批量分解提示可顺带显示返还的经验乐谱）；`src/desk/session/api.ts` L181–212（补齐后端已返回的 `coins / coinsSpent / shardsSpent / blockedCost / blockedShards` 字段）。

---

## 三、2026-11-27 新增：后端（`apps/api/`）

> 标注「已读确认」的是人工读代码核实过，「待复核」的是子代理审查结果，动手前先看一眼代码再改。

### P0 / P1

14. **在售的卡被消耗时押金被吞**（已读确认，并入第 1 条一起修）
    - **位置**：`progression.ts` 的 `removeUserCard`（L76–91）；喂养、融合、分解、批量分解、NPC 回收都会走到。
    - **问题**：挂单被改成 `cancelled`，押金不退，`expireStaleListings` 又只退 `active` 单，押金永远收不回。
    - **修法**：与 `reroll-skill` 一致，**在售的卡直接拒绝**（`card_listed`）。这样不用退押金，也不会误改历史单。
15. **批量分解遇到出征中的卡，整批（最多 60 张）回滚；也不检查在售**（已读确认）
    - **位置**：`progression.ts` 约 L890。
    - **修法**：出征中、在售的卡跳过，在返回里列出 `skipped` 和原因，其余照常分解。
16. **分页排序没有兜底字段，翻页会重复或漏卡**（疑似前端 key 重复警告的来源）
    - **位置**：`cards.ts` 三处 `orderBy`。**已由主线修好，不用再动**，只需在浏览器里确认警告是否消失（见第 30 条）。
17. **邮件一键领取，一封坏邮件让整批永远领不了**（待复核）
    - **位置**：`mail.ts` 约 L247–270。按 id 升序取前 100 封，坏邮件总在最前。
    - **修法**：每封用嵌套事务单独领，失败的跳过并返回失败列表；批量上限降到 20 封左右。
18. **上架没加锁，检查都在事务外**（待复核）
    - **位置**：`market.ts` 约 L245–292（检查）、L309–351（事务）。
    - **问题**：并发上架返回 500 而不是 `already_listed`；上架与分解同时发生可能留下指向已删卡的挂单；上架与出征同时发生，同一张卡可能既在售又在出征。
    - **修法**：事务开头 `lockUser`，在事务里重新查归属、卡组、出征、已上架；捕获唯一索引冲突转成 `TxAbort(400, "already_listed")`。
19. **`market/listings` 每次访问都开写事务做过期清理**（待复核）
    - **位置**：`market.ts` 约 L48–73、L119。
    - **修法**：内存里做 1 分钟节流，或放到定时任务。是否允许未登录浏览市场，请先问用户，不要擅自加登录门。

### P2

20. **500 错误把数据库原文带给客户端，格式也不统一**（待复核）：`error-handler.ts` L5–17，非业务错误统一回 `{ok:false,error:{code:"internal",message:"服务器出错了"}}`，细节只写日志。
21. **`/dev/mails` 只靠 `NODE_ENV` 控制**（待复核）：`routes/mails.ts` L97–105，改成显式开关（如 `ENABLE_DEV_ROUTES=1`），默认关。
22. **体力药水在体力 661～719 时只加到 720 仍扣满 100 金币**（已读确认，与第 3 条同类）：按实际能加的瓶数算，或不足一瓶时拒绝。
23. **买家和卖家互买可能死锁**（待复核）：`market.ts` 约 L447–481，两个 userId 排序后再依次 `lockUser`。
24. **邮件附件里多种卡的发放可能死锁**（待复核）：`gacha/open.ts` L83–88 的 `grantCard` 更新 `cards.pulled`，发放前先按卡 id 排序。
25. **任务过期补发邮件合并后可能超过邮件校验上限**（待复核）：`quests.ts` 约 L430–441，金币超 1,000,000 或物品超 20 种时每次读任务都重试且永远失败。

### 主线自己处理，不在这份任务里

- 新手包"最后一包保底"并发多触发、神秘包领本体卡不在事务里（都在 `packs.ts`，和挂机包改造同一文件）。
- 挂机包改按时间累计（要改 `db/schema.ts`）。
- `maxStars` 估算不准（`packages/shared/src/expedition/content.ts`）。
- 战斗快速连点"结束回合"动画错乱（`src/battle`）。

---

## 四、2026-11-27 新增：前端（`src/desk/`）

### P1

26. **镜像卡（第 6 张）前端没演出**（待复核）
    - **位置**：后端 `gacha/open.ts` L179–197、L224–228 返回 `bonus`；前端 `src/desk/session/api.ts` L554–564 的 `OpenPackResult` 没有这个字段，`DeskPage.tsx` 约 L1299、L1416 和 `GachaPanel.tsx` 约 L204 只处理 `results`。
    - **修法**：演完 5 张后，用同一套 `resolvePulledCards` 再演第 6 张；至少先用提示告知"额外获得 xxx"。
27. **切号后背包、市场先显示上个账号的数据**：**已确认无需处理**（`DeskBook.tsx` 已给 `BackpackPanel` / `MarketPanel` 加 `key={userId ?? "guest"}`，`MarketPanel` 的 `fetchMe` 已有 `.catch(() => {})`，`unlist` 的 `finally` 已有 `reload()`）。
28. **道具名查表没有兜底，遇到新道具白屏**：**已确认无需处理**（全量 `src/` 5 处 `ITEMS[...]` 均已有 `?.name ?? itemId` 兜底）。
29. **多处 `.catch(() => {})` 吞错，界面无提示**：**已修**（`MailBox` 已有已读回滚与提示，`BattlePanel` 已有失败提示，`AccountPanel` 补齐 `fetchQuests` 失败提示，`28f6802`）。
30. **找出"Encountered two children with the same key"的来源**：key 值出现过 1、2、4、40 到 46。先确认第 16 条修复后是否还有；若有，在浏览器控制台复制完整组件栈，从 `DeskDrawer.tsx` L184、`DeskBook.tsx` L496、`PackOpener.tsx` 的 `keyOf` 查起。（*2026-11-27 浏览器实测：已连接 `127.0.0.1:9222` 遍历桌面、`厚书`全部页签（含图鉴翻页）、邮箱、流水与抽屉，控制台均未再出现 `Encountered two children with the same key` 警告。注：未包含抽卡开包后 `PackOpener` 动画过程，若开包时仍复现可再看 `PackOpener.tsx` 的 `keyOf`。*）

### P2

31. **前端几乎没按 `error.code` 分支**：**已修**（`BattlePanel`、`CardDetail`、`MarketPanel` 补齐 `feature_locked`、`in_expedition`、`already_listed`、`in_deck`、`price_out_of_band`、`not_enough_coins`、`not_enough_stamina`、`not_enough_exp`、`already_foil` 分支并刷新状态，`1199496`、`f3040f8`）。
32. **市场下架按钮在交易未解锁时仍可点**：**已确认无需处理**（核对 `apps/api/src/routes/market.ts` L363：`DELETE /users/:userId/market/listings/:listingId` 不受 `requireFeature` 锁限制，未解锁交易也允许下架自己的挂单）。
33. **`BattlePanel` 副本状态拉取失败时按钮仍可点**：**已修**（`DeskBook` 已有 `key={userId ?? "guest"}` 切号清状态，`BattlePanel` 新增 `dungeonLoadError` 提示与「重试」按钮，拉取失败或未就绪时禁用扫荡按钮，`1199496`）。
34. **`useDeskSession` 的 `refreshPacks` 依赖整个 `user` 对象，会重复拉库存**：**已确认无需处理**（`useDeskSession.ts` L76–86 已收窄为 `[userId]`）。
35. **`api.ts` 的 `fetchMails`、`fetchMailSummary`、`fetchLedger` 不接 `signal`；`fetchProgress` 吞掉所有错误返回 `null`**：**已修**（`fetchMails`/`fetchMailSummary`/`fetchLedger` 已接 `signal`；已移除 `fetchProgress` 内的 `.catch(() => null)` 并在 `tutorial/store.ts` 显式接住，`28f6802`）。

### 新发现（要主线配合）

36. **卡册后端筛选接口条件偏少**（2026-11-27 记）：`GET /users/:userId/cards` 目前仅支持 `rarity`、`q`、`sort`。前端已在卡册子界面补上「全部/普通卡/镜像卡/本体卡」与「仅闪卡」筛选（持卡多时前端翻页扫描），后续建议主线在 `GET /users/:userId/cards` 补充 `cardType`、`foil`、`job` 等服务端筛选参数。
37. **法师「叠 4 层侧面支援魔法阵」引擎钩子**（2026-11-27 记）：第四批已在 `skills.ts` 为法师先接入基于现有 `aura` 支援的 `mage_resonance_circle`（共鸣法阵）与 `mage_arcane_circle`（秘术增幅阵）。待主线完成「上阵 ×5 + 替补」战斗引擎重构后，可在 `packages/shared/src/battle/` 补充 `magic_circle` 支援类型（每次魔法伤害叠 1 层、最多 4 层）再升级这两个法阵技能。
38. **部分经济常量尚未由 `/api/config` 下发**（2026-11-27 记）：已清掉 `BattlePanel`（体力药水/溢出上限）、`AlbumPanel`（NPC 日回收上限）、`BackpackPanel`（新手包文案“30 包”）里的写死默认值；但 `CardDetail` 里的 `FOIL_COST`（镀闪精华）、`MARKET_MAX_PRICE`（市场最高价）以及 `AlbumPanel` 批量分解预估里的 `SHARDS_PER_DISMANTLE` 与单批上限 `60` 目前服务端 `/api/config` 尚未返回，待主线经济演算定稿后由 `/api/config` 统一下发，前端即可直接切换。
    - 主线结论（审查）：前端翻页扫描最多读 10 页×60=600 张，`CardDetail` 里找镜像卡最多读 5 页=300 张，超出的卡会被**静默漏掉**，持卡多的玩家会看到不全。服务端已补 `cardType`（`pool`/`hero`/`mirror`）和 `foil`（`true`/`false`）两个可选参数；前端要改成走服务端筛选，删掉翻页扫描（见第四批任务书第 4 条）。`job` 暂不加，有需要再说。
    - 另：任务书要求的镜像卡"独立收集率"还没做（现在只是筛选按钮）。

---

## 五、复查后已排除的疑点

- `BattleStage` 的 hooks 顺序报错：所有 hooks 都在提前 return 之前，现在的文件没有 `useMemo`，那是热更新残留，刷新即消失。
- 远征服务端：跳格、重复领宝箱、重复结算、放弃后继续操作、并发、地图生成死循环，均未发现问题。
- 战斗"同归于尽"判定前后不一：回合顺序是我方先敌方后，该情形不存在，不处理。
- 硬壳低于 100 的伤害按 100 算：按设计，不改。
- 商店与洗技能没有功能门：故意放行。


---

## 六、2026-11-27 第二批任务完成记录

- 补充 1（技能覆盖矩阵）：`d3ff6f9`
- 1. 洗技能 `error.code` 分支：`afd54e2`
- 2. NPC 批量回收：`084591a`
- 3. 体力药水：`28db4fa`
- 4. 任务宝箱：`b744101`
- 5. osu! 每日推荐谱面：`d2f6759`
- 6. 本体卡共鸣只读展示：`1f5e1bb`
- 7. 本体卡命座选镜像卡入口：`5a8a813`

---

## 七、2026-11-27 第三批任务完成记录

- 1. 清前端遗留 CR（`#27～#35`）：`28f6802`（`#29`/`#35`）、`1199496`（`#33`/`#31`）、`f3040f8`（`#31`），`#27`/`#28`/`#32`/`#34` 已确认无需处理
- 2. 开包第 6 张镜像卡玻璃碎裂演出（`#26`）：`5b41493`
- 3. 镜像卡外边框与 L+ 外发光特效、卡册精准筛选、市场镜像筛选/标记：本次提交（见 git log）


---

## 八、2026-11-27 第四批任务完成记录

- 1. 技能池加深（新增 56 个技能，总池 214 → 270 + `职业与技能总表` 更新）：`3f3ed3d`
- 2. 清掉前端写死经济数字 + 3. 重写 `README.md` + 补充清单 `#37` / `#38`：见本批收尾提交
