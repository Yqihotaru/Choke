import { memo, useEffect, useRef, type CSSProperties } from "react"

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
  formatNo,
  hashOf,
  nameSizeOf,
  starStates,
} from "../../card/data"
import { trackCardLight } from "../../card/light"
import type { CardFaceData, Element, Job } from "../../card/types"
import "./obi-poster.css"

export const faceMeta = {
  id: "obi-poster",
  label: "黑胶腰封 v4",
  note: "左侧 18cqw 腰封 + 右侧全景海报",
  order: 30,
} as const

interface Props {
  card: CardFaceData
  className?: string
  eager?: boolean
}

/**
 * 卡面 v4 — 黑胶腰封 × 音游海报（Obi & Beatmap Poster）
 * 左侧 18cqw 贯穿全高的「腰封竖脊」承载品阶/MOD/Lv/职业/编号；
 * 右侧 82cqw 为全景 Banner + 骑跨边界的 1:1 头像 + 数据看板 + 大字标题 + 瑞士网格技能表。
 */
export const CardFaceObi = memo(function CardFaceObi({
  card,
  className,
  eager = false,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(trackCardLight, [])

  useEffect(() => {
    if (!card.foil || !cardRef.current) return

    const element = cardRef.current
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) element.dataset.sweepVisible = ""
        else delete element.dataset.sweepVisible
      },
      { rootMargin: "100px" }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [card.foil])

  const bp = battlePower(card)
  const flag = flagUrl(card.country)
  const modOverflow = card.mods.length > 3
  const mods = modOverflow ? card.mods.slice(0, 2) : card.mods
  const nameStyle = {
    "--name-size": `${nameSizeOf(card.name)}cqw`,
  } as CSSProperties

  return (
    <div
      ref={cardRef}
      className={cn("cfo", className)}
      data-rarity={card.rarity}
      data-foil={card.foil ? "true" : undefined}
    >
      <div className="cfo__stock" aria-hidden />
      <div className="cfo__sheen" aria-hidden />

      <div className="cfo__layout">
        {/* 左侧贯穿全高的黑胶腰封（Obi Spine） */}
        <aside className="cfo__obi">
          <span className="cfo__seal" title={RARITY_LABEL[card.rarity]}>
            <i className="cfo__emblem" />
          </span>

          <div className="cfo__obi-mid">
            <span className="cfo__rarity">{RARITY_LABEL[card.rarity]}</span>
            {card.isHero && <em className="cfo__hero">HERO</em>}
          </div>

          <div className="cfo__mods">
            {[0, 1, 2].map((slot) => {
              if (modOverflow && slot === 2) {
                return (
                  <span className="cfo__mod cfo__mod--more" key={slot}>
                    +{card.mods.length - 2}
                  </span>
                )
              }
              const mod = mods[slot]
              return mod ? (
                <span
                  className="cfo__mod cfo__mod--on"
                  key={slot}
                  style={{ "--mod": MOD_COLOR[mod] } as CSSProperties}
                >
                  {mod}
                </span>
              ) : (
                <span className="cfo__mod" key={slot} aria-hidden />
              )
            })}
          </div>

          <div className="cfo__obi-foot">
            <span className="cfo__lv">
              <i>LV</i>
              <b>{card.level}</b>
            </span>
            <span className="cfo__job" title={JOB_LABEL[card.job]}>
              <JobGlyph job={card.job} />
            </span>
            <span className="cfo__no">{formatNo(card.no, card.total)}</span>
          </div>
        </aside>

        {/* 右侧海报主画幅 */}
        <main className="cfo__poster">
          {/* 全景 Banner 条：符合 osu! 真实宽幅封面比例 */}
          <div className="cfo__cover">
            {(card.banner || card.art) && (
              <img
                className={cn(
                  "cfo__banner",
                  !card.banner && "cfo__banner--blur"
                )}
                src={card.banner || card.art}
                alt=""
                draggable={false}
                loading={eager ? "eager" : "lazy"}
                decoding="async"
                fetchPriority="low"
                referrerPolicy="no-referrer"
              />
            )}
            <OsuBeatmapMotif hasBanner={Boolean(card.banner)} />
            {card.globalRank != null && (
              <span className="cfo__watermark" aria-hidden>
                #{card.globalRank.toLocaleString("en-US")}
              </span>
            )}
            <span className="cfo__series" aria-hidden>
              CHOKE! · S26
            </span>
          </div>

          {/* 破界叠加的头像 + 右侧数据看板 */}
          <div className="cfo__hero-row">
            <div className="cfo__avatar">
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
              <i className="cfo__approach" aria-hidden />
            </div>

            <div className="cfo__hud">
              <div className="cfo__rank-line">
                {flag && (
                  <img
                    className="cfo__flag"
                    src={flag}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                )}
                <b className="cfo__rank">
                  {card.globalRank != null
                    ? `#${card.globalRank.toLocaleString("en-US")}`
                    : card.country || "OSU!"}
                </b>
              </div>

              {card.pp != null && (
                <div className="cfo__pp">
                  <b>{Math.round(card.pp).toLocaleString("en-US")}</b>
                  <i>PP</i>
                </div>
              )}

              <div
                className="cfo__stars"
                aria-label={`命座 ${card.constellation}`}
              >
                {starStates(card).map((state, i) => (
                  <i className="cfo__star" data-state={state} key={i} />
                ))}
              </div>

              <div
                className="cfo__bp"
                style={{ "--bp": bpColor(bp) } as CSSProperties}
              >
                <i>BP</i>
                <b>{bp.toLocaleString("en-US")}</b>
              </div>
            </div>
          </div>

          {/* 大号海报名字栏 */}
          <div className="cfo__title">
            {card.profileUrl ? (
              <a
                className="cfo__name"
                href={card.profileUrl}
                title={card.name}
                target="_blank"
                rel="noreferrer"
                style={nameStyle}
              >
                {card.name}
              </a>
            ) : (
              <h3 className="cfo__name" title={card.name} style={nameStyle}>
                {card.name}
              </h3>
            )}
            <span className="cfo__title-rule" aria-hidden />
          </div>

          {/* 瑞士网格极简技能行 */}
          <div className="cfo__skills">
            {card.skills.slice(0, 3).map((skill, i) => (
              <div
                className="cfo__skill"
                key={i}
                style={{ "--el": ELEMENT_COLOR[skill.element] } as CSSProperties}
              >
                <span className="cfo__el" title={ELEMENT_LABEL[skill.element]}>
                  <ElementGlyph element={skill.element} />
                </span>
                <span className="cfo__skill-name">{skill.name}</span>
                <span className="cfo__cost">
                  {skill.mp !== undefined && (
                    <span className="cfo__mp" title="MP">
                      {skill.mp}
                    </span>
                  )}
                  {skill.passive ? (
                    <span className="cfo__passive">PAS</span>
                  ) : (
                    <span className="cfo__ap" title="AP">
                      {skill.ap}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <footer className="cfo__colophon" aria-hidden>
            <span>CHOKE! TRADING CARD</span>
            <span>SERIES 2026</span>
          </footer>
        </main>
      </div>

      <div className="cfo__frame" aria-hidden />

      {card.foil && (
        <div
          className="cfo__foil"
          style={{ "--seed": hashOf(card.id) % 97 } as CSSProperties}
          aria-hidden
        >
          <i className="cfo__foil-film" />
          <i className="cfo__foil-dodge" />
          <i className="cfo__foil-glitter" />
          <i className="cfo__foil-glitter cfo__foil-glitter--b" />
          <i className="cfo__foil-glare" />
          <i className="cfo__foil-sweep" />
        </div>
      )}
    </div>
  )
})

function OsuBeatmapMotif({ hasBanner }: { hasBanner: boolean }) {
  return (
    <svg
      className={cn("cfo__motif", hasBanner && "cfo__motif--subtle")}
      viewBox="0 0 240 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <path
        d="M -10 78 Q 55 18, 128 52 T 250 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="16"
        strokeLinecap="round"
        opacity="0.16"
      />
      <path
        d="M -10 78 Q 55 18, 128 52 T 250 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
        opacity="0.5"
      />
      <circle
        cx="196"
        cy="42"
        r="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeDasharray="3 3"
        opacity="0.55"
      />
      <circle
        cx="196"
        cy="42"
        r="30"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        opacity="0.35"
      />
    </svg>
  )
}

function JobGlyph({ job }: { job: Job }) {
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

function ElementGlyph({ element }: { element: Element }) {
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

export default CardFaceObi
