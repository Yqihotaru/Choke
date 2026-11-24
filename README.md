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

导入（建议先停 API，避免导入过程中请求读到半成品）：

```bash
pnpm import:sample   # 7 张示例卡
pnpm import:cards    # 全量卡池
```

## 数据库

默认使用便携版 PostgreSQL 16（端口 **55432**，数据目录 E:\pgdata）。

```powershell
./scripts/postgres.ps1 start    # 启动
./scripts/postgres.ps1 status   # 查看
./scripts/postgres.ps1 stop     # 停止
```

连接串写在 .env 的 `DATABASE_URL`，API 只支持 PostgreSQL，没配置会直接拒绝启动。

服务端测试脚本（`pnpm test:*`）会自己起一个临时 PGlite 数据目录（`PG_DATA_DIR`），不碰开发库；PGlite 只是 devDependency，生产安装不会带上。

PGlite 和真 PostgreSQL 有细微差别（例如 Date 参数在 postgres-js 上会报错，PGlite 不会）。大改动后、合并或上线前，跑 `pnpm test:pg`：把需要数据库的测试在真 PostgreSQL 上再跑一遍。（日常：`pnpm test:fast` 约 4 秒，`pnpm test` 全部并行约 13 秒；测试清单自动发现，详见 `Design/测试说明 v0.1.md`。）它读 `.env` 里的 `DATABASE_URL` 作为服务器，每个测试现建、跑完删掉一个 `choke_test_*` 临时库，不碰开发库里的数据。

卡牌实例新增永久序号 `serial`，卡定义的 `pulled` 记录累计发行数；熔卡不回收序号，交易保留原号。发号和实例创建在同一事务中完成。

API 启动会自动补列和旧卡序号：已有号码不变，未编号实例按实例 ID 顺序从现有最大号／累计发行数之后续号。重复启动不重新编号。旧版已删除的实例历史无法还原；`import --replace` 会清掉卡定义和计数，重启后只能从仍存实例恢复发行数下界，不能把它当作完整历史恢复工具。

## 目录

```text
src/                前端（Vite root）
  desk/             桌面
    shell/          翻页书本、抽屉、拖拽
    panels/         书页面板（cards / shop / player / mail / battle / invite）
    session/        请求、状态、轮询
    lib/            桌面纯工具
    login/          登录页
    opening/        开包动画
  battle/           回合制 PvE 原型
  card/             卡面、卡牌定义、养成
  pool/             卡池构建与实验室
apps/api/           Fastify API + PostgreSQL
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

- `Design/备忘录.md`：所有"以后再做""等别人""还没定"的事
- `Design/经济与养成系统 v0.3.md`：经济、养成、卡包
- `Design/卡牌数值与战斗机制 v0.1.md`：回合制战斗
- `Design/职业与技能总表 v0.1.md`：4 大职业与全部技能（代码实装快照）
- `Design/技能定义指南 v0.1.md`：怎么写技能
- `Design/战斗内容编写指南 v0.1.md`：怎么写敌人、遭遇、地图
- `Design/内容层结构 v0.1.md`：`content/` 目录和各 JSON 的格式
- `Design/测试说明 v0.1.md`：测试怎么跑
- `Design/任务前端对接清单 v0.1.md`、`出征前端对接清单 v0.1.md`、`养成与经济前端对接清单 v0.1.md`：给前端的接口说明
- `Design/M1-验收清单.md`、`架构重整 v0.1.md`：历史记录

PR #3 的实时边线战斗在独立 worktree 试验，不在 `master`。
