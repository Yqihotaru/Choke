import { describeSkill, describeSkillEffects } from "@choke/shared/skill-check"
import type { SkillEffect } from "@choke/shared/skills"
import { useMemo, useState } from "react"
import type { MouseEvent, KeyboardEvent } from "react"
import { ELEMENT_LABEL } from "@/card/data"
import { canUseSkillReason, effectiveApCost } from "@choke/shared/battle/engine"
import type { BattleState } from "@choke/shared/battle/types"
import { playSfx } from "./sfx"

export const pointerCommand = {
  tabIndex: -1,
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") event.preventDefault()
  },
} as const

export interface SkillPreview {
  heading: string
  description: string
  effects: SkillEffect[]
  reason: string | null
  text: string
  anchor: HTMLElement
  ap: number
  battle: BattleState
  pointer?: { x: number; y: number }
}

/** Same printed rows in both layouts. The engine owns availability and AP costs. */
export function useSkillRows(battle: BattleState | null, onPlay: (index: number, id: string) => void) {
  const [hover, setHover] = useState<SkillPreview | null>(null)
  const cards = useMemo(() => battle?.cards.map((card, index) => {
    const skills = card.skills.map(skill => {
      const ap = skill.passive ? 0 : effectiveApCost(battle, card, skill)
      return { id: skill.id, name: skill.name, element: skill.element, passive: skill.passive, ap, surcharged: ap > skill.ap }
    })
    const actions = card.skills.map((skill, i) => {
      const ap = skills[i].ap
      const reason = skill.passive ? "被动 · 自动生效" : canUseSkillReason(battle, index, skill.id)
      const cost = skill.passive ? "" : ` · ${ap} AP${ap > skill.ap ? `（基础 ${skill.ap}）` : ""}`
      const heading = `${skill.name} · ${ELEMENT_LABEL[skill.element]}${cost}`
      const description = describeSkill(skill)
      const effects = describeSkillEffects(skill)
      const hint = { battle, ap: reason ? 0 : ap, heading, description, effects, reason, text: [heading, reason, description, ...effects.map(effect => `${effect.name}: ${effect.description}`)].filter(Boolean).join("｜") }
      return {
        ...pointerCommand,
        type: "button" as const, "aria-disabled": Boolean(reason), "aria-label": hint.text, "data-sfx": "none",
        onMouseEnter: (event: MouseEvent<HTMLButtonElement>) => {
          setHover({ ...hint, anchor: event.currentTarget, pointer: { x: event.clientX, y: event.clientY } })
          if (!reason) playSfx("hover")
        },
        onMouseLeave: () => setHover(null),
        onClick: () => {
          if (reason) return
          setHover(null)
          playSfx("select", { rate: 1.12 })
          onPlay(index, skill.id)
        },
      }
    })
    return { face: { ...card.face, skills }, actions }
  }) ?? [], [battle, onPlay])
  const hint = hover?.battle === battle ? hover : null
  return { cards, hint }
}
