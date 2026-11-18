import { memo } from "react"

import { CardFace } from "@/card/CardFace"
import { expToNextLevel } from "@/tutorial/store"

import { toFace, type ApiUserCard } from "./api"
import { cardFromDesk } from "./cardFace"
import { PackArt } from "./opening/PackArt"
import type { CardData, PackPool } from "./types"

/** 卡牌域很重；桌面状态变化时复用同一张卡面。 */
export const DeskCard = memo(function DeskCard({
  card,
  hero,
}: {
  card: CardData
  hero: ApiUserCard | null
}) {
  return (
    <CardFace card={card.isHero && hero ? toFace(hero) : cardFromDesk(card)} />
  )
})

export const DeskPack = memo(function DeskPack({ pool }: { pool: PackPool }) {
  return (
    <div className="desk-pack">
      <PackArt pool={pool} />
    </div>
  )
})

/** 顶栏的等级条：教程经验 / 解锁进度都往这里反馈 */
export function LevelMeter({ level, exp }: { level: number; exp: number }) {
  const need = expToNextLevel(level)
  const percent = Math.min(100, Math.round((exp / Math.max(1, need)) * 100))
  return (
    <div className="desk-level" title={`Lv.${level} · ${exp} / ${need} EXP`}>
      <b>Lv.{level}</b>
      <span className="desk-level__track" aria-hidden>
        <i style={{ width: `${percent}%` }} />
      </span>
      <em>
        {exp}/{need}
      </em>
    </div>
  )
}
