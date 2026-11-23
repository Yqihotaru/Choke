# tools/

开发辅助，不进正式版打包。

## 音效素材库

挑音效素材用的本机素材库，在 `tools/sfx-library/`（已加入 `.gitignore`，不进仓库）。

```
node tools/fetch-sfx-packs.mjs vcsl     # Versilian Community Sample Library（CC0）里挑出的乐器与打击乐
node tools/fetch-sfx-packs.mjs kenney   # Kenney 的 8 个音频包（页面标注 CC0）
node tools/fetch-sfx-packs.mjs oga      # OpenGameArt 上逐页核对为 CC0 的几个包
```

- 每个素材包一个目录，带 `pack.json`（来源网址、作者、授权、核对日期、是否要求署名）。
- OpenGameArt 的包由脚本逐页检查许可图标，只收**仅标 CC0** 的页面；多重许可或 CC-BY 的一律跳过。
- 解 `.7z` 需要环境变量 `SEVENZIP` 指向 `7z.exe` / `7za.exe`。
- 浏览与挑选：`pnpm dev` 后打开 `/sfx-lab`，切到“素材库”页签。素材由 `tools/sfx-library-plugin.ts`（仅 vite 开发服务器）提供。
- 选定后“复制候选清单”，交给我转码入 `public/sfx/`，同时更新 `public/sfx/CREDITS.md` 与关于页的 `SOUND_CREDITS`。**没经过这一步的素材不会出现在游戏里。**
