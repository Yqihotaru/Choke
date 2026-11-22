// pnpm content:check —— 不连数据库，单独校验 content/：schema、交叉引用、没接入的文件。
// 校验失败时 import 就会抛错，进程以非 0 退出。
import { CONTENT } from "@choke/shared/content"

import { CONTENT_VERSION } from "../src/content"

console.log(`content/ 校验通过 · 版本 ${CONTENT_VERSION}`)
console.log(
  [
    `物品 ${Object.keys(CONTENT.items).length}`,
    `副本 ${Object.keys(CONTENT.dungeons).length}`,
    `卡包 ${Object.keys(CONTENT.packs.packs).length}`,
  ].join(" · "),
)
