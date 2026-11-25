import { useEffect, useState, type CSSProperties } from "react"

import { playSfx } from "@/audio/sfx"
import { JOB_LABEL, RARITY_LABEL } from "@/card/data"
import { RARITIES, type Job, type Rarity } from "@/card/types"
import { RARITY_COLOR } from "@/desk/lib/rarity"

const regionNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["zh-CN"], { type: "region" })
    : null

export function countryLabel(code: string): string {
  try {
    return regionNames?.of(code) ?? code
  } catch {
    return code
  }
}

const JOBS: Job[] = ["tank", "warrior", "mage", "support"]

/** 稀有度多选；「全部」清空选择。counts 是每档右侧的小字（如 owned/total）。 */
export function RarityChips({
  value,
  onChange,
  counts,
}: {
  value: Rarity[]
  onChange: (next: Rarity[]) => void
  counts?: Partial<Record<Rarity, string>>
}) {
  return (
    <div className="bk-chips" role="group" aria-label="稀有度筛选">
      <button
        type="button"
        className="bk-chip"
        aria-pressed={value.length === 0}
        onClick={() => {
          playSfx("tick")
          onChange([])
        }}
      >
        全部
      </button>
      {RARITIES.map((item) => {
        const on = value.includes(item)
        return (
          <button
            key={item}
            type="button"
            className="bk-chip"
            aria-pressed={on}
            onClick={() => {
              playSfx("tick")
              onChange(on ? value.filter((entry) => entry !== item) : [...value, item])
            }}
          >
            <i style={{ "--c": RARITY_COLOR[item] } as CSSProperties} aria-hidden />
            {RARITY_LABEL[item]}
            {counts?.[item] && <small>{counts[item]}</small>}
          </button>
        )
      })}
    </div>
  )
}

/** 搜索框：内部 280ms 防抖后才调用 onChange。外部清空筛选时同步清掉输入。 */
export function SearchBox({
  value,
  onChange,
  placeholder = "搜索玩家名",
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  // value 被外部改掉（清除筛选）时同步输入框
  if (value !== seen) {
    setSeen(value)
    setDraft(value)
  }
  useEffect(() => {
    const next = draft.trim()
    if (next === value) return
    const timer = window.setTimeout(() => onChange(next), 280)
    return () => window.clearTimeout(timer)
  }, [draft, value, onChange])
  return (
    <input
      className="bk-input"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
    />
  )
}

export function JobSelect({ value, onChange }: { value: Job | ""; onChange: (next: Job | "") => void }) {
  return (
    <select
      className="bk-select"
      value={value}
      onChange={(event) => onChange(event.target.value as Job | "")}
      aria-label="职业"
    >
      <option value="">全部职业</option>
      {JOBS.map((job) => (
        <option key={job} value={job}>
          {JOB_LABEL[job]}
        </option>
      ))}
    </select>
  )
}

export function CountrySelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (next: string) => void
  options: { code: string; total: number }[]
}) {
  return (
    <select
      className="bk-select"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="国家或地区"
    >
      <option value="">全部国家 / 地区</option>
      {options.map((item) => (
        <option key={item.code} value={item.code}>
          {countryLabel(item.code)}（{item.code}） · {item.total.toLocaleString("en-US")}
        </option>
      ))}
    </select>
  )
}

/** 三态：全部 / 闪卡 / 非闪 */
export function FoilToggle({
  value,
  onChange,
}: {
  value: boolean | undefined
  onChange: (next: boolean | undefined) => void
}) {
  const items: { label: string; value: boolean | undefined }[] = [
    { label: "全部", value: undefined },
    { label: "闪卡", value: true },
    { label: "非闪", value: false },
  ]
  return (
    <div className="bk-seg" role="group" aria-label="闪卡筛选">
      {items.map((item) => (
        <button key={item.label} type="button" aria-pressed={value === item.value} onClick={() => onChange(item.value)}>
          {item.label}
        </button>
      ))}
    </div>
  )
}

/** 排序下拉 + 方向按钮；换字段时方向重置为该字段的默认方向。fixedDir 时不显示方向按钮。 */
export function SortSelect<S extends string>({
  value,
  dir,
  options,
  onChange,
  fixedDir = false,
}: {
  value: S
  dir: "asc" | "desc"
  options: readonly { id: S; label: string; dir: "asc" | "desc" }[]
  onChange: (sort: S, dir: "asc" | "desc") => void
  fixedDir?: boolean
}) {
  return (
    <span className="sort-select">
      <select
        className="bk-select"
        value={value}
        onChange={(event) => {
          const next = options.find((item) => item.id === event.target.value)
          if (next) onChange(next.id, next.dir)
        }}
        aria-label="排序"
      >
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {fixedDir ? `按${item.label}` : item.label}
          </option>
        ))}
      </select>
      {!fixedDir && (
        <button
          type="button"
          className="bk-btn bk-btn--sm"
          onClick={() => onChange(value, dir === "asc" ? "desc" : "asc")}
          aria-label={dir === "asc" ? "升序，点击改为降序" : "降序，点击改为升序"}
          title={dir === "asc" ? "升序" : "降序"}
        >
          {dir === "asc" ? "↑" : "↓"}
        </button>
      )}
    </span>
  )
}

/** 已生效的筛选：每项可单独清除，最后是「清除全部」。 */
export function ActiveFilters({
  chips,
  onClearAll,
}: {
  chips: { label: string; onClear: () => void }[]
  onClearAll: () => void
}) {
  if (chips.length === 0) return null
  return (
    <div className="active-filters" role="group" aria-label="已选筛选">
      {chips.map((chip) => (
        <button key={chip.label} type="button" className="bk-chip is-on" onClick={chip.onClear} aria-label={`清除 ${chip.label}`}>
          {chip.label} ×
        </button>
      ))}
      <button type="button" className="bk-btn bk-btn--ghost bk-btn--sm" onClick={onClearAll}>
        清除全部
      </button>
    </div>
  )
}
