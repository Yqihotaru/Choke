# Card faces

每个 `*.tsx` 导出：

- `faceMeta`：`{ id, label, note?, order? }`
- `default`：卡面组件，接收 `{ card, mode?, className? }`

`index.ts` 用 `import.meta.glob("./*.tsx", { eager: true })` 自动扫描。
新增一个版本：把 tsx 和 css 丢进这个文件夹，组件里 import 自己的 css，类名用自己的前缀（current 用 `cf`，星章版用 `cfv1`，Paper & Prism 用 `cfg`，黑胶腰封用 `cfo`）。

不用改 CardLab / CardEditor，也不用重新登记。
