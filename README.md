# Choke!

osu! 战队养成 + 轻 JRPG 远征（非盈利同人项目，与 osu! 官方无关）。

## 目录结构

```text
src/               前端（React + Vite：桌面、卡册、卡组、抽卡、市场、任务、战斗、远征）
apps/api/          后端（Fastify + Drizzle + PostgreSQL）
packages/shared/   前后端共享纯逻辑（战斗规则、技能表、养成、经济、远征、任务）
content/           静态游戏内容（关卡、敌人、副本、卡包、任务、解锁规则 JSON）
Design/            设计文档、数值报告、Code Review 与任务书
```

## 环境与启动

- Node.js 22.12+
- pnpm 9+
- PostgreSQL 16（Windows 可用仓库自带便携脚本：`./scripts/postgres.ps1 start|status|stop`，默认端口 `55432`）

### 启动命令

```bash
pnpm install
cp .env.example .env   # Windows: copy .env.example .env
pnpm dev:api           # 启动 API（默认 http://localhost:3100）
pnpm dev               # 启动前端（端口读 .env 的 WEB_BASE_URL，默认 http://localhost:5207）
```

Windows 也可直接双击 `start-choke.bat` 一键启动。osu! OAuth 回调地址需配置为 `http://localhost:3100/auth/osu/callback`；本地未配置 OAuth 时可使用「游客账户」或邮箱登录。

## 卡池数据导入

仓库仅附带 7 张示例卡，全量卡池（`apps/api/data/choke-cards.json`）不进 git。导入前建议先停 API：

```bash
pnpm import:sample     # 导入 7 张示例卡
pnpm import:cards      # 导入全量卡池（--replace）
```

## 测试与校验命令

```bash
pnpm typecheck         # 前端 + packages/shared + 后端 TS 类型检查
pnpm lint              # ESLint 全量检查
pnpm test              # 运行全部 23 项后端与共享规则测试
pnpm test:fast         # 跳过 DB 集成测试，仅跑纯逻辑单测
pnpm content:check     # 校验 content/*.json 结构与引用完整性
pnpm docs:skills       # 根据 packages/shared/src/skills.ts 重新生成职业与技能总表
pnpm docs:check        # 检查技能总表文档是否与数据同步
```
