# Choke!

把 osu! 玩家数据做成卡牌：登录、开包、收藏、组卡、打一场。

> 非盈利同人项目，与 osu! 官方无关。

## 现在能玩什么

- osu! OAuth 登录 / 游客账号
- 桌面、抽卡、卡册、卡组、背包、市场、图鉴
- 回合制 PvE 原型（AP、Combo、防御、敌方意图）
- 卡牌等级、命座、熔卡、闪卡、精华

还没完成：战斗奖励结算、任务/日常、赛季、PvP、自动化测试。

## 快速启动

### Windows

双击 `start-choke.bat`。它会读取 `.env`，启动 API 和前端，并打开浏览器。

### 手动

```bash
pnpm install
cp .env.example .env   # Windows: copy .env.example .env
pnpm dev:api           # API  → http://localhost:3100
pnpm dev               # Web  → http://localhost:5207（读 WEB_BASE_URL）
```

前端端口由 `.env` 里的 `WEB_BASE_URL` 决定，Vite 会从这个地址取端口，不再单独传 `--port`。改完 `.env` 要重启 API。

## 环境

- Node.js 22.12+
- pnpm 9+
- 一个 osu! OAuth 应用（只影响 osu! 登录，游客登录不需要）

`.env` 最少填：

```env
OSU_CLIENT_ID=74418
OSU_CLIENT_SECRET=...
SESSION_SECRET=...
WEB_BASE_URL=http://localhost:5207
```

osu! 应用的 Callback URL 必须是：

```text
http://localhost:3100/auth/osu/callback
```

如果 osu! 登录打不开，先用登录入口旁的「游客账户」确认前端和 API 是否正常。

## 卡池数据

仓库只带 7 张示例卡。全量卡池不进 git：

```text
apps/api/data/choke-cards.json   # 约 90 MB
```

导入（**先停 API**，PGlite 单进程）：

```bash
pnpm import:sample   # 7 张示例卡
pnpm import:cards    # 全量卡池
```

## 数据库

默认使用便携版 PostgreSQL 16（端口 **55432**，数据目录 E:\pgdata）。

`powershell
./scripts/postgres.ps1 start    # 启动
./scripts/postgres.ps1 status   # 查看
./scripts/postgres.ps1 stop     # 停止
`

连接串写在 .env 的 DATABASE_URL。不设置它时会回落到 PGlite（单进程嵌入式，进程被强杀可能写坏，不推荐日常使用）。



数据在 `apps/api/.data/pg`。PGlite 是单进程单连接，不要同时开两个 API 或一边跑 API 一边导入。

卡牌实例新增永久序号 `serial`，卡定义的 `pulled` 记录累计发行数；熔卡不回收序号，交易保留原号。发号和实例创建在同一事务中完成。

API 启动会自动补列和旧卡序号：已有号码不变，未编号实例按实例 ID 顺序从现有最大号／累计发行数之后续号。重复启动不重新编号。旧版已删除的实例历史无法还原；`import --replace` 会清掉卡定义和计数，重启后只能从仍存实例恢复发行数下界，不能把它当作完整历史恢复工具。

如果启动报 `invalid checkpoint` / `PANIC: could not locate a valid checkpoint record`，说明数据库在关机时被写坏了。直接删掉数据目录再导入即可（源卡池文件还在）：

```bash
rm -rf apps/api/.data/pg     # Windows: Remove-Item -Recurse -Force apps/api/.data/pg
pnpm import:cards
```

## 目录

```text
src/                前端（Vite root）
  desk/             桌面、卡册、卡组、背包、抽卡、市场、账号
  battle/           回合制 PvE 原型
  card/             卡面、卡牌定义、养成
  pool/             卡池构建与实验室
apps/api/           Fastify API + PGlite
  src/routes/       auth / cards / packs / decks / market / progression
  samples/          7 张示例卡
  data/             全量卡池（gitignore）
scripts/            同步排行榜、构建卡池、启动脚本
Design/             设计文档（部分早于当前实现，以代码为准）
```

## 常用命令

```bash
pnpm dev:api         # API
pnpm dev             # 前端
pnpm build           # 前端构建
pnpm typecheck       # 前端类型检查
pnpm import:cards    # 导入全量卡池
pnpm sync:rankings   # 同步排行榜
pnpm build:cards     # 由 rankings 生成 choke-cards.json
```

## 文档

- `Design/前后端需求清单 v0.1.md`：功能范围和里程碑
- `Design/经济与养成系统 v0.2.md`：经济、养成、卡包
- `Design/卡牌数值与战斗机制 v0.1.md`：回合制战斗
- `Design/职业与技能总表 v0.1.md`：14 子职业与全部技能（代码实装快照）
- `Design/M1-验收清单.md`：早期验收记录

PR #3 的实时边线战斗在独立 worktree 试验，不在 `master`。
