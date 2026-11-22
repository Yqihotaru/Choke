// pnpm test:content —— 把 content/ 复制到临时目录，逐项改坏，确认加载时每一项都被拦下、且报错说得清原因。
// 只动副本，不碰真实的 content/。新增一类校验时在 CASES 里加一条。
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { CONTENT_DIR, loadContentDir } from "../src/content"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

interface Case {
  name: string
  /** 在副本目录 root 上做破坏 */
  breakIt: (root: string) => void
  /** 报错信息里必须出现的文字 */
  expect: string
}

function editJson(rel: string, fn: (data: Json) => void) {
  return (root: string) => {
    const file = path.join(root, rel)
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as Json
    fn(data)
    fs.writeFileSync(file, JSON.stringify(data, null, 2))
  }
}

const CASES: Case[] = [
  // ---- 交叉引用 ----
  { name: "遭遇引用不存在的敌人", breakIt: editJson("encounters/ghost.json", (d) => (d.enemy = "nobody")), expect: "敌人 nobody 不存在" },
  { name: "遭遇引用不存在的支援", breakIt: editJson("encounters/vanguard.json", (d) => d.supports.push("nope")), expect: "敌方支援 nope 不存在" },
  { name: "遭遇里支援重复", breakIt: editJson("encounters/vanguard.json", (d) => d.supports.push(d.supports[0])), expect: "重复" },
  { name: "脚本引用不存在的招式", breakIt: editJson("enemies/ghost.json", (d) => d.ai.script.push({ always: "nope" })), expect: "招式 nope 不存在" },
  {
    name: "条件引用不存在的支援",
    breakIt: editJson("enemies/conductor.json", (d) => (d.ai.script[0].when.supportStacks.support = "x")),
    expect: "敌方支援 x 不存在",
  },
  {
    name: "招式变体里的条件引用不存在的支援",
    breakIt: editJson("enemies/ghost.json", (d) => (d.ai.moves.crush.variants[0].when = { supportStacks: { support: "y", gte: 1 } })),
    expect: "敌方支援 y 不存在",
  },
  { name: "缺教学遭遇", breakIt: (root) => fs.rmSync(path.join(root, "encounters/tutorial-ghost.json")), expect: "缺少教学战遭遇" },
  {
    name: "没有任何列出的遭遇",
    breakIt: (root) => {
      for (const id of ["ghost", "vanguard", "conductor"]) editJson(`encounters/${id}.json`, (d) => (d.listed = false))(root)
    },
    expect: "至少要有一场",
  },
  // ---- 脚本结构 ----
  { name: "otherwise 放在开头", breakIt: editJson("enemies/ghost.json", (d) => d.ai.script.unshift({ otherwise: "claw" })), expect: "otherwise 必须紧跟在 when 后面" },
  { name: "脚本为空", breakIt: editJson("enemies/ghost.json", (d) => (d.ai.script = [])), expect: "ai.script" },
  { name: "turnMod 余数越界", breakIt: editJson("enemies/ghost.json", (d) => (d.ai.script[2].when.turnMod = [2, 2])), expect: "余数必须小于除数" },
  {
    name: "supportStacks 没写 gte / lte",
    breakIt: editJson("enemies/conductor.json", (d) => (d.ai.script[0].when.supportStacks = { support: "enemy-sup-conductor-charge" })),
    expect: "gte / lte 至少写一个",
  },
  // ---- 字段取值 ----
  { name: "未知的状态 id", breakIt: editJson("enemies/vanguard.json", (d) => (d.ai.moves.roar.status = "panic")), expect: "roar.status" },
  { name: "未知的属性", breakIt: editJson("enemies/ghost.json", (d) => (d.element = "water")), expect: "element" },
  { name: "未知的特性", breakIt: editJson("enemies/ghost.json", (d) => (d.traits = ["undead"])), expect: "traits" },
  { name: "招式多写字段", breakIt: editJson("enemies/vanguard.json", (d) => (d.ai.moves.roar.dmg = 1)), expect: "dmg" },
  { name: "HP 为 0", breakIt: editJson("enemies/ghost.json", (d) => (d.stats.hp = 0)), expect: "stats.hp" },
  { name: "三星类型未知", breakIt: editJson("encounters/ghost.json", (d) => (d.stars[0] = { type: "fast", value: 1 })), expect: "stars" },
  { name: "三星只有 2 条", breakIt: editJson("encounters/ghost.json", (d) => d.stars.pop()), expect: "stars" },
  { name: "三星类型重复", breakIt: editJson("encounters/ghost.json", (d) => (d.stars[2] = { type: "noDown" })), expect: "三星条件类型不能重复" },
  {
    name: "蓄力支援缺 maxStacks",
    breakIt: editJson("enemy-supports.json", (d) => delete d["enemy-sup-conductor-charge"].maxStacks),
    expect: "蓄力支援必须写 maxStacks",
  },
  {
    name: "装甲支援缺 defenseTier",
    breakIt: editJson("enemy-supports.json", (d) => delete d["enemy-sup-vg-armor"].defenseTier),
    expect: "装甲支援必须写 defenseTier",
  },
  // ---- 文件层面 ----
  { name: "目录里有非 JSON 文件", breakIt: (root) => fs.writeFileSync(path.join(root, "enemies/notes.txt"), "x"), expect: "没接入：enemies/notes.txt" },
  {
    name: "目录里有子目录",
    breakIt: (root) => {
      fs.mkdirSync(path.join(root, "enemies/old"))
      fs.copyFileSync(path.join(root, "enemies/ghost.json"), path.join(root, "enemies/old/ghost.json"))
    },
    expect: "没接入：enemies/old/ghost.json",
  },
  {
    name: "文件名不是合法 id",
    breakIt: (root) => fs.copyFileSync(path.join(root, "enemies/ghost.json"), path.join(root, "enemies/bad_id.json")),
    expect: "enemies/bad_id.json",
  },
  {
    name: "JSON 语法错误",
    breakIt: (root) => fs.appendFileSync(path.join(root, "encounters/ghost.json"), ","),
    expect: "content/encounters/ghost.json 不是合法的 JSON",
  },
  { name: "缺 enemy-supports.json", breakIt: (root) => fs.rmSync(path.join(root, "enemy-supports.json")), expect: "缺少：enemy-supports.json" },
]

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "choke-content-"))
let failed = 0

function freshCopy(): string {
  const root = path.join(tmpRoot, String(Math.random()).slice(2))
  fs.cpSync(CONTENT_DIR, root, { recursive: true })
  return root
}

try {
  // 未改动的副本必须能通过，否则下面的「失败」没有意义
  loadContentDir(freshCopy())
  console.log("✔ 原样副本：通过")

  for (const c of CASES) {
    const root = freshCopy()
    c.breakIt(root)
    let message: string | null = null
    try {
      loadContentDir(root)
    } catch (error) {
      message = (error as Error).message
    }
    const ok = message !== null && message.includes(c.expect)
    if (!ok) failed += 1
    const detail =
      message === null
        ? "竟然通过了"
        : (message.split("\n").find((line) => line.includes(c.expect)) ?? message.split("\n")[0]!).trim()
    console.log(`${ok ? "✔" : "✘"} ${c.name} → ${detail.slice(0, 100)}`)
  }
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}

console.log(`\n改坏 ${CASES.length} 项，未按预期 ${failed}`)
if (failed > 0) process.exitCode = 1
