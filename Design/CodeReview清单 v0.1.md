# Choke! Code Review 问题清单 v0.1

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
