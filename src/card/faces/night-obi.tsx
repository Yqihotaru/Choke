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
} from "../data"
import { trackCardLight } from "../light"
import type { CardFaceData, CardFaceMode, Element, Job } from "../types"
import "./night-obi.css"

export const faceMeta = {
  id: "night-obi",
  label: "暗夜腰封 v5",
  note: "深色卡基 + 14cqw 腰封 + 战术海报",
  order: 40,
} as const

interface Props {
  card: CardFaceData
  mode?: CardFaceMode
  className?: string
  eager?: boolean
}

/**
 * 卡面 v5 — 暗夜黑胶腰封 × 音游战术海报
 * · 全 7 档采用深色宝石/金属卡基，高对比烫印与镭射闪膜；
 * · 左侧 14cqw 精简腰封（品阶章 / 竖排品阶 / 职业 / 编号）；
 * · 顶部 Banner 承载大号 Lv 与横排 MOD 胶囊，并在技能较少时自动舒展高度；
 * · 42cqw 大头像 + 醒目 Rank/PP/BP 看板 + 暗玻璃技能条。
 */
export const CardFaceNightObi = memo(function CardFaceNightObi({
  card,
  mode = "collection",
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
      className={cn("cfn", className)}
      data-rarity={card.rarity}
      data-mode={mode}
      data-foil={card.foil ? "true" : undefined}
    >
      <div className="cfn__stock" aria-hidden />
      <div className="cfn__sheen" aria-hidden />

      <div className="cfn__layout">
        {/* 左侧精简黑胶腰封（14cqw） */}
        <aside className="cfn__obi">
          <span className="cfn__seal" title={RARITY_LABEL[card.rarity]}>
            <i className="cfn__emblem" />
          </span>

          <div className="cfn__obi-mid">
            <span className="cfn__rarity">{RARITY_LABEL[card.rarity]}</span>
            {card.isHero && <em className="cfn__hero">HERO</em>}
          </div>

          <div className="cfn__obi-foot">
            <span className="cfn__job" title={JOB_LABEL[card.job]}>
              <JobGlyph job={card.job} />
            </span>
            <span className="cfn__no">{formatNo(card.no, card.total)}</span>
          </div>
        </aside>

        {/* 右侧暗黑海报主画幅（86cqw） */}
        <main className="cfn__poster">
          {/* 顶部自适应 Banner + 大号 Lv / MOD 战术条 */}
          <div className="cfn__cover">
            {(card.banner || card.art) && (
              <img
                className={cn(
                  "cfn__banner",
                  !card.banner && "cfn__banner--blur"
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
              <span className="cfn__watermark" aria-hidden>
                #{card.globalRank.toLocaleString("en-US")}
              </span>
            )}

            <div className="cfn__cover-top">
              <span className="cfn__lv">
                <i>LV</i>
                <b>{card.level}</b>
              </span>

              <div className="cfn__mods">
                {[0, 1, 2].map((slot) => {
                  if (modOverflow && slot === 2) {
                    return (
                      <span className="cfn__mod cfn__mod--more" key={slot}>
                        +{card.mods.length - 2}
                      </span>
                    )
                  }
                  const mod = mods[slot]
                  return mod ? (
                    <span
                      className="cfn__mod cfn__mod--on"
                      key={slot}
                      style={{ "--mod": MOD_COLOR[mod] } as CSSProperties}
                    >
                      {mod}
                    </span>
                  ) : (
                    <span className="cfn__mod" key={slot} aria-hidden />
                  )
                })}
              </div>
            </div>

            <span className="cfn__series" aria-hidden>
              CHOKE! · S26
            </span>
          </div>

          {/* 破界大头像 + 高可读数据看板 */}
          <div className="cfn__hero-row">
            <div className="cfn__avatar">
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
              <i className="cfn__approach" aria-hidden />
            </div>

            <div className="cfn__hud">
              <div className="cfn__rank-line">
                {flag && (
                  <img
                    className="cfn__flag"
                    src={flag}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                )}
                <b className="cfn__rank">
                  {card.globalRank != null
                    ? `#${card.globalRank.toLocaleString("en-US")}`
                    : card.country || "OSU!"}
                </b>
              </div>

              {card.pp != null && (
                <div className="cfn__pp">
                  <b>{Math.round(card.pp).toLocaleString("en-US")}</b>
                  <i>PP</i>
                </div>
              )}

              <div
                className="cfn__stars"
                aria-label={`命座 ${card.constellation}`}
              >
                {starStates(card).map((state, i) => (
                  <i className="cfn__star" data-state={state} key={i} />
                ))}
              </div>

              <div
                className="cfn__bp"
                style={{ "--bp": bpColor(bp) } as CSSProperties}
              >
                <i>BP</i>
                <b>{bp.toLocaleString("en-US")}</b>
              </div>
            </div>
          </div>

          {/* 战斗模式精简头像区 */}
          <div className="cfn__battle-stage" aria-hidden={mode !== "battle"}>
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

          {/* 大号玩家名 + 金属流光分割线 */}
          <div className="cfn__title">
            {card.profileUrl ? (
              <a
                className="cfn__name"
                href={card.profileUrl}
                title={card.name}
                target="_blank"
                rel="noreferrer"
                style={nameStyle}
              >
                {card.name}
              </a>
            ) : (
              <h3 className="cfn__name" title={card.name} style={nameStyle}>
                {card.name}
              </h3>
            )}
            <span className="cfn__title-rule" aria-hidden />
          </div>

          {/* 暗玻璃加厚技能条 */}
          <div className="cfn__skills">
            {card.skills.slice(0, 3).map((skill, i) => (
              <div
                className="cfn__skill"
                key={i}
                style={{ "--el": ELEMENT_COLOR[skill.element] } as CSSProperties}
              >
                <span className="cfn__el" title={ELEMENT_LABEL[skill.element]}>
                  <ElementGlyph element={skill.element} />
                </span>
                <span className="cfn__skill-name">{skill.name}</span>
                <span className="cfn__cost">
                  {skill.mp !== undefined && (
                    <span className="cfn__mp" title="MP">
                      {skill.mp}
                    </span>
                  )}
                  {skill.passive ? (
                    <span className="cfn__passive">PAS</span>
                  ) : (
                    <span className="cfn__ap" title="AP">
                      {skill.ap}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <footer className="cfn__colophon" aria-hidden>
            <span>CHOKE! TRADING CARD</span>
            <span>SERIES 2026</span>
          </footer>
        </main>
      </div>

      <div className="cfn__frame" aria-hidden />

      {card.foil && (
        <div
          className="cfn__foil"
          style={{ "--seed": hashOf(card.id) % 97 } as CSSProperties}
          aria-hidden
        >
          <i className="cfn__foil-film" />
          <i className="cfn__foil-dodge" />
          <i className="cfn__foil-glitter" />
          <i className="cfn__foil-glitter cfn__foil-glitter--b" />
          <i className="cfn__foil-glare" />
          <i className="cfn__foil-sweep" />
        </div>
      )}
    </div>
  )
})

function OsuBeatmapMotif({ hasBanner }: { hasBanner: boolean }) {
  return (
    <svg
      className={cn("cfn__motif", hasBanner && "cfn__motif--subtle")}
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

export default CardFaceNightObi
