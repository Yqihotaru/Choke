import { useEffect, useState, type ReactNode } from "react"

import { CardFace } from "./CardFace"
import { CardFaceV1 } from "./CardFaceV1"
import { DEMO_CARDS, RARITY_LABEL, makeCard } from "./data"
import type { CardFaceData, CardFaceMode } from "./types"
import "./card-lab.css"

type FaceStyle = "current" | "v1"

function FaceView({
  style,
  card,
  mode,
  className,
}: {
  style: FaceStyle
  card: CardFaceData
  mode?: CardFaceMode
  className?: string
}) {
  return style === "v1" ? (
    <CardFaceV1 card={card} mode={mode} className={className} />
  ) : (
    <CardFace card={card} mode={mode} className={className} />
  )
}

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
  const [faceStyle, setFaceStyle] = useState<FaceStyle>(
    params.get("style") === "v1" ? "v1" : "current",
  )
  const embed = params.get("embed") === "1"

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
          <FaceView style={faceStyle} card={card} mode={battle ? "battle" : "collection"} />
        </div>
      )
    }

    return (
      <div className="lab lab--solo" data-bg="dark">
        <div style={{ width }}>
          <FaceView style={faceStyle}
            card={card}
            mode={battle ? "battle" : "collection"}
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
            2:3 竖版 · 统一黑卡纸 · 稀有度看线条颜色和工艺 · BP 是唯一战力数字
          </p>
        </div>
        <div className="lab__actions">
          <button
            type="button"
            className="lab__toggle"
            onClick={() => setFaceStyle((v) => (v === "current" ? "v1" : "current"))}
          >
            {faceStyle === "current" ? "切到星章版" : "切到当前版"}
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
        note="左：当前 handoff 材料版。右：星章版（860820f），左上角是星形稀有度徽章，下面有独立命座星条。"
      >
        <div className="lab__row lab__row--baseline">
          <div className="lab__slot" style={{ width: 220 }}>
            <CardFace card={DEMO_CARDS[4]} />
            <span className="lab__tag">当前版 · handoff</span>
          </div>
          <div className="lab__slot" style={{ width: 220 }}>
            <CardFaceV1 card={DEMO_CARDS[4]} />
            <span className="lab__tag">星章版 · 860820f</span>
          </div>
        </div>
      </Section>

      <Section label="七档材质" note="石墨墨 / 翡翠墨 / 烫钢蓝 / 烫紫+压纹 / 烫金 / 烫铂+珠光 / 镭射线+镭射纸；把鼠标移到卡上看反光">
        <div className="lab__row">
          {DEMO_CARDS.map((card) => (
            <div className="lab__slot" style={{ width: 200 }} key={card.id}>
              <FaceView style={faceStyle} card={card} />
              <span className="lab__tag">{RARITY_LABEL[card.rarity]}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section label="闪卡" note="任何稀有度都能叠的一层淡镭射膜；只有迎着光的地方出彩带和碎闪，静止时偶尔扫一道光">
        <div className="lab__row">
          {DEMO_CARDS.map((card) => (
            <div className="lab__slot" style={{ width: 200 }} key={card.id}>
              <FaceView style={faceStyle} card={{ ...card, id: `${card.id}-foil`, foil: true }} />
              <span className="lab__tag">{RARITY_LABEL[card.rarity]} · FOIL</span>
            </div>
          ))}
        </div>
      </Section>

      <Section label="三档尺寸" note="100px 上场 / 200px 卡册 / 360px 全屏详情">
        <div className="lab__row lab__row--baseline">
          <div className="lab__slot" style={{ width: 100 }}>
            <FaceView style={faceStyle} card={DEMO_CARDS[4]} mode="battle" />
            <span className="lab__tag">100 · 战斗态</span>
          </div>
          <div className="lab__slot" style={{ width: 140 }}>
            <FaceView style={faceStyle} card={DEMO_CARDS[4]} />
            <span className="lab__tag">140 · 卡册</span>
          </div>
          <div className="lab__slot" style={{ width: 220 }}>
            <FaceView style={faceStyle} card={DEMO_CARDS[4]} />
            <span className="lab__tag">220 · 网格</span>
          </div>
          <div className="lab__slot" style={{ width: 360 }}>
            <FaceView style={faceStyle} card={DEMO_CARDS[4]} />
            <span className="lab__tag">360 · 详情</span>
          </div>
        </div>
      </Section>

      <Section label="战斗态" note="顶栏与底栏淡出，只留立绘与技能行；血量条在卡牌下方单独渲染">
        <div className="lab__row">
          <div className="lab__slot" style={{ width: 120 }}>
            <FaceView style={faceStyle} card={DEMO_CARDS[3]} mode="battle" />
            <span className="lab__tag">120</span>
          </div>
          <div className="lab__slot" style={{ width: 200 }}>
            <FaceView style={faceStyle} card={DEMO_CARDS[3]} mode="battle" />
            <span className="lab__tag">200</span>
          </div>
        </div>
      </Section>

      <Section label="本体卡 · 命座阶梯" note="六颗星 × 两档 = 12 级；空心 → 铜色 → 虹彩">
        <div className="lab__row">
          {HEROES.map((card) => (
            <div className="lab__slot" style={{ width: 160 }} key={card.id}>
              <FaceView style={faceStyle} card={card} />
              <span className="lab__tag">Lv {card.level}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section label="字段取舍" note="技能少的卡插画窗自动拉高；被动不显示 AP；法系才有 MP；没装 MOD 的槽留空">
        <div className="lab__row">
          <div className="lab__slot" style={{ width: 200 }}>
            <FaceView style={faceStyle} card={SOLO_SKILL} />
            <span className="lab__tag">单技能</span>
          </div>
          <div className="lab__slot" style={{ width: 200 }}>
            <FaceView style={faceStyle} card={DEMO_CARDS[3]} />
            <span className="lab__tag">法系 MP</span>
          </div>
          <div className="lab__slot" style={{ width: 200 }}>
            <FaceView style={faceStyle} card={DEMO_CARDS[2]} />
            <span className="lab__tag">被动 + 三技能</span>
          </div>
          <div className="lab__slot" style={{ width: 200 }}>
            <FaceView style={faceStyle} card={DEMO_CARDS[0]} />
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
