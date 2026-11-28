import { useEffect, useMemo, useState } from "react"

import { playSfx } from "@/audio/sfx"
import { applyExp, expToNext, isHeroCardId } from "@choke/shared/progression"
import type { ExpeditionPoolCard } from "@choke/shared/expedition/view"

const MAX_LEVEL_UP_ANIMATIONS = 5
const STEP_MS = 340

interface CardProgress {
  card: ExpeditionPoolCard
  beforePct: number
  afterLevel: number
  afterPct: number
  levelsGained: number
}

function pctOf(level: number, exp: number, card: ExpeditionPoolCard): number {
  const hero = isHeroCardId(card.face.id)
  const need = expToNext(level, card.face.rarity, hero)
  if (need <= 0) return 100
  return Math.max(0, Math.min(100, (exp / need) * 100))
}

function computeProgress(cards: readonly ExpeditionPoolCard[], gainedExp: number): CardProgress[] {
  return cards.map((card) => {
    const hero = isHeroCardId(card.face.id)
    const baseExp = (card.face as { exp?: number }).exp ?? 0
    const after = applyExp(card.face.level, baseExp, gainedExp, card.face.rarity, hero)
    return {
      card,
      beforePct: pctOf(card.face.level, baseExp, card),
      afterLevel: after.level,
      afterPct: pctOf(after.level, after.exp, card),
      levelsGained: Math.max(0, after.level - card.face.level),
    }
  })
}

const STRIP_CSS = `
.choke-exp-strip {
  width: 100%;
  margin-top: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  text-align: left;
}
.choke-exp-card {
  position: relative;
  padding: 7px 9px;
  border-radius: 10px;
  background: rgba(15, 13, 20, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.12);
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
}
.choke-exp-card[data-levelup="true"] {
  border-color: #ffd166;
  box-shadow: 0 0 16px rgba(255, 209, 102, 0.48), inset 0 0 12px rgba(255, 209, 102, 0.16);
  transform: translateY(-2px);
}
.choke-exp-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 12px;
  line-height: 1.3;
  margin-bottom: 5px;
}
.choke-exp-card__name {
  font-weight: 700;
  color: #f4eef7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.choke-exp-card__lv {
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #ffd166;
  white-space: nowrap;
}
.choke-exp-card__lvup {
  display: inline-block;
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 999px;
  background: linear-gradient(90deg, #ff66aa, #ffd166);
  color: #18131d;
  font-size: 10px;
  font-weight: 900;
  animation: choke-lv-pop 0.36s ease-out;
}
.choke-exp-bar {
  position: relative;
  height: 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.choke-exp-bar > i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #ff66aa, #ff99cc 55%, #ffe08a);
  box-shadow: 0 0 10px rgba(255, 130, 190, 0.78);
  transition: width 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes choke-lv-pop {
  0% { transform: scale(0.7); opacity: 0; }
  60% { transform: scale(1.16); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
`

/**
 * 战后 / 远征结算的卡牌经验条与升级特效：
 * 真实数值与最终等级完整计算，连续升级动画最多连续播放 5 次。
 */
export function CardExpStrip({
  cards,
  gainedExp,
}: {
  cards: readonly ExpeditionPoolCard[]
  gainedExp: number
}) {
  const items = useMemo(() => computeProgress(cards, gainedExp), [cards, gainedExp])
  const maxLoops = useMemo(
    () => items.reduce((max, item) => Math.max(max, Math.min(MAX_LEVEL_UP_ANIMATIONS, item.levelsGained)), 0),
    [items],
  )

  // phase: -1 = 初始进度；0..maxLoops-1 = 第 k 次冲满 100% + 升级闪光；maxLoops = 落到最终百分比
  const [phase, setPhase] = useState(-1)
  const [flashKey, setFlashKey] = useState(-1)

  useEffect(() => {
    const timers: number[] = []
    if (gainedExp <= 0) {
      timers.push(window.setTimeout(() => setPhase(0), 60))
      return () => timers.forEach((id) => window.clearTimeout(id))
    }

    if (maxLoops === 0) {
      timers.push(window.setTimeout(() => setPhase(0), 120))
      return () => timers.forEach((id) => window.clearTimeout(id))
    }

    for (let loop = 0; loop < maxLoops; loop += 1) {
      const at = 120 + loop * STEP_MS
      timers.push(
        window.setTimeout(() => {
          setPhase(loop)
          setFlashKey(loop)
          playSfx("levelup")
        }, at),
      )
    }
    timers.push(
      window.setTimeout(() => {
        setPhase(maxLoops)
        setFlashKey(-1)
      }, 120 + maxLoops * STEP_MS),
    )
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [gainedExp, maxLoops])

  if (items.length === 0) return null

  return (
    <>
      <style>{STRIP_CSS}</style>
      <div className="choke-exp-strip">
        {items.map((item) => {
          const loops = Math.min(MAX_LEVEL_UP_ANIMATIONS, item.levelsGained)
          let width = item.beforePct
          let shownLevel = item.card.face.level
          let flashing = false

          if (loops === 0) {
            width = phase >= 0 ? item.afterPct : item.beforePct
          } else if (phase >= 0 && phase < loops) {
            width = 100
            shownLevel = item.card.face.level + phase + 1
            flashing = flashKey === phase
          } else if (phase >= loops) {
            width = item.afterPct
            shownLevel = item.afterLevel
          }

          const finished = phase >= maxLoops
          return (
            <div
              className="choke-exp-card"
              key={item.card.userCardId}
              data-levelup={flashing || (finished && item.levelsGained > 0) ? "true" : undefined}
            >
              <div className="choke-exp-card__head">
                <span className="choke-exp-card__name">{item.card.face.name}</span>
                <span className="choke-exp-card__lv">
                  Lv.{shownLevel}
                  {finished && item.levelsGained > 0 && (
                    <span className="choke-exp-card__lvup">UP +{item.levelsGained}</span>
                  )}
                </span>
              </div>
              <div className="choke-exp-bar" aria-label={`经验 ${Math.round(width)}%`}>
                <i style={{ width: `${width}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
