import { memo, useEffect, useMemo, type CSSProperties } from "react"

import { cn } from "@/lib/utils"

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
import { CardFoil } from "./CardFoil"
import { trackCardLight } from "./light"
import { motifTriangles } from "./motif"
import type { CardFaceData, Element, Job } from "./types"
import "./card-face.css"

interface Props {
  card: CardFaceData
  className?: string
  /** 书里的邻页提前加载，避免翻过去时才开始请求插画 */
  eager?: boolean
}

/**
 * 纸质卡面。分区从上到下：
 * 肖像窗（大头像居中；背景是本人自定义 banner 虚化压暗，没有或是 osu! 预设图时换成稀有度底纹；
 * 左上品阶、右上 Lv / 已装 MOD，底部命座星）→ 卡名（名字 + 国旗排名 · pp 一行）
 * → 技能行（1–3 行）→ 底栏（职业 + BP / 编号）。
 * 材质、烫印在 card-face.css；闪卡膜是共用的 CardFoil。
 */
export const CardFace = memo(function CardFace({ card, className, eager = false }: Props) {
  useEffect(trackCardLight, [])

  const bp = battlePower(card)
  const flag = flagUrl(card.country)
  const banner = isCustomBanner(card.banner) ? card.banner : null
  // 只画已经装上的 MOD；超过三个时第三格改成 +N
  const modOverflow = card.mods.length > 3
  const mods = modOverflow ? card.mods.slice(0, 2) : card.mods
  const nameStyle = {
    "--name-size": `${nameSizeOf(card.name)}cqw`,
  } as CSSProperties
  const hasStats = Boolean(card.country) || card.globalRank != null || card.pp != null
  const triangles = useMemo(() => (banner ? null : motifTriangles(card.id)), [banner, card.id])

  return (
    <div
      className={cn("cf card-face", className)}
      data-rarity={card.rarity}
      data-foil={card.foil ? "true" : undefined}
      // 镜像卡视觉等美术 PR；先留数据钩子，不做临时样式
      data-mirror={card.isMirror ? "true" : undefined}
    >
      <div className="cf__stock" aria-hidden />
      <div className="cf__sheen" aria-hidden />
      <div className="cf__bezel" aria-hidden />

      <div className="cf__content">
        <div className="cf__art" data-backdrop={banner ? "banner" : "motif"}>
          {banner && (
            <img
              className="cf__backdrop"
              src={banner}
              alt=""
              draggable={false}
              loading={eager ? "eager" : "lazy"}
              decoding="async"
              fetchPriority="low"
              referrerPolicy="no-referrer"
            />
          )}
          {triangles && (
            <svg className="cf__motif" viewBox="0 0 100 80" preserveAspectRatio="xMidYMid slice" aria-hidden>
              {triangles.map((t, i) => (
                <path key={i} d={t.d} data-fill={t.filled ? "" : undefined} />
              ))}
            </svg>
          )}

          <span className="cf__grade" title={RARITY_LABEL[card.rarity]}>
            <i className="cf__emblem" />
            <span className="cf__rarity">{RARITY_LABEL[card.rarity]}</span>
          </span>

          <div className="cf__corner">
            <span className="cf__lv">
              <i>Lv</i>
              <b>{card.level}</b>
            </span>
            <span className="cf__stars" aria-label={`命座 ${card.constellation}`}>
              {starStates(card).map((state, i) => (
                <i className="cf__star" data-state={state} key={i} />
              ))}
            </span>
          </div>

          {(card.isHero || mods.length > 0) && (
            <div className="cf__mods">
              {card.isHero && <em className="cf__hero">HERO</em>}
              {mods.map((mod) => (
                <span
                  className="cf__mod"
                  key={mod}
                  style={{ "--mod": MOD_COLOR[mod] } as CSSProperties}
                >
                  <b>{mod}</b>
                </span>
              ))}
              {modOverflow && (
                <span className="cf__mod cf__mod--more">
                  <b>+{card.mods.length - 2}</b>
                </span>
              )}
            </div>
          )}

          <div className="cf__portrait">
            {card.art && (
              <img
                src={card.art}
                alt=""
                draggable={false}
                loading={eager ? "eager" : "lazy"}
                decoding="async"
                referrerPolicy="no-referrer"
              />
            )}
          </div>
        </div>

        <div className="cf__title">
          {card.profileUrl ? (
            <a
              className="cf__name"
              href={card.profileUrl}
              title={card.name}
              target="_blank"
              rel="noreferrer"
              style={nameStyle}
            >
              {card.name}
            </a>
          ) : (
            <h3 className="cf__name" title={card.name} style={nameStyle}>
              {card.name}
            </h3>
          )}

          {hasStats && (
            <div className="cf__stats">
              {flag && (
                <img
                  className="cf__flag"
                  src={flag}
                  alt={card.country}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              )}
              {card.globalRank != null ? (
                <b>#{card.globalRank.toLocaleString("en-US")}</b>
              ) : (
                !flag && card.country && <b>{card.country}</b>
              )}
              {card.pp != null && (
                <span className="cf__pp">
                  <b>{Math.round(card.pp).toLocaleString("en-US")}</b>
                  <i>pp</i>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="cf__skills">
          {card.skills.slice(0, 3).map((skill, i) => (
            <div className="cf__skill" key={i}>
              <span
                className="cf__el"
                style={
                  { "--el": ELEMENT_COLOR[skill.element] } as CSSProperties
                }
                title={ELEMENT_LABEL[skill.element]}
              >
                <ElementGlyph element={skill.element} />
              </span>
              <span className="cf__skill-name">{skill.name}</span>
              <span className="cf__cost">
                {skill.passive ? (
                  <span className="cf__passive">被动</span>
                ) : (
                  <span className="cf__ap" title="AP">
                    {skill.ap}
                  </span>
                )}
              </span>
            </div>
          ))}
          {/* 不足三行补空槽：所有卡的技能区一样高，头像窗、卡名的位置对齐 */}
          {Array.from({ length: 3 - Math.min(card.skills.length, 3) }, (_, i) => (
            <div className="cf__skill cf__skill--empty" key={`empty-${i}`} aria-hidden />
          ))}
        </div>

        <footer className="cf__foot">
          <span className="cf__job" title={JOB_LABEL[card.job]}>
            <JobGlyph job={card.job} />
            <span>{JOB_LABEL[card.job]}</span>
          </span>
          <span
            className="cf__bp"
            style={{ "--bp": bpColor(bp) } as CSSProperties}
          >
            <i>BP</i>
            <b>{bp.toLocaleString("en-US")}</b>
          </span>
          {/* 第几张 / 这张卡累计抽出数；图鉴、预览这类没有实例的卡留空 span，三栏网格才不会错位 */}
          <span className="cf__no" title={card.serial ? `第 ${card.serial} 张 / 共抽出 ${card.pulled ?? card.serial} 张` : undefined}>
            {card.serial ? `#${card.serial}/${Math.max(card.pulled ?? 0, card.serial)}` : null}
          </span>
        </footer>
      </div>

      {card.foil && <CardFoil seed={card.id} />}
    </div>
  )
})

export function JobGlyph({ job }: { job: Job }) {
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.85,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const

  switch (job) {
    case "tank":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M12 3.4l7 2.3v6.1c0 4-3 7.2-7 8.8-4-1.6-7-4.8-7-8.8V5.7z" {...line} />
        </svg>
      )
    case "warrior":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M14.5 4.2l5.3 5.3-9.8 9.8-5.3-5.3z" {...line} />
          <path d="M18.2 5.8l2-2M4.2 19.8l2.5-2.5" {...line} />
        </svg>
      )
    case "mage":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M12 3.6l1.8 6 6.6 1.8-6.6 1.8-1.8 6-1.8-6L3.6 11.4l6.6-1.8z" {...line} />
        </svg>
      )
    case "support":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M9.6 3.6h4.8v6h6v4.8h-6v6h-4.8v-6h-6v-4.8h6z" {...line} />
        </svg>
      )
  }
}

