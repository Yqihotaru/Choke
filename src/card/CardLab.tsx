import { useEffect, useState, type ReactNode } from "react"

import type { ModPlacement } from "./CardFaceB"
import { DEMO_CARDS, RARITY_LABEL, makeCard } from "./data"
import { CARD_FACES, DEFAULT_FACE, HISTORY_FACES, getCardFace } from "./faces"
import type { CardFaceData, CardFaceMode } from "./types"
import "./card-lab.css"

function FaceView({
  style,
  card,
  mode,
  theme,
  className,
  mods,
}: {
  style: string
  card: CardFaceData
  mode?: CardFaceMode
  theme?: "dark" | "light"
  className?: string
  mods?: ModPlacement
}) {
  const Face = getCardFace(style).Component
  return <Face card={card} mode={mode} theme={theme} modPlacement={mods} className={className} />
}

const MOD_OPTIONS: { id: ModPlacement; label: string }[] = [
  { id: "spine", label: "MOD · A 侧栏" },
  { id: "portrait", label: "MOD · B 头像角" },
  { id: "name", label: "MOD · C 名字后" },
]

const HERO_SKILLS = [
  { name: "起手式", element: "physical", ap: 1 },
  { name: "破空", element: "thunder", ap: 2 },
  { name: "回响", element: "light", ap: 2, mp: 4 },
] as const

const HEROES: CardFaceData[] = [1, 4, 7, 10, 12].map((level) =>
  makeCard({
    id: `hero-${level}`,
    name: "No.1",
    rarity: "Prismatic",
    job: "warrior",
    level,
    constellation: level,
    mods: ["HD"],
    no: 1,
    isHero: true,
    skills: [...HERO_SKILLS],
  })
)

const SOLO_SKILL: CardFaceData = makeCard({
  id: "solo-skill",
  name: "Sotarks",
  rarity: "E",
  job: "tank",
  level: 33,
  constellation: 0,
  mods: [],
  no: 1533,
  skills: [{ name: "铁壁", element: "earth", ap: 1 }],
})

