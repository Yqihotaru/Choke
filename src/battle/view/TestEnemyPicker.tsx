import { useState } from "react"

import type { EncounterSummary } from "@choke/shared/battle/content"

import { playSfx } from "../sfx"

const TIER_GROUPS = [
  { tier: "normal", label: "普通" },
  { tier: "elite", label: "精英" },
  { tier: "boss", label: "BOSS" },
] as const

interface Props {
  /** 含 listed 为 false 的遭遇 */
  encounters: EncounterSummary[]
  activeId: string
  onSelect: (id: string) => void
}

/** 战斗测试用的敌人选择器：按档位分组，可搜索，列出所有遭遇（含没上架的） */
export function TestEnemyPicker({ encounters, activeId, onSelect }: Props) {
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  const matches = (e: EncounterSummary) =>
    !needle || [e.name, e.title, e.id, e.summary].some((text) => text.toLowerCase().includes(needle))

  return (
    <div className="choke-test-picker">
      <input
        className="choke-test-picker__search"
        type="search"
        placeholder="搜索名字、称号或 id"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="choke-test-picker__list">
        {TIER_GROUPS.map(({ tier, label }) => {
          const items = encounters.filter((e) => e.tier === tier && matches(e))
          if (items.length === 0) return null
          return (
            <section key={tier}>
              <h4>
                {label} <small>{items.length}</small>
              </h4>
              <div className="choke-stage-selector__btns">
                {items.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="choke-stage-pill"
                    data-active={e.id === activeId ? "true" : undefined}
                    title={e.summary}
                    onClick={() => {
                      playSfx("click")
                      onSelect(e.id)
                    }}
                  >
                    <b>{e.name}</b>
                    <small>
                      HP {e.hp.toLocaleString("en-US")}
                      {e.listed ? "" : " · 未上架"}
                    </small>
                  </button>
                ))}
              </div>
            </section>
          )
        })}
        {encounters.every((e) => !matches(e)) && <p className="choke-test-picker__empty">没有匹配的敌人</p>}
      </div>
    </div>
  )
}
