import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { SKILLS, JOB_ORDER, JOB_STAT_WEIGHTS, ARCHETYPE_COEF, type SkillDef } from "@choke/shared/skills"
import { describeSkill, describeSkillEffects } from "@choke/shared/skill-check"
import { ELEMENT_LABEL } from "@choke/shared/types"

/**
 * 从技能数据生成《职业与技能总表》的第 1、2 节（<!-- skills:begin --> 与 <!-- skills:end --> 之间）。
 * pnpm docs:skills 写回文件；pnpm docs:check 只检查是否过期（过期则退出码 1）。
 */

const FILE = fileURLToPath(new URL("../../../Design/职业与技能总表 v0.1.md", import.meta.url))
const BEGIN = "<!-- skills:begin -->"
const END = "<!-- skills:end -->"

const JOB_LABEL = { tank: "坦克", warrior: "战士", mage: "法师", support: "辅助" } as const

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, "<br>")
const fixed = (n: number) => String(Math.round(n * 100) / 100)

function costLabel(def: SkillDef): string {
  if (def.passive) return "被动"
  if (def.once || def.costTag === "once") return "单次"
  if (def.costTag === "accumulate") return "累积"
  return "常态"
}

function totalPower(def: SkillDef): string {
  if (def.passive || def.power === undefined) return "—"
  const hits = def.hits ?? 1
  return hits > 1 ? `${fixed(def.power * hits)}（${hits}×${fixed(def.power)}）` : fixed(def.power)
}

function build(): string {
  const lines: string[] = []
  lines.push("## 1. 四大职业", "")
  lines.push("四维权重合计恒为 **4.00**，四个大职业之间只做重分配、不做增强。", "")
  lines.push("| 大职业 | 职业系数 | HP | ATK | DEF | INT | 技能数（主动 / 被动） |", "|---|---:|---:|---:|---:|---:|---|")
  for (const job of JOB_ORDER) {
    const w = JOB_STAT_WEIGHTS[job]
    const pool = Object.values(SKILLS).filter((s) => s.job === job)
    const passive = pool.filter((s) => s.passive).length
    lines.push(
      `| ${JOB_LABEL[job]} | ${ARCHETYPE_COEF[job].toFixed(2)} | ${w.hp.toFixed(2)} | ${w.atk.toFixed(2)} | ${w.def.toFixed(2)} | ${w.int.toFixed(2)} | ${pool.length}（${pool.length - passive} / ${passive}） |`,
    )
  }
  lines.push("", "## 2. 技能总表", "")
  lines.push(`共 ${Object.keys(SKILLS).length} 个技能，按大职业分组；每组先主动后被动。「倍率合计」是 倍率 × 段数。`, "")
  for (const job of JOB_ORDER) {
    const pool = Object.values(SKILLS).filter((s) => s.job === job)
    const ordered = [...pool.filter((s) => !s.passive), ...pool.filter((s) => s.passive)]
    lines.push(`### 2.${JOB_ORDER.indexOf(job) + 1} ${JOB_LABEL[job]}`, "")
    lines.push("| 技能 | id | 属性 | AP | 标签 | 倍率合计 | 效果 |", "|---|---|---|---:|---|---|---|")
    for (const def of ordered) {
      lines.push(
        `| ${def.name} | \`${def.id}\` | ${ELEMENT_LABEL[def.element]} | ${def.passive ? "—" : def.ap} | ${costLabel(def)} | ${totalPower(def)} | ${cell([describeSkill(def), ...describeSkillEffects(def).map(effect => `【${effect.name}】：${effect.description}`)].join("\n"))} |`,
      )
    }
    lines.push("")
  }
  return lines.join("\n").trimEnd()
}

const raw = readFileSync(FILE, "utf8")
const crlf = raw.includes("\r\n")
const text = raw.replace(/\r\n/g, "\n")
const start = text.indexOf(BEGIN)
const end = text.indexOf(END)
if (start < 0 || end < start) {
  console.error(`找不到 ${BEGIN} / ${END} 标记`)
  process.exit(1)
}
const next = `${text.slice(0, start + BEGIN.length)}\n${build()}\n${text.slice(end)}`
if (process.argv.includes("--check")) {
  if (next !== text) {
    console.error("职业与技能总表已过期，请运行 pnpm docs:skills")
    process.exit(1)
  }
  console.log("职业与技能总表是最新的")
} else {
  writeFileSync(FILE, crlf ? next.replace(/\n/g, "\r\n") : next)
  console.log(next === text ? "没有变化" : "已更新职业与技能总表")
}