export function CardLab() {
  const [bg, setBg] = useState<"dark" | "light">("dark")
  const params = new URLSearchParams(window.location.search)
  const [faceStyle, setFaceStyle] = useState<string>(() => {
    const value = params.get("style")
    const legacy = value === "v1" ? "star-860820f" : value === "gemini" ? "paper-prism" : value
    return legacy && CARD_FACES.some((face) => face.id === legacy)
      ? legacy
      : DEFAULT_FACE.id
  })
  const [theme, setTheme] = useState<"dark" | "light">(
    params.get("theme") === "light" ? "light" : "dark",
  )
  const [mods, setMods] = useState<ModPlacement>(() => {
    const value = params.get("mods")
    // 默认和游戏一致：MOD 在名字后
    return MOD_OPTIONS.find((option) => option.id === value)?.id ?? "name"
  })
  const currentFace = getCardFace(faceStyle)
  const v52 = CARD_FACES.find((face) => face.id === "night-obi-52")
  const V52 = v52?.Component
  const embed = params.get("embed") === "1"

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set("style", faceStyle)
    url.searchParams.set("theme", theme)
    url.searchParams.set("mods", mods)
    window.history.replaceState(null, "", url)
  }, [faceStyle, theme, mods])

  useEffect(() => {
    if (!embed) return
    const prev = document.body.style.background
    document.body.style.background = "transparent"
    return () => {
      document.body.style.background = prev
    }
  }, [embed])

  const solo = params.get("solo")
  if (solo !== null) {
    const index = Number(solo)
    const base = DEMO_CARDS[index] ?? DEMO_CARDS[4]
    const card = params.get("foil") === "1" ? { ...base, foil: true } : base
    const width = Math.min(Math.max(Number(params.get("w")) || 480, 240), 960)
    const battle = params.get("mode") === "battle"
    const guides = params.get("guides") === "1"

    if (embed) {
      return (
        <div style={{ width: "100%", padding: 0 }}>
          <FaceView mods={mods} style={faceStyle} theme={theme} card={card} mode={battle ? "battle" : "collection"} />
        </div>
      )
    }

    return (
      <div className="lab lab--solo" data-bg="dark">
        <div style={{ width }}>
          <FaceView mods={mods} style={faceStyle}
            card={card}
            mode={battle ? "battle" : "collection"}
            theme={theme}
            className={guides ? "cf--guides" : undefined}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="lab" data-bg={bg}>
      <header className="lab__bar">
        <div>
          <div className="lab__eyebrow">CHOKE! · CARD FACE</div>
          <h1 className="lab__title">卡面实验室 v0.1</h1>
          <p className="lab__sub">
            2:3 竖版 · {CARD_FACES.length} 个卡面版本自动加载 · 稀有度看材质和工艺 · BP 是唯一战力数字
          </p>
        </div>
        <div className="lab__actions">
          {currentFace.supportsModPlacement && (
            <div className="lab__mod-options" role="group" aria-label="MOD 位置">
              {MOD_OPTIONS.map((option) => (
                <button type="button" key={option.id} className="lab__toggle"
                  aria-pressed={mods === option.id} data-on={mods === option.id || undefined}
                  onClick={() => setMods(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <label className="lab__face-select">
            <span>卡面</span>
            <select
              className="lab__toggle"
              value={faceStyle}
              onChange={(e) => setFaceStyle(e.target.value)}
            >
              <optgroup label="游戏中">
                <option value={DEFAULT_FACE.id}>{DEFAULT_FACE.label}</option>
              </optgroup>
              <optgroup label="历史版本">
                {HISTORY_FACES.map((face) => (
                  <option key={face.id} value={face.id}>
                    {face.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <button
            type="button"
            className="lab__toggle"
            disabled={!currentFace.supportsTheme}
            onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
            title={
              currentFace.supportsTheme
                ? "切换当前卡面的明暗主题"
                : "当前卡面没有明暗主题"
            }
          >
            {theme === "dark" ? "主题：暗" : "主题：亮"}
          </button>
          <button
            type="button"
            className="lab__toggle"
            onClick={() => setBg((v) => (v === "dark" ? "light" : "dark"))}
          >
            {bg === "dark" ? "浅色底" : "深色底"}
          </button>
        </div>
      </header>

      <Section
        label="版本对比"
        note={`游戏里用的是 ${DEFAULT_FACE.label}；其余 ${HISTORY_FACES.length} 个是历史版本，自动扫描 src/card/faces/，点卡面下拉框可以切到任意一个看下面的细节。`}
      >
        <div className="lab__row lab__row--baseline">
          <div className="lab__slot" style={{ width: 200 }}>
            <DEFAULT_FACE.Component card={DEMO_CARDS[4]} theme={theme} modPlacement={mods} />
            <span className="lab__tag">{DEFAULT_FACE.label} · 游戏中</span>
          </div>
        </div>
        <details className="lab__history">
          <summary>历史版本（{HISTORY_FACES.length}）</summary>
          <div className="lab__row lab__row--baseline">
            {HISTORY_FACES.map((face) => {
              const Face = face.Component
              return (
                <div className="lab__slot" style={{ width: 200 }} key={face.id}>
                  <Face card={DEMO_CARDS[4]} theme={theme} modPlacement={mods} />
                  <span className="lab__tag">{face.label}</span>
                </div>
              )
            })}
          </div>
        </details>
      </Section>

      {currentFace.supportsModPlacement && (
        <Section label="MOD 三种摆法" note="普通卡与本体卡并排比较：侧栏六边形 / 头像角标 / 名字胶囊；两版 B 都支持。">
          <div className="lab__row">
            {[DEMO_CARDS[4], HEROES[2]].flatMap((card) =>
              MOD_OPTIONS.map((option) => (
                <div className="lab__slot" style={{ width: 240 }} key={`${card.id}-${option.id}`}>
                  <FaceView style={faceStyle} theme={theme} mods={option.id} card={card} />
                  <span className="lab__tag">{card.isHero ? "HERO · " : ""}{option.label}</span>
                </div>
              )),
            )}
          </div>
        </Section>
      )}

      {V52 && faceStyle === v52.id && (
        <Section
          label="v5.2 明暗主题"
          note="同一个组件，theme='dark' / theme='light'。右上角按钮只影响当前选中的卡面。"
        >
          <div className="lab__row lab__row--baseline">
            <div className="lab__slot" style={{ width: 220 }}>
              <V52 card={DEMO_CARDS[4]} theme="dark" />
              <span className="lab__tag">暗色</span>
            </div>
            <div className="lab__slot" style={{ width: 220 }}>
              <V52 card={DEMO_CARDS[4]} theme="light" />
              <span className="lab__tag">亮色</span>
            </div>
          </div>
        </Section>
      )}

      <Section
        label="七档材质"
        note="七档稀有度在当前选中卡面上的样子。"
      >
        <div className="lab__row">
          {DEMO_CARDS.map((card) => (
            <div className="lab__slot" style={{ width: 200 }} key={card.id}>
              <FaceView mods={mods} style={faceStyle} theme={theme} card={card} />
              <span className="lab__tag">{RARITY_LABEL[card.rarity]}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section label="闪卡" note="闪卡膜所有卡面共用（CardFoil）：鼠标移上去彩带和闪粉跟着光走，静止时每 9 秒扫过一道彩光。">
        <div className="lab__row">
          {DEMO_CARDS.map((card) => (
            <div className="lab__slot" style={{ width: 200 }} key={card.id}>
              <FaceView mods={mods} style={faceStyle} theme={theme} card={{ ...card, id: `${card.id}-foil`, foil: true }} />
              <span className="lab__tag">{RARITY_LABEL[card.rarity]} · FOIL</span>
            </div>
          ))}
        </div>
      </Section>

      <Section label="三档尺寸" note="100px 上场 / 200px 卡册 / 360px 全屏详情">
        <div className="lab__row lab__row--baseline">
          <div className="lab__slot" style={{ width: 100 }}>
            <FaceView mods={mods} style={faceStyle} theme={theme} card={DEMO_CARDS[4]} mode="battle" />
            <span className="lab__tag">100 · 战斗态</span>
          </div>
          <div className="lab__slot" style={{ width: 140 }}>
            <FaceView mods={mods} style={faceStyle} theme={theme} card={DEMO_CARDS[4]} />
            <span className="lab__tag">140 · 卡册</span>
          </div>
          <div className="lab__slot" style={{ width: 220 }}>
            <FaceView mods={mods} style={faceStyle} theme={theme} card={DEMO_CARDS[4]} />
            <span className="lab__tag">220 · 网格</span>
          </div>
          <div className="lab__slot" style={{ width: 360 }}>
            <FaceView mods={mods} style={faceStyle} theme={theme} card={DEMO_CARDS[4]} />
            <span className="lab__tag">360 · 详情</span>
          </div>
        </div>
      </Section>

      <Section label="战斗态" note="顶栏与底栏淡出，只留立绘与技能行；血量条在卡牌下方单独渲染">
        <div className="lab__row">
          <div className="lab__slot" style={{ width: 120 }}>
            <FaceView mods={mods} style={faceStyle} theme={theme} card={DEMO_CARDS[3]} mode="battle" />
            <span className="lab__tag">120</span>
          </div>
          <div className="lab__slot" style={{ width: 200 }}>
            <FaceView mods={mods} style={faceStyle} theme={theme} card={DEMO_CARDS[3]} mode="battle" />
            <span className="lab__tag">200</span>
          </div>
        </div>
      </Section>

      <Section label="本体卡 · 命座阶梯" note="六颗星 × 两档 = 12 级；空心 → 铜色 → 虹彩">
        <div className="lab__row">
          {HEROES.map((card) => (
            <div className="lab__slot" style={{ width: 160 }} key={card.id}>
              <FaceView mods={mods} style={faceStyle} theme={theme} card={card} />
              <span className="lab__tag">Lv {card.level}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section label="字段取舍" note="技能少的卡插画窗自动拉高；被动不显示 AP；法系才有 MP；没装 MOD 的槽留空">
        <div className="lab__row">
          <div className="lab__slot" style={{ width: 200 }}>
            <FaceView mods={mods} style={faceStyle} theme={theme} card={SOLO_SKILL} />
            <span className="lab__tag">单技能</span>
          </div>
          <div className="lab__slot" style={{ width: 200 }}>
            <FaceView mods={mods} style={faceStyle} theme={theme} card={DEMO_CARDS[3]} />
            <span className="lab__tag">法系 MP</span>
          </div>
          <div className="lab__slot" style={{ width: 200 }}>
            <FaceView mods={mods} style={faceStyle} theme={theme} card={DEMO_CARDS[2]} />
            <span className="lab__tag">被动 + 三技能</span>
          </div>
          <div className="lab__slot" style={{ width: 200 }}>
            <FaceView mods={mods} style={faceStyle} theme={theme} card={DEMO_CARDS[0]} />
            <span className="lab__tag">无 MOD</span>
          </div>
        </div>
      </Section>
    </div>
  )
}

function Section({
  label,
  note,
  children,
}: {
  label: string
  note: string
  children: ReactNode
}) {
  return (
    <section className="lab__section">
      <div className="lab__section-head">
        <h2>{label}</h2>
        <p>{note}</p>
      </div>
      {children}
    </section>
  )
}
