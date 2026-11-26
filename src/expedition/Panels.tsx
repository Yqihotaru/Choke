import { useState } from "react"

import type { ExpeditionEventView, ExpeditionStoryView } from "@choke/shared/expedition/view"

import { RewardChips } from "./common"

/** 剧情：台词按顺序排下来，遇到选项要选完才能继续 */
export function StoryPanel({
  story,
  busy,
  onDone,
}: {
  story: ExpeditionStoryView
  busy: boolean
  onDone: (choices: number[]) => void
}) {
  const menus = story.lines.filter((line) => "choice" in line).length
  const [choices, setChoices] = useState<(number | undefined)[]>(() => Array.from({ length: menus }))

  return (
    <>
      <div className="ex-ph">
        <b>剧情 · {story.title}</b>
        {menus > 0 && <span>{menus} 处选择</span>}
      </div>
      <div className="ex-story">
        {story.lines.map((line, i) => {
          if ("choice" in line) {
            const at = story.lines.slice(0, i).filter((item) => "choice" in item).length
            return (
              <div className="ex-story__choice" key={i}>
                {line.choice.map((option, j) => (
                  <button
                    key={j}
                    type="button"
                    className="ex-card ex-card--plain"
                    data-on={choices[at] === j}
                    onClick={() => setChoices((cur) => cur.map((v, k) => (k === at ? j : v)))}
                  >
                    <span className="ex-card__mark" />
                    <span className="ex-card__title">{option.text}</span>
                  </button>
                ))}
              </div>
            )
          }
          return (
            <p className="ex-story__line" key={i}>
              {line.speaker && <b>{line.speaker}</b>}
              {line.text}
            </p>
          )
        })}
      </div>
      <button
        type="button"
        className="ex-go"
        disabled={busy || choices.some((c) => c === undefined)}
        onClick={() => onDone(choices as number[])}
      >
        {choices.some((c) => c === undefined) ? "请先做出选择" : "继续"}
      </button>
    </>
  )
}

/** 事件：选项的效果直接写给玩家看，不靠蒙 */
export function EventPanel({
  event,
  busy,
  onPick,
}: {
  event: ExpeditionEventView
  busy: boolean
  onPick: (choice: number) => void
}) {
  const [sel, setSel] = useState<number | null>(null)
  return (
    <>
      <div className="ex-ph">
        <b>事件 · {event.title}</b>
        <span>{event.options.length} 个选项</span>
      </div>
      <p className="ex-event__text">{event.text}</p>
      {event.options.map((option, i) => (
        <button
          key={i}
          type="button"
          className="ex-card ex-card--plain"
          data-on={sel === i}
          onClick={() => setSel(i)}
        >
          <span className="ex-card__mark" />
          <span className="ex-card__title">{option.text}</span>
          <span className="ex-card__effects">
            {option.threat ? (
              <span className={`ex-chip${option.threat > 0 ? " ex-chip--warn" : ""}`}>
                威胁 {option.threat > 0 ? "+" : ""}
                {option.threat}
              </span>
            ) : null}
            {option.hpLossPct ? <span className="ex-chip ex-chip--warn">队伍失去 {Math.round(option.hpLossPct * 100)}% 血量</span> : null}
            {option.reward && <RewardChips reward={option.reward} />}
            {!option.threat && !option.hpLossPct && !option.reward && <span className="ex-chip">没有直接效果</span>}
          </span>
        </button>
      ))}
      <button type="button" className="ex-go" disabled={busy || sel === null} onClick={() => sel !== null && onPick(sel)}>
        {sel === null ? "请先选一个" : "确认选择"}
      </button>
    </>
  )
}
