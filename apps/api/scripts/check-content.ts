// pnpm content:check —— 不连数据库，单独校验 content/：schema、交叉引用、没接入的文件。
// 校验失败时 import 就会抛错，进程以非 0 退出。
import { CONTENT } from "@choke/shared/content"

import { BATTLE_CONTENT, CONTENT_VERSION, QUEST_CONTENT, WORLD_CONTENT } from "../src/content"

console.log(`content/ 校验通过 · 版本 ${CONTENT_VERSION}`)
console.log(
  [
    `物品 ${Object.keys(CONTENT.items).length}`,
    `卡包 ${Object.keys(CONTENT.packs.packs).length}`,
    `商店 ${Object.keys(CONTENT.shop).length}`,
    `敌人 ${Object.keys(BATTLE_CONTENT.enemies).length}`,
    `敌方支援 ${Object.keys(BATTLE_CONTENT.supports).length}`,
    `遭遇 ${Object.keys(BATTLE_CONTENT.encounters).length}`,
    `地图 ${Object.keys(WORLD_CONTENT.maps).length}`,
    `掉落表 ${Object.keys(WORLD_CONTENT.rewards).length}`,
    `剧情 ${Object.keys(WORLD_CONTENT.stories).length}`,
    `事件 ${Object.keys(WORLD_CONTENT.events).length}`,
    `任务 ${Object.keys(QUEST_CONTENT.quests).length}`,
  ].join(" · "),
)
