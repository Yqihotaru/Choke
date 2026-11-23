# Card faces

每个 `*.tsx` 导出：

- `faceMeta`：`{ id, label, note?, order?, supportsTheme?, supportsModPlacement? }`
- `default`：卡面组件，接收 `{ card, mode?, theme?, modPlacement?, className? }`；支持的战斗态不能忽略 `mode`。

`index.ts` 用 `import.meta.glob("./*.tsx", { eager: true })` 自动扫描。
新增一个版本：把 tsx 和 css 丢进这个文件夹，组件里 import 自己的 css，类名用自己的前缀（current 用 `cfcur`，星章版用 `cfv1`，Paper & Prism 用 `cfg`，黑胶腰封用 `cfo`，肖像版用 `cf`，B 共用渲染器用 `cfb`）。直接复用已有渲染器的版本只需注册组件，无须复制 TSX 和 CSS。

游戏里的卡面（卡册、图鉴、卡组、桌面、开包、背包、详情、市场、战斗、账号、卡池实验室）统一走 `../GameCardFace.tsx`，当前是 B v2 · 大元素、暗色、MOD 在名字后。换游戏卡面改那个文件，同时把 `faceMeta.inGame: true` 挪到对应版本：实验室和编辑器靠它把游戏卡面排第一、默认选中，其余归入「历史版本」（实验室里默认折叠）。
卡面根节点要带通用类 `card-face`：外部容器样式、拖拽、受光（`light.ts`）都认这个类。闪卡膜用共用的 `../CardFoil.tsx`（`card-foil`），放在根节点最后。

不用改 CardLab / CardEditor，也不用重新登记。

新增独立实验版本：`portrait`（肖像渲染器，与上游 `cfcur` 样式隔离）、`b-v1`（放大前，星 4.6cqw、名字 1.05 倍）、`b-v2`（大元素，星 6.2cqw）。B 的明暗主题使用 `theme="dark" | "light"`，MOD 位置使用 `modPlacement="spine" | "portrait" | "name"`，共用渲染器在 `../CardFaceB.tsx`，不会被自动扫描成第四个版本。

实验室分享链接使用 `?style=portrait` 或 `?style=b-v1&theme=light&mods=portrait` / `?style=b-v2&theme=dark&mods=name`。支持现有的 `solo`、`embed`、`foil` 和 `mode=battle` 参数；切换卡面、主题、MOD 会同步 URL，刷新保留选择。编辑器通过同一个 registry 自动列出所有版本。

肖像版 Mythic 使用宝石红烫印与珠光，而不是旧版铂色。
