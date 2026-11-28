import { useState } from "react"

import type { MapKind } from "@choke/shared/expedition/content"

import type { MapListing } from "./api"
import { remainingText } from "./common"

export const KIND_LABEL: Record<MapKind, string> = {
  main: "主线",
  daily: "日常",
  weekly: "周常",
  season: "赛季",
}
const KIND_ORDER: MapKind[] = ["main", "daily", "weekly", "season"]

/** 选图页：按主线 / 日常 / 周常 / 赛季分栏，点「出征准备」进入下一页 */
export function MapSelect({
  maps,
  onPick,
}: {
  maps: MapListing[]
  onPick: (map: MapListing) => void
}) {
  const kinds = KIND_ORDER.filter((kind) => maps.some((m) => m.kind === kind))
  const [kind, setKind] = useState<MapKind>(kinds[0] ?? "main")
  const shown = maps.filter((m) => m.kind === kind)

  return (
    <>
      <h1 className="ex-title">选择出征地图</h1>

      <div className="ex-seg" role="tablist" style={{ marginBottom: 14, maxWidth: 480 }}>
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-pressed={k === kind}
            onClick={() => setKind(k)}
          >
            {KIND_LABEL[k]}
            <small>{maps.filter((m) => m.kind === k).length} 张</small>
          </button>
        ))}
      </div>

      {shown.length === 0 && <div className="ex-note">这一栏暂时没有地图。</div>}
      <div className="ex-maps">
        {shown.map((map) => {
          return (
            <article className="ex-map" key={map.id} data-locked={!map.startable}>
              <div className="ex-map__head">
                <span className="ex-map__kind">{KIND_LABEL[map.kind]}</span>
                <span className="ex-map__stars">
                  ★ {map.bestStars} / {map.maxStars}
                </span>
              </div>
              <h3>{map.name}</h3>
              {map.summary && <p>{map.summary}</p>}
              <div className="ex-map__chips">
                <span className="ex-chip">编队 {map.deckSize} 人</span>
                <span className="ex-chip">{map.fights} 场战斗</span>
                {map.objectiveCount > 0 && (
                  <span className="ex-chip">
                    目标 {map.bestObjectives} / {map.objectiveCount}
                  </span>
                )}
              </div>
              {(map.kind === "daily" || map.kind === "weekly") && (
                <p>这一期还剩 {remainingText(map.endsAt)}</p>
              )}
              {!map.startable && map.lockedReason && <div className="ex-note">{map.lockedReason}</div>}
              <div className="ex-map__foot">
                <span className="ex-chip">已通关 {map.clears} 次</span>
                <button
                  type="button"
                  className="ex-btn ex-btn--primary"
                  disabled={!map.startable}
                  onClick={() => onPick(map)}
                >
                  出征准备
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </>
  )
}
