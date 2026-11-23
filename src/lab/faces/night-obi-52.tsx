import { memo, useEffect, useId, useRef, type CSSProperties } from "react"

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
import type { CardFaceData, Element, Job, Rarity } from "../../card/types"
import "./night-obi-52.css"

export const faceMeta = {
  id: "night-obi-52",
  label: "暗夜腰封 v5.2",
  note: "固定基线对齐 + 3D 星章 + 六边形 MOD + 明暗双主题",
  order: 45,
  supportsTheme: true,
} as const

interface Props {
  card: CardFaceData
  theme?: "dark" | "light"
  className?: string
  eager?: boolean
}

export const CardFaceNightObi52 = memo(function CardFaceNightObi52({
  card,
  theme = "dark",
  className,
  eager = false,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const uid = useId().replace(/:/g, "")

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
      className={cn("cfn2", className)}
      data-rarity={card.rarity}
      data-theme={theme}
      data-foil={card.foil ? "true" : undefined}
    >
      <div className="cfn2__stock" aria-hidden />
      <div className="cfn2__sheen" aria-hidden />

      <div className="cfn2__layout">
        {/* 左侧精简黑胶腰封 */}
        <aside className="cfn2__obi">
          <span className="cfn2__seal" title={RARITY_LABEL[card.rarity]}>
            <RarityGlyph rarity={card.rarity} uid={uid} />
          </span>

          <div className="cfn2__obi-mid">
            <span className="cfn2__rarity">{RARITY_LABEL[card.rarity]}</span>
            {card.isHero && <em className="cfn2__hero">HERO</em>}
          </div>

          <div className="cfn2__obi-foot">
            <span className="cfn2__job" title={JOB_LABEL[card.job]}>
              <JobGlyph job={card.job} />
            </span>
            <span className="cfn2__no">{formatNo(card.no, card.total)}</span>
          </div>
        </aside>

        {/* 右侧海报主画幅 */}
        <main className="cfn2__poster">
          <div className="cfn2__cover">
            {(card.banner || card.art) && (
              <img
                className={cn(
                  "cfn2__banner",
                  !card.banner && "cfn2__banner--blur"
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
              <span className="cfn2__watermark" aria-hidden>
                #{card.globalRank.toLocaleString("en-US")}
              </span>
            )}

            <div className="cfn2__cover-top">
              <span className="cfn2__lv">
                <i>LV</i>
                <b>{card.level}</b>
              </span>

              <div className="cfn2__mods">
                {[0, 1, 2].map((slot) => {
                  if (modOverflow && slot === 2) {
                    return (
                      <span className="cfn2__mod cfn2__mod--more" key={slot}>
                        <ModHex />
                        <span>+{card.mods.length - 2}</span>
                      </span>
                    )
                  }
                  const mod = mods[slot]
                  return mod ? (
                    <span
                      className="cfn2__mod cfn2__mod--on"
                      key={slot}
                      style={{ "--mod": MOD_COLOR[mod] } as CSSProperties}
                    >
                      <ModHex />
                      <span>{mod}</span>
                    </span>
                  ) : (
                    <span className="cfn2__mod" key={slot} aria-hidden>
                      <ModHex />
                    </span>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 42cqw 大头像 + 右侧数据看板 */}
          <div className="cfn2__hero-row">
            <div className="cfn2__avatar">
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

            <div className="cfn2__hud">
              <div className="cfn2__rank-line">
                {flag && (
                  <img
                    className="cfn2__flag"
                    src={flag}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                )}
                <b className="cfn2__rank">
                  {card.globalRank != null
                    ? `#${card.globalRank.toLocaleString("en-US")}`
                    : card.country || "OSU!"}
                </b>
              </div>

              {card.pp != null && (
                <div className="cfn2__pp">
                  <b>{Math.round(card.pp).toLocaleString("en-US")}</b>
                  <i>PP</i>
                </div>
              )}

              <div
                className="cfn2__stars"
                aria-label={`命座 ${card.constellation}`}
              >
                {starStates(card).map((state, i) => (
                  <StarGlyph state={state} key={i} />
                ))}
              </div>

              <div
                className="cfn2__bp"
                style={{ "--bp": bpColor(bp) } as CSSProperties}
              >
                <i>BP</i>
                <b>{bp.toLocaleString("en-US")}</b>
              </div>
            </div>
          </div>

          <div className="cfn2__title">
            {card.profileUrl ? (
              <a
                className="cfn2__name"
                href={card.profileUrl}
                title={card.name}
                target="_blank"
                rel="noreferrer"
                style={nameStyle}
              >
                {card.name}
              </a>
            ) : (
              <h3 className="cfn2__name" title={card.name} style={nameStyle}>
                {card.name}
              </h3>
            )}
            <span className="cfn2__title-rule" aria-hidden />
          </div>

          <div className="cfn2__skills">
            {card.skills.slice(0, 3).map((skill, i) => (
              <div
                className="cfn2__skill"
                key={i}
                style={{ "--el": ELEMENT_COLOR[skill.element] } as CSSProperties}
              >
                <span className="cfn2__el" title={ELEMENT_LABEL[skill.element]}>
                  <ElementGlyph element={skill.element} />
                </span>
                <span className="cfn2__skill-name">{skill.name}</span>
                <span className="cfn2__cost">
                  {skill.passive ? (
                    <span className="cfn2__passive">PAS</span>
                  ) : (
                    <span className="cfn2__ap" title="AP">
                      {skill.ap}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <footer className="cfn2__colophon" aria-hidden>
            <span>CHOKE! TRADING CARD</span>
            <span>SERIES 2026</span>
          </footer>
        </main>
      </div>

      <div className="cfn2__frame" aria-hidden />

      {card.foil && (
        <div
          className="cfn2__foil"
          style={{ "--seed": hashOf(card.id) % 97 } as CSSProperties}
          aria-hidden
        >
          <i className="cfn2__foil-film" />
          <i className="cfn2__foil-dodge" />
          <i className="cfn2__foil-glitter" />
          <i className="cfn2__foil-glitter cfn2__foil-glitter--b" />
          <i className="cfn2__foil-glare" />
          <i className="cfn2__foil-sweep" />
        </div>
      )}
    </div>
  )
})

function ModHex() {
  return (
    <svg className="cfn2__mod-hex" viewBox="0 0 100 86.6" aria-hidden>
      <polygon
        className="cfn2__mod-bg"
        points="25.5,2 74.5,2 98,43.3 74.5,84.6 25.5,84.6 2,43.3"
      />
      <polygon
        className="cfn2__mod-rim"
        points="25.5,2 74.5,2 98,43.3 74.5,84.6 25.5,84.6 2,43.3"
        fill="none"
      />
    </svg>
  )
}

function RarityGlyph({ rarity, uid }: { rarity: Rarity; uid: string }) {
  const ringGrad = `cf-ring-${uid}`
  const starLight = `cf-slight-${uid}`
  const starDark = `cf-sdark-${uid}`
  const isPrismatic = rarity === "Prismatic"

  return (
    <svg className="cfn2__emblem-svg" viewBox="0 0 100 100" aria-hidden>
      <defs>
        <linearGradient id={ringGrad} x1="0.15" y1="0.08" x2="0.85" y2="0.92">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--accent) 52%, #fff9e6)" />
          <stop offset="52%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--accent) 48%, #15120c)" />
        </linearGradient>

        {isPrismatic ? (
          <>
            <linearGradient id={starLight} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#9cf2dc" />
              <stop offset="50%" stopColor="#b9ccff" />
              <stop offset="100%" stopColor="#f5b3e5" />
            </linearGradient>
            <linearGradient id={starDark} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6a75d6" />
              <stop offset="100%" stopColor="#9e62c7" />
            </linearGradient>
          </>
        ) : (
          <>
            <linearGradient id={starLight} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="color-mix(in srgb, var(--accent) 36%, #ffffff)" />
              <stop offset="100%" stopColor="var(--accent)" />
            </linearGradient>
            <linearGradient id={starDark} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="color-mix(in srgb, var(--accent) 76%, #1e1810)" />
              <stop offset="100%" stopColor="color-mix(in srgb, var(--accent) 42%, #0e0c09)" />
            </linearGradient>
          </>
        )}
      </defs>

      {/* 极简金属圆环底盘（去掉笨重黑框，适配现代暗/浅卡面） */}
      <circle cx="50" cy="50" r="46" fill={`url(#${ringGrad})`} />
      <circle cx="50" cy="50" r="36.5" fill="#0d0e14" />
      <circle
        cx="50"
        cy="50"
        r="32.5"
        fill="none"
        stroke={`url(#${ringGrad})`}
        strokeWidth="1.3"
        opacity="0.72"
      />

      {/* C：同心圆环 */}
      {rarity === "C" && (
        <g>
          <circle
            cx="50"
            cy="50"
            r="16.5"
            fill="none"
            stroke={`url(#${starLight})`}
            strokeWidth="5"
          />
          <circle cx="50" cy="50" r="5.5" fill={`url(#${starLight})`} />
        </g>
      )}

      {/* UC：3D 棱面三角徽记 */}
      {rarity === "UC" && (
        <g>
          <polygon points="50,11 16,72 50,52" fill={`url(#${starLight})`} />
          <polygon points="50,11 84,72 50,52" fill={`url(#${starDark})`} />
          <polygon points="16,72 84,72 50,52" fill={`url(#${starDark})`} opacity="0.82" />
          <polygon points="50,29 66,61 34,61" fill="#0d0e14" opacity="0.44" />
        </g>
      )}

      {/* R：3D 切面菱形宝石 */}
      {rarity === "R" && (
        <g>
          <polygon points="50,11 19,50 50,50" fill={`url(#${starLight})`} />
          <polygon points="50,11 81,50 50,50" fill={`url(#${starDark})`} />
          <polygon points="50,89 81,50 50,50" fill={`url(#${starLight})`} />
          <polygon points="50,89 19,50 50,50" fill={`url(#${starDark})`} />
          <line x1="50" y1="11" x2="50" y2="89" stroke="#0d0e14" strokeWidth="0.9" opacity="0.35" />
          <line x1="19" y1="50" x2="81" y2="50" stroke="#0d0e14" strokeWidth="0.9" opacity="0.35" />
        </g>
      )}

      {/* E：3D 切面四角星芒 */}
      {rarity === "E" && (
        <g>
          {[0, 90, 180, 270].map((deg) => (
            <g key={deg} transform={`rotate(${deg} 50 50)`}>
              <polygon points="50,7 50,50 37.5,37.5" fill={`url(#${starLight})`} />
              <polygon points="50,7 62.5,37.5 50,50" fill={`url(#${starDark})`} />
              <line x1="50" y1="50" x2="50" y2="7" stroke="#0d0e14" strokeWidth="0.7" opacity="0.32" />
            </g>
          ))}
        </g>
      )}

      {/* L / Mythic / Prismatic：尖角压环 3D 切面五角星 */}
      {(rarity === "L" || rarity === "Mythic" || rarity === "Prismatic") && (
        <g>
          {[0, 72, 144, 216, 288].map((deg) => (
            <g key={deg} transform={`rotate(${deg} 50 50)`}>
              <polygon points="50,3.5 50,50 38.8,34.6" fill={`url(#${starLight})`} />
              <polygon points="50,3.5 61.2,34.6 50,50" fill={`url(#${starDark})`} />
              <line
                x1="50"
                y1="50"
                x2="50"
                y2="3.5"
                stroke="#0d0e14"
                strokeWidth="0.7"
                opacity="0.36"
              />
              <line
                x1="50"
                y1="50"
                x2="38.8"
                y2="34.6"
                stroke="#0d0e14"
                strokeWidth="0.6"
                opacity="0.26"
              />
            </g>
          ))}
          <polygon
            points="50,3.5 61.2,34.6 94.5,35.6 68.1,55.9 77.6,87.8 50,69 22.4,87.8 31.9,55.9 5.5,35.6 38.8,34.6"
            fill="none"
            stroke="#0d0e14"
            strokeWidth="1.1"
            strokeLinejoin="round"
            opacity="0.55"
          />
        </g>
      )}
    </svg>
  )
}

function StarGlyph({ state }: { state: "empty" | "copper" | "prism" }) {
  return (
    <svg className="cfn2__star-svg" data-state={state} viewBox="0 0 24 24">
      <path
        d="M12 2.6l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z"
        fill={state === "empty" ? "none" : "currentColor"}
        stroke="currentColor"
        strokeWidth={state === "empty" ? "2" : "0"}
        strokeLinejoin="round"
      />
    </svg>
  )
}

function OsuBeatmapMotif({ hasBanner }: { hasBanner: boolean }) {
  return (
    <svg
      className={cn("cfn2__motif", hasBanner && "cfn2__motif--subtle")}
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
        opacity="0.14"
      />
      <path
        d="M -10 78 Q 55 18, 128 52 T 250 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
        opacity="0.45"
      />
      <circle
        cx="196"
        cy="42"
        r="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeDasharray="3 3"
        opacity="0.45"
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

export default CardFaceNightObi52
