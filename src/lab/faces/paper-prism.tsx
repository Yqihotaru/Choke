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
import "./paper-prism.css"

export const faceMeta = {
  id: "paper-prism",
  label: "Gemini v3 · Paper & Prism",
  note: "浅色卡纸 + 居中头像 + 磨砂名牌坞",
  order: 20,
} as const

interface Props {
  card: CardFaceData
  className?: string
  /** 书里的邻页提前加载，避免翻过去时才开始请求插画 */
  eager?: boolean
}

/**
 * 纸质卡面 v3 — 实体明丽典藏版。
 * 分区从上到下：
 * 顶栏（品阶徽记 / 品阶名 / Lv / MOD 三槽）
 * → 音游舞台画幅（Banner 或虚化头像 + 程序化 osu! 圆环底纹 + 40cqw 专辑式主头像 + 底部磨砂名牌坞）
 * → 技能行（1–3 行，属性色条 / 图标 / 技能名 / MP+AP）
 * → 底栏（职业 / BP / 版权微印 / 编号）。
 */
export const CardFaceGemini = memo(function CardFaceGemini({
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
      className={cn("cfg", className)}
      data-rarity={card.rarity}
      data-foil={card.foil ? "true" : undefined}
    >
      <div className="cfg__stock" aria-hidden />
      <div className="cfg__sheen" aria-hidden />
      <div className="cfg__bezel" aria-hidden />

      <div className="cfg__content">
        <header className="cfg__head">
          <span className="cfg__seal" title={RARITY_LABEL[card.rarity]}>
            <i className="cfg__emblem" />
          </span>

          <div className="cfg__grade">
            <span className="cfg__rarity">{RARITY_LABEL[card.rarity]}</span>
            <span className="cfg__lv">
              <i>Lv</i>
              <b>{card.level}</b>
              {card.isHero && <em className="cfg__hero">HERO</em>}
            </span>
          </div>

          <div className="cfg__mods">
            {[0, 1, 2].map((slot) => {
              if (modOverflow && slot === 2) {
                return (
                  <span className="cfg__mod cfg__mod--more" key={slot}>
                    +{card.mods.length - 2}
                  </span>
                )
              }
              const mod = mods[slot]
              return mod ? (
                <span
                  className="cfg__mod cfg__mod--on"
                  key={slot}
                  style={{ "--mod": MOD_COLOR[mod] } as CSSProperties}
                >
                  {mod}
                </span>
              ) : (
                <span className="cfg__mod" key={slot} aria-hidden />
              )
            })}
          </div>
        </header>

        <div className="cfg__art">
          <div className="cfg__window">
            {/* 背景层：有 Banner 用 Banner，没 Banner 用头像色块晕染 + osu! 几何纹 */}
            {(card.banner || card.art) && (
              <img
                className={cn(
                  "cfg__banner",
                  !card.banner && "cfg__banner--blur"
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

            {/* 程序化 osu! 谱面几何底纹：无需外部图，解决 95% 卡无 Banner 时的空洞感 */}
            <OsuBeatmapMotif hasBanner={Boolean(card.banner)} />

            {/* 居中专辑视窗头像 */}
            <div className="cfg__stage">
              <div className="cfg__avatar">
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

            {/* 底部磨砂名牌坞：名字 / 国旗 / 排名 / PP / 命座整合在画框底部 */}
            <div className="cfg__dock">
              <div className="cfg__dock-top">
                <div className="cfg__name-wrap">
                  {card.profileUrl ? (
                    <a
                      className="cfg__name"
                      href={card.profileUrl}
                      title={card.name}
                      target="_blank"
                      rel="noreferrer"
                      style={nameStyle}
                    >
                      {card.name}
                    </a>
                  ) : (
                    <h3 className="cfg__name" title={card.name} style={nameStyle}>
                      {card.name}
                    </h3>
                  )}
                </div>

                <div
                  className="cfg__stars"
                  aria-label={`命座 ${card.constellation}`}
                >
                  {starStates(card).map((state, i) => (
                    <i className="cfg__star" data-state={state} key={i} />
                  ))}
                </div>
              </div>

              {(card.country || card.globalRank != null || card.pp != null) && (
                <div className="cfg__meta">
                  {(card.country || card.globalRank != null) && (
                    <span className="cfg__meta-item">
                      {flag && (
                        <img
                          className="cfg__flag"
                          src={flag}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                        />
                      )}
                      <b>
                        {card.globalRank != null
                          ? `#${card.globalRank.toLocaleString("en-US")}`
                          : card.country}
                      </b>
                    </span>
                  )}
                  {card.globalRank != null && card.pp != null && (
                    <span className="cfg__dot" aria-hidden>
                      ·
                    </span>
                  )}
                  {card.pp != null && (
                    <span className="cfg__meta-item">
                      <b>{Math.round(card.pp).toLocaleString("en-US")}</b>
                      <i>pp</i>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="cfg__skills">
          {card.skills.slice(0, 3).map((skill, i) => (
            <div
              className="cfg__skill"
              key={i}
              style={{ "--el": ELEMENT_COLOR[skill.element] } as CSSProperties}
            >
              <span
                className="cfg__el"
                title={ELEMENT_LABEL[skill.element]}
              >
                <ElementGlyph element={skill.element} />
              </span>
              <span className="cfg__skill-name">{skill.name}</span>
              <span className="cfg__cost">
                {skill.mp !== undefined && (
                  <span className="cfg__mp" title="MP">
                    {skill.mp}
                  </span>
                )}
                {skill.passive ? (
                  <span className="cfg__passive">PAS</span>
                ) : (
                  <span className="cfg__ap" title="AP">
                    {skill.ap}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>

        <footer className="cfg__foot">
          <span className="cfg__job" title={JOB_LABEL[card.job]}>
            <JobGlyph job={card.job} />
          </span>
          <span
            className="cfg__bp"
            style={{ "--bp": bpColor(bp) } as CSSProperties}
          >
            <i>BP</i>
            <b>{bp.toLocaleString("en-US")}</b>
          </span>
          <span className="cfg__imprint" aria-hidden>
            CHOKE! TCG · 2026
          </span>
          <span className="cfg__no">{formatNo(card.no, card.total)}</span>
        </footer>
      </div>

      {card.foil && (
        <div
          className="cfg__foil"
          style={{ "--seed": hashOf(card.id) % 97 } as CSSProperties}
          aria-hidden
        >
          <i className="cfg__foil-film" />
          <i className="cfg__foil-dodge" />
          <i className="cfg__foil-glitter" />
          <i className="cfg__foil-glitter cfg__foil-glitter--b" />
          <i className="cfg__foil-glare" />
          <i className="cfg__foil-sweep" />
        </div>
      )}
    </div>
  )
})

function OsuBeatmapMotif({ hasBanner }: { hasBanner: boolean }) {
  return (
    <svg
      className={cn("cfg__motif", hasBanner && "cfg__motif--subtle")}
      viewBox="0 0 200 140"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      {/* 音游打击圆与滑条轨道底纹 */}
      <circle
        cx="100"
        cy="62"
        r="46"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeDasharray="3 3"
      />
      <circle
        cx="100"
        cy="62"
        r="58"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.5"
        opacity="0.6"
      />
      <path
        d="M -10 108 C 40 72, 62 24, 100 62 S 164 96, 212 34"
        fill="none"
        stroke="currentColor"
        strokeWidth="12"
        strokeLinecap="round"
        opacity="0.14"
      />
      <path
        d="M -10 108 C 40 72, 62 24, 100 62 S 164 96, 212 34"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinecap="round"
        opacity="0.45"
      />
      {/* 角落精密十字准星 */}
      <path
        d="M 12 10 v 6 M 9 13 h 6 M 188 10 v 6 M 185 13 h 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.75"
        opacity="0.55"
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

export default CardFaceGemini
