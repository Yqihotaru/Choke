import { memo, useMemo, type CSSProperties, type ReactNode } from "react"

import { cn } from "@/lib/utils"

import { ElementGlyph, JobGlyph } from "./CardFace"
import {
  ELEMENT_COLOR,
  ELEMENT_LABEL,
  JOB_LABEL,
  MOD_COLOR,
  RARITY_LABEL,
  battlePower,
  bpColor,
  flagUrl,
  isCustomBanner,
  nameSizeOf,
  starStates,
} from "./data"
import { motifTriangles } from "./motif"
import type { CardFaceData, CardFaceMode } from "./types"
import "./card-face-b.css"

/** MOD 的三种摆法：侧栏六边形 / 头像右上角 / 名字后面的胶囊 */
export type ModPlacement = "spine" | "portrait" | "name"

interface Props {
  card: CardFaceData
  mode?: CardFaceMode
  tone?: "dark" | "light"
  mods?: ModPlacement
  version?: "v1" | "v2"
  className?: string
  eager?: boolean
}

/**
 * 卡面 B（侧栏版）。左边一条稀有度色竖栏，全部横排：稀有度图标、MOD，底部 Lv、命座；
 * 右边从上到下：banner（世界排名水印）→ 头像压 banner 下沿 + 国旗排名 / pp / 大号 BP
 * → 名字 → 技能 → 底标。战斗态只留肖像和技能行。类名前缀 cfb（cb 已被开包卡背占用）。
 */
export const CardFaceB = memo(function CardFaceB({
  card,
  mode = "collection",
  tone = "dark",
  mods: placement = "spine",
  version = "v2",
  className,
  eager = false,
}: Props) {
  const bp = battlePower(card)
  const flag = flagUrl(card.country)
  const banner = isCustomBanner(card.banner) ? card.banner : null
  const triangles = useMemo(() => (banner ? null : motifTriangles(card.id)), [banner, card.id])
  const loading = eager ? "eager" : "lazy"

  const modList: ReactNode[] = card.mods.map((mod) => (
    <span className="cfb__mod" key={mod} style={{ "--mod": MOD_COLOR[mod] } as CSSProperties}>
      {mod}
    </span>
  ))
  if (card.isHero) {
    modList.unshift(
      <span className="cfb__mod cfb__mod--hero" key="hero">
        HERO
      </span>,
    )
  }
  const modBlock = (where: ModPlacement) =>
    placement === where && modList.length > 0 ? (
      <div className="cfb__mods" data-at={where}>
        {modList}
      </div>
    ) : null

  return (
    <div
      className={cn("cfb", className)}
      data-rarity={card.rarity}
      data-tone={tone}
      data-version={version}
      data-mode={mode}
      data-foil={card.foil ? "true" : undefined}
      style={{ "--name-size": `${nameSizeOf(card.name) * (version === "v1" ? 1.05 : 1.22)}cqw` } as CSSProperties}
    >
      <div className="cfb__frame" aria-hidden />

      <aside className="cfb__spine">
        {/* 侧栏顶端：按稀有度区分形状的图标；英文全名在 banner 右上角 */}
        <i className="cfb__emblem" title={RARITY_LABEL[card.rarity]} />
        {modBlock("spine")}
        <span className="cfb__lv">
          <i>LV</i>
          <b>{card.level}</b>
        </span>
        <span className="cfb__stars" aria-label={`命座 ${card.constellation}`}>
          {starStates(card).map((state, i) => (
            <i data-state={state} key={i} />
          ))}
        </span>
      </aside>

      <div className="cfb__main">
        <div className="cfb__banner">
          {banner ? (
            <img src={banner} alt="" draggable={false} loading={loading} decoding="async" referrerPolicy="no-referrer" />
          ) : (
            <svg className="cfb__motif" viewBox="0 0 100 50" preserveAspectRatio="xMidYMid slice" aria-hidden>
              {triangles?.map((t, i) => (
                <path key={i} d={t.d} data-fill={t.filled ? "" : undefined} />
              ))}
            </svg>
          )}
          {card.globalRank != null && (
            <b className="cfb__watermark" aria-hidden>
              #{card.globalRank.toLocaleString("en-US")}
            </b>
          )}
          <span className="cfb__tag">{RARITY_LABEL[card.rarity]}</span>
        </div>

        <div className="cfb__id">
          <div className="cfb__avatar">
            {card.art && (
              <img src={card.art} alt="" draggable={false} loading={loading} decoding="async" referrerPolicy="no-referrer" />
            )}
            {modBlock("portrait")}
          </div>
          <div className="cfb__stats">
            <span className="cfb__rank">
              {flag && (
                <img src={flag} alt={card.country} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              )}
              {card.globalRank != null ? `#${card.globalRank.toLocaleString("en-US")}` : card.country}
            </span>
            {card.pp != null && (
              <span className="cfb__pp">
                {Math.round(card.pp).toLocaleString("en-US")}
                <i>pp</i>
              </span>
            )}
            <span className="cfb__bp" style={{ "--bp": bpColor(bp) } as CSSProperties}>
              <i>BP</i>
              <b>{bp.toLocaleString("en-US")}</b>
            </span>
          </div>
        </div>

        <div className="cfb__title">
          <h3 className="cfb__name" title={card.name}>
            {card.name}
          </h3>
          {modBlock("name")}
        </div>

        <div className="cfb__skills">
          {card.skills.slice(0, 3).map((skill, i) => (
            <div className="cfb__skill" key={i}>
              <span
                className="cfb__el"
                style={{ "--el": ELEMENT_COLOR[skill.element] } as CSSProperties}
                title={ELEMENT_LABEL[skill.element]}
              >
                <ElementGlyph element={skill.element} />
              </span>
              <span className="cfb__skill-name">{skill.name}</span>
              {skill.mp !== undefined && <span className="cfb__mp">{skill.mp}</span>}
              {skill.passive ? <span className="cfb__passive">被动</span> : <span className="cfb__ap">{skill.ap}</span>}
            </div>
          ))}
          {/* 不足三行补空槽，所有卡的技能区一样高 */}
          {Array.from({ length: 3 - Math.min(card.skills.length, 3) }, (_, i) => (
            <div className="cfb__skill cfb__skill--empty" key={`empty-${i}`} aria-hidden />
          ))}
        </div>

        <footer className="cfb__foot">
          <span className="cfb__job">
            <JobGlyph job={card.job} />
            {JOB_LABEL[card.job]}
          </span>
          {/* 图鉴、预览这类没有实例的卡不显示序号 */}
          {card.serial ? (
            <span className="cfb__serial" title={`第 ${card.serial} 张 / 共抽出 ${card.pulled ?? card.serial} 张`}>
              #{card.serial}
              <i>/{Math.max(card.pulled ?? 0, card.serial)}</i>
            </span>
          ) : null}
        </footer>
      </div>
    </div>
  )
})