export function ElementGlyph({ element }: { element: Element }) {
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.85,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const

  switch (element) {
    case "metal":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M5 9h14l-2.4 9H7.4z" {...line} />
          <path d="M9 9V6h6v3" {...line} />
        </svg>
      )
    case "wood":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M5 19c1.6-8 6-12.6 14-14-.8 8.6-5 12.6-14 14z" {...line} />
          <path d="M8 16c2-3.6 4.4-6 7.6-8" {...line} />
        </svg>
      )
    case "earth":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M3 19h18l-6.4-11-4 7-2.8-3.6z" {...line} />
        </svg>
      )
    case "ice":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" {...line} />
          <path d="M12 3l-2.2 2.4M12 3l2.2 2.4M12 21l-2.2-2.4M12 21l2.2-2.4" {...line} />
        </svg>
      )
    case "fire":
      return (
        <svg viewBox="0 0 24 24">
          <path
            d="M12 3.4c2.6 3.8 5.6 5.8 5.6 9.4a5.6 5.6 0 0 1-11.2 0c0-2.4 1.4-3.9 2.8-5.6.4 1.6 1.1 2.4 1.9 2.4-.9-2.4-.3-4.8 1-6.2z"
            {...line}
          />
        </svg>
      )
    case "thunder":
      return (
        <svg viewBox="0 0 24 24">
          <path
            d="M4 9.5h11.5a2.5 2.5 0 1 0-2.3-3.5M3 13h14.5a2.5 2.5 0 1 1-2.3 3.5M5 16.5h6.5"
            {...line}
          />
        </svg>
      )
    case "light":
      return (
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4.2" {...line} />
          <path d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3M5.4 5.4l2 2M16.6 16.6l2 2M18.6 5.4l-2 2M7.4 16.6l-2 2" {...line} />
        </svg>
      )
    case "dark":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M15.2 4.2a8.2 8.2 0 1 0 4.8 11.4A6.8 6.8 0 0 1 15.2 4.2z" {...line} />
        </svg>
      )
    case "physical":
      return (
        <svg viewBox="0 0 24 24">
          <path
            d="M18.8 4.2l1 1-9.2 9.2-2-2z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M6.4 14.2l3.4 3.4M4.8 19.2l3-3" {...line} />
        </svg>
      )
  }
}
