# Choke! 当前游戏卡面模板 · B v2 导出

> 用途：发给 Gemini 做卡面改版。游戏内所有卡面现在都走 `GameCardFace` → `CardFaceB`（B v2 · 大元素）。
> 导出时间：2026-11-18，对应 `master` `a81a5f8`。

## 你要改的是什么

- 唯一入口：`src/card/GameCardFace.tsx`，固定传 `tone="dark"`、`mods="name"`、`version="v2"`。
- 实际渲染组件：`src/card/CardFaceB.tsx`；样式：`src/card/card-face-b.css`。
- 闪卡效果：`src/card/CardFoil.tsx` + `src/card/card-foil.css`。
- 稀有度几何纹样：`src/card/motif.ts`。
- 卡面实验室注册：`src/card/faces/index.ts` + `src/card/faces/b-v2.tsx`。
- `ElementGlyph` / `JobGlyph` 是固定 SVG 图标，不用改，定义在 `src/card/CardFace.tsx` 第 244–360 行。

## 硬约束（改版时必须满足）

1. 卡面 2:3 竖版，卡宽 = 100cqw、卡高 = 150cqw；内部尺寸全部用 `cqw`，不要改成 px。
2. 同一组件要在 100 / 140 / 220 / 380 / 560px 宽度下复用；100px 下允许隐藏次要文字，但不能爆版。
3. 七档稀有度必须只靠颜色也能区分：C / UC / R / E / L / Radiant / Prismatic；L 以上有外发光，Prismatic 是镭射渐变。
4. 支持 `data-tone="dark" | "light"`，只换纸色与墨色，结构不变。
5. 支持三种 MOD 摆法：`spine`（侧栏）/ `portrait`（头像右上）/ `name`（名字后胶囊）；游戏内用 `name`。
6. **没有战斗态**：卡片在任何场景都完整渲染；不要再加“小卡精简版”分支。
7. 支持 `data-foil`（闪卡）与 `data-mirror`（镜像卡）两个数据钩子；镜像卡实际样式还没做，等美术定稿。
8. 卡面只吃 `CardFaceData`，不依赖网络请求；头像/banner 是外部 URL，加载失败要有占位。
9. 不要引入新的运行时依赖；不要用 Tailwind class 写卡面内部（现有实现是纯 CSS + CSS 变量）。
10. 保持 CSS 前缀 `cfb__`，避免和开包卡背 `cb__` 冲突。

## 数据契约

`CardFaceData` 见下方 `src/card/types.ts`。一个典型实例：

```json
{
  "id": "pool-12345",
  "name": "Mrekk",
  "rarity": "L",
  "job": "warrior",
  "level": 42,
  "mods": ["HD", "DT", "HR"],
  "constellation": 3,
  "no": 1234,
  "total": 200000,
  "serial": 17,
  "pulled": 2531,
  "country": "AU",
  "globalRank": 1,
  "pp": 18234.5,
  "art": "https://a.ppy.sh/12345",
  "banner": "https://assets.ppy.sh/user-profile-covers/12345/hash.jpeg",
  "skills": [
    { "name": "裂空斩", "element": "physical", "ap": 2 },
    { "name": "追风", "element": "thunder", "ap": 1 },
    { "name": "血怒", "element": "dark", "ap": 0, "passive": true }
  ],
  "isHero": false,
  "isMirror": false,
  "foil": true
}
```

## 请 Gemini 输出什么

1. 先用 5–8 行说明你理解的版式问题与改版方向。
2. 给一版可直接替换的 `CardFaceB.tsx`（完整文件）。
3. 给配套的 `card-face-b.css`（完整文件，保持 `cfb__` 前缀与 cqw 体系）。
4. 如果改了 DOM 结构，列出 `CardFaceB.tsx` 需要同步的调用方/测试点。
5. 不要改 `types.ts`、`GameCardFace.tsx`、`faces/index.ts` 的公开约定。

---

## 文件内容

### `src/card/GameCardFace.tsx`

```tsx
import { CardFaceB } from "./CardFaceB"
import type { CardFaceData } from "./types"

interface Props {
  card: CardFaceData
  className?: string
  /** 书里的邻页提前加载，避免翻过去时才开始请求插画 */
  eager?: boolean
}

/**
 * 游戏里所有显示卡面的地方（卡册、图鉴、卡组、桌面、开包、背包、详情、市场、战斗、账号）都用这一张：
 * 当前是 B v2 · 大元素，暗色，MOD 摆在名字后面。换游戏卡面改这里，
 * 同时把 faces/ 里对应版本的 faceMeta.inGame 挪过去（实验室靠它排第一）。
 */
export function GameCardFace(props: Props) {
  return <CardFaceB {...props} tone="dark" mods="name" version="v2" />
}

```

### `src/card/CardFaceB.tsx`

```tsx
import { memo, useEffect, useMemo, type CSSProperties, type ReactNode } from "react"

import { cn } from "@/lib/utils"

import { ElementGlyph, JobGlyph } from "./CardFace"
import { CardFoil } from "./CardFoil"
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
import { trackCardLight } from "./light"
import { motifTriangles } from "./motif"
import type { CardFaceData } from "./types"
import "./card-face-b.css"

/** MOD 的三种摆法：侧栏六边形 / 头像右上角 / 名字后面的胶囊 */
export type ModPlacement = "spine" | "portrait" | "name"

interface Props {
  card: CardFaceData
  tone?: "dark" | "light"
  mods?: ModPlacement
  version?: "v1" | "v2"
  className?: string
  eager?: boolean
}

/**
 * 卡面 B（侧栏版）。左边一条稀有度色竖栏，全部横排：稀有度图标、MOD，底部 Lv、命座；
 * 右边从上到下：banner（世界排名水印）→ 头像压 banner 下沿 + 国旗排名 / pp / 大号 BP
 * → 名字 → 技能 → 底标。类名前缀 cfb（cb 已被开包卡背占用）。
 * 闪卡膜是和肖像版共用的 CardFoil，跟着光标反光。
 */
export const CardFaceB = memo(function CardFaceB({
  card,
  tone = "dark",
  mods: placement = "spine",
  version = "v2",
  className,
  eager = false,
}: Props) {
  useEffect(trackCardLight, [])

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
      className={cn("cfb card-face", className)}
      data-rarity={card.rarity}
      data-tone={tone}
      data-version={version}
      data-foil={card.foil ? "true" : undefined}
      // 镜像卡视觉等美术 PR；先留数据钩子，不做临时样式
      data-mirror={card.isMirror ? "true" : undefined}
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

      {card.foil && <CardFoil seed={card.id} />}
    </div>
  )
})

```

### `src/card/card-face-b.css`

```css
/* =========================================================
   卡面 B — 侧栏版（类名前缀 cfb；cb 已被开包的卡背占用，见 desk/opening/opener.css）
   · 卡宽 = 100cqw，卡高 = 150cqw（2:3），内部尺寸全部用 cqw。
   · 稀有度一眼可辨：整圈稀有度色外框 + 实心色侧栏 + 名字下划线 + 技能行左边条；
     L 以上外框发光，Prismatic 用镭射渐变。
   · data-tone="dark" | "light" 只换卡纸和墨色，结构不变。
   ========================================================= */

.cfb {
  container: cfb / inline-size;
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: 4.5% / 3%;
  overflow: hidden;
  isolation: isolate;
  user-select: none;
  color: var(--ink);
  background: color-mix(in srgb, var(--r) 5%, var(--paper));
  font-family: var(--font-heading), var(--font-cn), var(--font-sans);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  box-shadow:
    0 0 0 0.5px rgb(0 0 0 / 0.35),
    1px 2px 2px rgb(0 0 0 / 0.3),
    4px 8px 16px -5px rgb(0 0 0 / 0.55),
    var(--glow, 0 0 0 transparent);

  --frame: 1.6cqw;
  --spine: 13cqw;
  --r: #a3a3ad;
  --r-fill: var(--r);
}

.cfb[data-tone="dark"] {
  --paper: #16151a;
  --ink: #f3efe7;
  --dim: #9c968c;
  --row: rgb(255 255 255 / 0.055);
  --spine-bg: color-mix(in srgb, var(--r) 58%, #0d0c10);
  --spine-ink: #fff;
}

.cfb[data-tone="light"] {
  --paper: #f4f1ea;
  --ink: #1c1a17;
  --dim: #7b766c;
  --row: rgb(0 0 0 / 0.05);
  --spine-bg: var(--r);
  --spine-ink: #fff;
}

/* ---------- 七档稀有度色 ---------- */
.cfb[data-rarity="UC"] { --r: #4fb47a; }
.cfb[data-rarity="R"] { --r: #4f8ee0; }
.cfb[data-rarity="E"] { --r: #9566e0; }
.cfb[data-rarity="L"] {
  --r: #e2b13c;
  --glow: 0 0 12px -2px rgb(226 177 60 / 0.55);
}
.cfb[data-rarity="Radiant"] {
  --r: #e8475f;
  --glow: 0 0 14px -2px rgb(232 71 95 / 0.6);
}
.cfb[data-rarity="Prismatic"] {
  --r: #c58cff;
  --r-fill: linear-gradient(160deg, #ff7eb6, #ffcf6e 22%, #7dffb2 42%, #6ec8ff 62%, #b98cff 82%, #ff7eb6);
  --glow: 0 0 16px -2px rgb(197 140 255 / 0.65);
}

/* ---------- 外框：一整圈稀有度色，带一道金属高光 ---------- */
.cfb__frame {
  position: absolute;
  inset: 0;
  z-index: 3;
  border-radius: inherit;
  padding: var(--frame);
  pointer-events: none;
  background:
    linear-gradient(135deg, rgb(255 255 255 / 0.4), transparent 35%, transparent 65%, rgb(0 0 0 / 0.25)),
    var(--r-fill);
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box exclude,
    linear-gradient(#000 0 0);
}

/* =========================================================
   1. 侧栏
   ========================================================= */

.cfb__spine {
  position: absolute;
  top: var(--frame);
  bottom: var(--frame);
  left: var(--frame);
  width: var(--spine);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2.4cqw;
  padding: 3cqw 0 3.2cqw;
  background:
    linear-gradient(90deg, transparent 70%, rgb(0 0 0 / 0.18)),
    var(--spine-bg);
  color: var(--spine-ink);
}

.cfb[data-rarity="Prismatic"] .cfb__spine {
  background:
    linear-gradient(90deg, rgb(0 0 0 / 0.25), rgb(0 0 0 / 0.4)),
    var(--r-fill);
}

/* 侧栏顶端：黑色半透明小牌 + 稀有度图标（形状复用现版卡面的 tex/emblem-*.svg），
   图标填稀有度色，Prismatic 是彩虹渐变 */
.cfb__emblem {
  flex: 0 0 auto;
  position: relative;
  width: 11cqw;
  height: 11cqw;
  border-radius: 2.2cqw;
  background: rgb(0 0 0 / 0.55);
  box-shadow:
    inset 0 0 0 0.25cqw rgb(255 255 255 / 0.12),
    0 0.5cqw 1cqw rgb(0 0 0 / 0.3);
  --emblem: url("./tex/emblem-c.svg");
}

.cfb__emblem::after {
  content: "";
  position: absolute;
  inset: 1.6cqw;
  background: var(--r-fill);
  -webkit-mask: var(--emblem) center / contain no-repeat;
  mask: var(--emblem) center / contain no-repeat;
}

.cfb[data-rarity="UC"] .cfb__emblem { --emblem: url("./tex/emblem-uc.svg"); }
.cfb[data-rarity="R"] .cfb__emblem { --emblem: url("./tex/emblem-r.svg"); }
.cfb[data-rarity="E"] .cfb__emblem { --emblem: url("./tex/emblem-e.svg"); }
.cfb[data-rarity="L"] .cfb__emblem { --emblem: url("./tex/emblem-l.svg"); }
.cfb[data-rarity="Radiant"] .cfb__emblem { --emblem: url("./tex/emblem-radiant.svg"); }
.cfb[data-rarity="Prismatic"] .cfb__emblem { --emblem: url("./tex/emblem-prismatic.svg"); }

.cfb__lv {
  /* Lv、命座星沉到侧栏底部 */
  margin-top: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4cqw;
}

.cfb__lv i {
  font-style: normal;
  font-size: 3.2cqw;
  font-weight: 700;
  letter-spacing: 0.12em;
  opacity: 0.8;
}

/* 侧栏宽 13cqw：两位数等级 8.6cqw 刚好放得下 */
.cfb__lv b {
  font-size: 8.6cqw;
  font-weight: 900;
  letter-spacing: -0.02em;
  text-shadow: 0 0.3cqw 0 rgb(0 0 0 / 0.3);
}

.cfb__stars {
  display: flex;
  flex-direction: column;
  gap: 0.8cqw;
  margin-top: 0.6cqw;
  filter: drop-shadow(0 0.3cqw 0.3cqw rgb(0 0 0 / 0.35));
}

.cfb__stars i {
  width: 6.2cqw;
  height: 6.2cqw;
  background: rgb(0 0 0 / 0.3);
  clip-path: polygon(50% 0, 62% 35%, 100% 38%, 70% 61%, 80% 100%, 50% 78%, 20% 100%, 30% 61%, 0 38%, 38% 35%);
}

.cfb__stars i[data-state="copper"] {
  background: #ffd36a;
}

.cfb__stars i[data-state="prism"] {
  background: linear-gradient(135deg, #ff9ad5, #9ae6ff, #c4a2ff);
}

/* =========================================================
   2. 主区
   ========================================================= */

.cfb__main {
  position: absolute;
  top: var(--frame);
  right: var(--frame);
  bottom: var(--frame);
  left: calc(var(--frame) + var(--spine));
  display: flex;
  flex-direction: column;
}

/* ---------- banner + 世界排名水印 ---------- */
.cfb__banner {
  position: relative;
  /* 头像压掉下沿 21cqw，露出 29cqw；技能区下方原本留白约 12cqw，吸收这 8cqw 下移 */
  flex: 0 0 50cqw;
  overflow: hidden;
  background:
    radial-gradient(80% 90% at 70% 30%, color-mix(in srgb, var(--r) 45%, transparent), transparent 75%),
    linear-gradient(160deg, color-mix(in srgb, var(--r) 30%, #15141a), #0c0b0e);
}

.cfb__banner img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: brightness(0.85) saturate(1.05);
}

/* 下沿渐隐进卡纸，头像和排名压在上面也读得清 */
.cfb__banner::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(transparent 45%, color-mix(in srgb, var(--r) 5%, var(--paper)) 100%);
}

.cfb__motif {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  fill: none;
  stroke: rgb(255 255 255 / 0.2);
  stroke-width: 0.55;
  stroke-linejoin: round;
}

.cfb__motif [data-fill] {
  fill: rgb(255 255 255 / 0.07);
  stroke: none;
}

.cfb__watermark {
  position: absolute;
  right: 2.4cqw;
  bottom: 15cqw;
  z-index: 1;
  font-size: 15cqw;
  font-weight: 900;
  font-style: italic;
  letter-spacing: -0.04em;
  color: rgb(255 255 255 / 0.2);
  white-space: nowrap;
}

/* banner 右上角：稀有度英文全名，稀有度色小牌子 */
.cfb__tag {
  position: absolute;
  top: 2.6cqw;
  right: 2.6cqw;
  z-index: 1;
  padding: 1.6cqw 2.6cqw;
  border-radius: 1.2cqw;
  background:
    linear-gradient(160deg, rgb(255 255 255 / 0.3), transparent 60%),
    var(--r-fill);
  color: #fff;
  font-size: 5cqw;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-shadow: 0 0.2cqw 0 rgb(0 0 0 / 0.3);
  box-shadow: 0 0.6cqw 1.4cqw rgb(0 0 0 / 0.4);
}

/* ---------- 头像 + 排名 / pp / BP ---------- */
.cfb__id {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-end;
  gap: 3.4cqw;
  margin-top: -21cqw;
  padding: 0 4cqw;
}

.cfb__avatar {
  position: relative;
  flex: 0 0 37cqw;
  height: 37cqw;
  border: 1cqw solid color-mix(in srgb, var(--r) 5%, var(--paper));
  border-radius: 4.6cqw;
  background: #242228;
  box-shadow:
    0 0 0 0.6cqw var(--r),
    0 1.6cqw 3cqw rgb(0 0 0 / 0.45);
}

.cfb[data-rarity="Prismatic"] .cfb__avatar {
  box-shadow:
    0 0 0 0.6cqw #d8b4ff,
    0 1.6cqw 3cqw rgb(0 0 0 / 0.45);
}

.cfb__avatar > img {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 3.6cqw;
  object-fit: cover;
}

.cfb__stats {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1.2cqw;
  padding-bottom: 0.4cqw;
}

.cfb__rank {
  display: flex;
  align-items: center;
  gap: 1.4cqw;
  font-size: 6cqw;
  font-weight: 800;
  white-space: nowrap;
}

.cfb__rank img {
  width: 6.8cqw;
  height: 4.7cqw;
  object-fit: cover;
  border-radius: 0.5cqw;
  box-shadow: 0 0 0 0.2cqw rgb(0 0 0 / 0.25);
}

.cfb__pp {
  font-size: 4.6cqw;
  font-weight: 700;
  color: var(--dim);
}

.cfb__pp i {
  margin-left: 0.6cqw;
  font-style: normal;
  font-size: 3.4cqw;
}

.cfb__bp {
  display: flex;
  align-items: baseline;
  gap: 1.2cqw;
  margin-top: 0.6cqw;
  color: var(--bp);
}

.cfb[data-tone="dark"] .cfb__bp {
  color: color-mix(in srgb, var(--bp) 55%, #fff);
}

.cfb__bp i {
  font-style: normal;
  font-size: 3.8cqw;
  font-weight: 800;
  letter-spacing: 0.12em;
  opacity: 0.85;
}

.cfb__bp b {
  font-size: 11.5cqw;
  font-weight: 900;
  letter-spacing: -0.01em;
}

/* ---------- 名字 ---------- */
.cfb__title {
  display: flex;
  align-items: center;
  gap: 2cqw;
  margin: 3.4cqw 4cqw 0;
  padding-bottom: 2.2cqw;
  border-bottom: 0.7cqw solid var(--r);
}

.cfb[data-rarity="Prismatic"] .cfb__title {
  border-image: var(--r-fill) 1;
}

.cfb__name {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: var(--name-size);
  font-weight: 800;
  line-height: 1.12;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- 技能 ---------- */
.cfb__skills {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 1.4cqw;
  padding: 2.2cqw 4cqw;
}

.cfb__skill {
  flex: 0 0 14cqw;
  display: flex;
  align-items: center;
  gap: 2cqw;
  padding: 0 2cqw 0 1.6cqw;
  border-left: 0.8cqw solid var(--r);
  border-radius: 0.8cqw 1.8cqw 1.8cqw 0.8cqw;
  background: var(--row);
}

.cfb__skill--empty {
  border-left-color: transparent;
  background: none;
  outline: 0.3cqw dashed color-mix(in srgb, var(--dim) 40%, transparent);
  outline-offset: -0.3cqw;
}

.cfb__el {
  flex: 0 0 10cqw;
  height: 10cqw;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--el) 28%, transparent);
  color: color-mix(in srgb, var(--el) 70%, var(--ink));
}

.cfb__el svg {
  width: 6.8cqw;
  height: 6.8cqw;
}

.cfb__skill-name {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  font-size: 6.6cqw;
  font-weight: 700;
  /* 卡面整体 line-height: 1；中文字形比 1em 高，overflow 裁省略号时会切掉上下沿 */
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cfb__ap,
.cfb__mp {
  flex: 0 0 9cqw;
  height: 9cqw;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 5.6cqw;
  font-weight: 800;
}

.cfb__ap {
  background: #d98a12;
  color: #fff;
}

.cfb__mp {
  border: 0.5cqw solid #5c9ee8;
  color: #5c9ee8;
}

.cfb__passive {
  padding: 1.2cqw 1.8cqw;
  border: 0.3cqw solid color-mix(in srgb, var(--dim) 60%, transparent);
  border-radius: 3cqw;
  color: var(--dim);
  font-size: 4cqw;
  font-weight: 700;
}

/* ---------- 底栏：职业 | 序号 ---------- */
.cfb__foot {
  flex: 0 0 10cqw;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 4cqw;
  border-top: 0.3cqw solid color-mix(in srgb, var(--dim) 35%, transparent);
  font-weight: 800;
}

.cfb__job {
  display: flex;
  align-items: center;
  gap: 1.4cqw;
  font-size: 5cqw;
  white-space: nowrap;
}

.cfb__job svg {
  width: 6.4cqw;
  height: 6.4cqw;
  color: var(--r);
}

.cfb[data-rarity="Prismatic"] .cfb__job svg {
  color: #c58cff;
}

.cfb__serial {
  font-size: 5.2cqw;
  white-space: nowrap;
}

.cfb__serial i {
  margin-left: 0.4cqw;
  font-style: normal;
  font-size: 3.8cqw;
  color: var(--dim);
}

/* =========================================================
   3. MOD 三种摆法
   ========================================================= */

.cfb__mod {
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 3.6cqw;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-shadow: 0 0.2cqw 0 rgb(0 0 0 / 0.3);
  background:
    linear-gradient(160deg, rgb(255 255 255 / 0.3), transparent 55%),
    var(--mod);
}

.cfb__mod--hero {
  background: linear-gradient(135deg, #ff6fa8, #b77bff);
}

/* A 侧栏：实心六边形，叠在稀有度图标下面 */
.cfb__mods[data-at="spine"] {
  display: flex;
  flex-direction: column;
  gap: 1.2cqw;
}

.cfb__mods[data-at="spine"] .cfb__mod,
.cfb__mods[data-at="portrait"] .cfb__mod {
  width: 11cqw;
  height: 10cqw;
  clip-path: polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%);
}

.cfb__mods[data-at="spine"] .cfb__mod--hero,
.cfb__mods[data-at="portrait"] .cfb__mod--hero {
  font-size: 2.6cqw;
}

/* B 头像角标：竖着叠在头像右上角，一半压出头像 */
.cfb__mods[data-at="portrait"] {
  position: absolute;
  top: -2.4cqw;
  right: -5cqw;
  display: flex;
  flex-direction: column;
  gap: 0.8cqw;
  filter: drop-shadow(0 0.6cqw 0.8cqw rgb(0 0 0 / 0.45));
}

.cfb__mods[data-at="portrait"] .cfb__mod {
  width: 12cqw;
  height: 10.6cqw;
  font-size: 3.8cqw;
}

.cfb:has(.cfb__mods[data-at="portrait"]) .cfb__stats {
  padding-left: 2.6cqw;
}

/* C 名字后缀：彩色胶囊排在名字右边 */
.cfb__mods[data-at="name"] {
  flex: 0 0 auto;
  display: flex;
  gap: 1cqw;
  margin-left: auto;
}

.cfb__mods[data-at="name"] .cfb__mod {
  height: 6.8cqw;
  padding: 0 2cqw;
  border-radius: 1.2cqw;
  font-size: 3.8cqw;
}

/* B v1：整体放大前的尺寸快照；未覆盖的结构、颜色与 v2 共用。 */
.cfb[data-version="v1"] .cfb__emblem { width: 9.4cqw; height: 9.4cqw; }
.cfb[data-version="v1"] .cfb__stars i { width: 4.6cqw; height: 4.6cqw; }
.cfb[data-version="v1"] .cfb__tag { font-size: 4.4cqw; }
.cfb[data-version="v1"] .cfb__rank { font-size: 5cqw; }
.cfb[data-version="v1"] .cfb__rank img { width: 5.6cqw; height: 3.9cqw; }
.cfb[data-version="v1"] .cfb__pp { font-size: 3.8cqw; }
.cfb[data-version="v1"] .cfb__pp i { font-size: 2.8cqw; }
.cfb[data-version="v1"] .cfb__bp i { font-size: 3.2cqw; }
.cfb[data-version="v1"] .cfb__bp b { font-size: 10cqw; }
.cfb[data-version="v1"] .cfb__skill { flex-basis: 11.6cqw; }
.cfb[data-version="v1"] .cfb__el { flex-basis: 7.4cqw; height: 7.4cqw; }
.cfb[data-version="v1"] .cfb__el svg { width: 5cqw; height: 5cqw; }
.cfb[data-version="v1"] .cfb__skill-name { font-size: 5.4cqw; }
.cfb[data-version="v1"] .cfb__ap,
.cfb[data-version="v1"] .cfb__mp { flex-basis: 7cqw; height: 7cqw; font-size: 4.4cqw; }
.cfb[data-version="v1"] .cfb__passive { font-size: 3.2cqw; }
.cfb[data-version="v1"] .cfb__job { font-size: 4.2cqw; }
.cfb[data-version="v1"] .cfb__job svg { width: 5.4cqw; height: 5.4cqw; }
.cfb[data-version="v1"] .cfb__serial { font-size: 4.4cqw; }
.cfb[data-version="v1"] .cfb__serial i { font-size: 3.2cqw; }
.cfb[data-version="v1"] .cfb__mod { font-size: 2.9cqw; }
.cfb[data-version="v1"] .cfb__mods[data-at="spine"] .cfb__mod,
.cfb[data-version="v1"] .cfb__mods[data-at="portrait"] .cfb__mod {
  width: 9cqw;
  height: 8cqw;
}
.cfb[data-version="v1"] .cfb__mods[data-at="spine"] .cfb__mod--hero,
.cfb[data-version="v1"] .cfb__mods[data-at="portrait"] .cfb__mod--hero { font-size: 2.1cqw; }
.cfb[data-version="v1"] .cfb__mods[data-at="portrait"] .cfb__mod {
  width: 10cqw;
  height: 8.8cqw;
  font-size: 3.2cqw;
}
.cfb[data-version="v1"] .cfb__mods[data-at="name"] .cfb__mod {
  height: 5.6cqw;
  padding: 0 1.6cqw;
  font-size: 3.2cqw;
}

/* 闪卡膜（CardFoil）压过外框和侧栏；z-index 只给子层，混合模式才能混到卡面上。 */
.cfb .card-foil > i {
  z-index: 4;
}

```

### `src/card/CardFoil.tsx`

```tsx
import { useEffect, useRef, type CSSProperties } from "react"

import { hashOf } from "./data"
import "./card-foil.css"

/**
 * 闪卡膜，所有卡面共用：放在卡面根节点的最后一个子元素。
 * 各层的 --mx / --my 由 light.ts 按光标写入（根节点需带 card-face 类）；
 * 扫光只在进入视口附近时播放。
 */
export function CardFoil({ seed }: { seed: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) element.dataset.sweepVisible = ""
        else delete element.dataset.sweepVisible
      },
      { rootMargin: "100px" }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className="card-foil"
      // 每张闪卡的扫光错开，不会整页一起闪
      style={{ "--seed": hashOf(seed) % 97 } as CSSProperties}
      aria-hidden
    >
      <i className="card-foil__film" />
      <i className="card-foil__dodge" />
      <i className="card-foil__glitter" />
      <i className="card-foil__glitter card-foil__glitter--b" />
      <i className="card-foil__glare" />
      <i className="card-foil__sweep" />
    </div>
  )
}

```

### `src/card/card-foil.css`

```css
/* =========================================================
   闪卡膜（CardFoil），所有卡面共用：叠在最上面的一层镭射膜，任何稀有度都能叠。
   克制为主：静止时只有一道淡彩带和零星碎闪，迎着光的地方才明显。
   · --mx / --my（0–1）是光标在卡面上的位置，由 light.ts 写入，反光跟着它走。
   · .card-foil 自己不能有 z-index / opacity / filter，否则子层的混合模式
     就混不到卡面上了；需要压过卡面里带 z-index 的层时，给子层 z-index。
   ========================================================= */

@property --mx {
  syntax: "<number>";
  inherits: false;
  initial-value: 0.24;
}

@property --my {
  syntax: "<number>";
  inherits: false;
  initial-value: 0.16;
}

.card-foil {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  overflow: hidden;
  pointer-events: none;
}

.card-foil > i {
  position: absolute;
  inset: 0;
  --foil-angle: calc(118deg + (var(--mx) - 0.5) * 36deg);
  --spectrum: repeating-linear-gradient(
    var(--foil-angle),
    hsl(350 92% 62%) 0,
    hsl(28 96% 60%) 7cqw,
    hsl(56 96% 58%) 14cqw,
    hsl(112 76% 56%) 21cqw,
    hsl(172 86% 50%) 28cqw,
    hsl(206 96% 60%) 35cqw,
    hsl(256 92% 68%) 42cqw,
    hsl(302 86% 66%) 49cqw,
    hsl(350 92% 62%) 56cqw
  );
  --at-light: calc(var(--mx) * 100%) calc(var(--my) * 100%);
  --at-far: calc((1 - var(--mx)) * 100%) calc((1 - var(--my)) * 100%);
  transition:
    --mx 0.55s ease-out,
    --my 0.55s ease-out;
}

/* 光标在卡上时逐帧跟手，不再缓动 */
.card-face[data-lit] .card-foil > i {
  transition: none;
}

/* 彩膜：只有迎着光的一道窄彩带，其余地方几乎没有 */
.card-foil__film {
  background: var(--spectrum);
  background-size: 300% 300%;
  background-position: var(--at-light);
  mask: linear-gradient(
      var(--foil-angle),
      transparent 30%,
      #000 46%,
      #000 54%,
      transparent 70%
    )
    var(--at-far) / 250% 250%;
  mix-blend-mode: screen;
  opacity: 0.16;
}

/* 亮彩：光斑附近一小片，离开就消失 */
.card-foil__dodge {
  background: var(--spectrum);
  background-size: 300% 300%;
  background-position: var(--at-far);
  mask: radial-gradient(
    46% 32% at var(--at-light),
    #000,
    rgb(0 0 0 / 0.3) 55%,
    transparent
  );
  mix-blend-mode: color-dodge;
  opacity: 0.16;
}

/* 碎闪：只在光斑里出现，转动时此起彼伏 */
.card-foil__glitter {
  background: var(--spectrum);
  background-size: 300% 300%;
  background-position: calc(var(--my) * 100%) calc(var(--mx) * 100%);
  mask-image:
    url("./tex/glitter.svg"),
    radial-gradient(40% 28% at var(--at-light), #000, transparent);
  mask-size:
    220px 220px,
    100% 100%;
  -webkit-mask-composite: source-in;
  mask-composite: intersect;
  opacity: 0.55;
}

.card-foil__glitter--b {
  background: #fff;
  mask-image:
    url("./tex/glitter-b.svg"),
    radial-gradient(30% 22% at var(--at-far), #000, transparent);
  mask-size:
    260px 260px,
    100% 100%;
  opacity: 0.35;
}

.card-foil__glare {
  background: radial-gradient(
    44% 30% at var(--at-light),
    rgb(255 255 255 / 0.22),
    rgb(255 255 255 / 0.05) 45%,
    transparent 75%
  );
  mix-blend-mode: overlay;
}

/* 静止时每隔几秒扫过一道彩光，让人一眼看出这是闪卡 */
.card-foil > .card-foil__sweep {
  inset: -10% -60%;
  background: linear-gradient(
    105deg,
    transparent 43%,
    hsl(190 100% 62% / 0.1) 46.5%,
    hsl(300 100% 78% / 0.16) 50%,
    hsl(45 100% 62% / 0.1) 53.5%,
    transparent 57%
  );
  transform: translateX(-62%);
  animation: card-foil-sweep 9s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  animation-delay: calc(var(--seed, 0) * -0.07s);
}

@keyframes card-foil-sweep {
  0%,
  74% {
    transform: translateX(-62%);
  }
  100% {
    transform: translateX(62%);
  }
}

.card-foil:not([data-sweep-visible]) .card-foil__sweep {
  animation-play-state: paused;
}

@media (prefers-reduced-motion: reduce) {
  .card-foil > .card-foil__sweep {
    display: none;
  }
}

```

### `src/card/motif.ts`

```ts
import { hashOf } from "./data"

/**
 * 没有自定义 banner 时肖像窗的底纹：osu! lazer 风格的散落三角。
 * 坐标系 viewBox 100×80（跟收藏态肖像窗比例一致）。用一套定好的构图：大中小错落、
 * 有的从边上被裁掉、有的藏在头像后面；每张卡按 id 决定是否左右镜像，并给每个三角
 * 加一点位移和缩放，所以卡与卡不完全一样，但疏密始终是这套构图的样子。
 */
const MOTIF_LAYOUT: { x: number; bottom: number; size: number; filled: boolean }[] = [
  { x: 23.6, bottom: 64, size: 20, filled: false },
  { x: 79.1, bottom: 21.3, size: 12.7, filled: false },
  { x: 94.5, bottom: 74.7, size: 25.5, filled: false },
  { x: 9.1, bottom: 21.3, size: 9.1, filled: false },
  { x: 62.7, bottom: 80, size: 16.4, filled: false },
  { x: 35.5, bottom: 16, size: 16.4, filled: true },
  { x: 73.6, bottom: 58.7, size: 10.9, filled: true },
  { x: 7.3, bottom: 80, size: 23.6, filled: true },
]

export function motifTriangles(seed: string): { d: string; filled: boolean }[] {
  let s = hashOf(seed) || 1
  const rand = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const f = (n: number) => n.toFixed(1)
  const mirror = rand() < 0.5
  return MOTIF_LAYOUT.map((tri) => {
    const size = tri.size * (0.85 + rand() * 0.3)
    const cx = (mirror ? 100 - tri.x : tri.x) + (rand() - 0.5) * 8
    const bottom = tri.bottom + (rand() - 0.5) * 6
    const top = bottom - size * 0.866
    return {
      d: `M${f(cx - size / 2)} ${f(bottom)}L${f(cx)} ${f(top)}L${f(cx + size / 2)} ${f(bottom)}Z`,
      filled: tri.filled,
    }
  })
}

```

### `src/card/faces/b-v2.tsx`

```tsx
import { CardFaceB } from "../CardFaceB"
import type { CardFaceProps } from "./index"

export const faceMeta = {
  id: "b-v2",
  label: "B v2 · 大元素",
  note: "侧栏 / 明暗主题 / MOD 三种摆法",
  order: 71,
  supportsTheme: true,
  supportsModPlacement: true,
  inGame: true,
} as const

export default function CardFaceBV2({ theme, modPlacement, ...props }: CardFaceProps) {
  return <CardFaceB {...props} tone={theme} mods={modPlacement} version="v2" />
}

```

### `src/card/faces/index.ts`

```ts
import type { ComponentType } from "react"

import type { CardFaceData } from "../types"

export interface CardFaceProps {
  card: CardFaceData
  theme?: "dark" | "light"
  modPlacement?: "spine" | "portrait" | "name"
  className?: string
}

export interface CardFaceMeta {
  id: string
  label: string
  note?: string
  order?: number
  /** 这个卡面是否响应 theme="light" */
  supportsTheme?: boolean
  /** 这个卡面是否支持三种 MOD 位置 */
  supportsModPlacement?: boolean
  /** 游戏里正在用的卡面（与 ../GameCardFace.tsx 保持一致）；实验室排第一，其余归入历史版本 */
  inGame?: boolean
}

interface FaceModule {
  default: ComponentType<CardFaceProps>
  faceMeta: CardFaceMeta
}

const modules = import.meta.glob<FaceModule>("./*.tsx", { eager: true })

/** 自动收集 faces/ 下每个带 faceMeta + default 的卡面。新增一个版本只需丢一对 tsx/css。 */
export const CARD_FACES = Object.values(modules)
  .filter((mod): mod is FaceModule => Boolean(mod.faceMeta && mod.default))
  .sort(
    (a, b) =>
      Number(Boolean(b.faceMeta.inGame)) - Number(Boolean(a.faceMeta.inGame)) ||
      (a.faceMeta.order ?? 100) - (b.faceMeta.order ?? 100)
  )
  .map((mod) => ({ ...mod.faceMeta, Component: mod.default }))

/** 实验室、编辑器默认选中游戏卡面 */
export const DEFAULT_FACE = CARD_FACES[0]

export const HISTORY_FACES = CARD_FACES.filter((face) => !face.inGame)

export function getCardFace(id: string) {
  return CARD_FACES.find((face) => face.id === id) ?? DEFAULT_FACE
}

```

### `src/card/faces/portrait.tsx`

```tsx
import { CardFace } from "../CardFace"

export const faceMeta = {
  id: "portrait",
  label: "肖像版",
  note: "大肖像 / 三角底纹 / 实例序号；Mythic（内部 Radiant）宝石红工艺",
  order: 60,
} as const

export default CardFace

```

### `src/card/light.ts`

```ts
/**
 * 卡面受光：把光标在卡面上的相对位置写进 --mx / --my（0–1）。
 * 烫印线条、珠光纸、镭射纸和闪卡膜都按这两个变量移动反光。
 * 全局只挂一个 pointermove 监听，每帧最多写一次，不触发 React 重渲染。
 * 系统开了"减少动态效果"时不跟踪，卡面停在默认的左上受光。
 */

let installed = false
let lit: HTMLElement | null = null
let litSurfaces: HTMLElement[] = []
let pending: PointerEvent | null = null
let frame = 0

function release() {
  if (!lit) return
  for (const surface of litSurfaces) {
    surface.style.removeProperty("--mx")
    surface.style.removeProperty("--my")
  }
  litSurfaces = []
  delete lit.dataset.lit
  lit = null
}

export function trackCardLight() {
  if (installed) return
  installed = true

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)")

  const flush = () => {
    frame = 0
    const event = pending
    pending = null
    if (!event || reduceMotion.matches) {
      release()
      return
    }

    let card =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(".card-face")
        : null
    // 小卡格里看不出反光，每帧重绘整张卡却很贵：最近的 data-no-light 祖先里不跟踪，data-light 可以重新打开
    if (card?.closest("[data-light], [data-no-light]")?.hasAttribute("data-no-light")) card = null
    if (card !== lit) {
      release()
      lit = card
      if (lit) {
        lit.dataset.lit = ""
        litSurfaces = Array.from(
          lit.querySelectorAll<HTMLElement>(
            ".cf__bezel, .cf__sheen, .cf__portrait, .cf__emblem, .cf__rarity, .card-foil > i:not(.card-foil__sweep)"
          )
        )
      }
    }
    if (!lit) return

    const rect = lit.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    const mx = Math.min(Math.max(x, 0), 1).toFixed(3)
    const my = Math.min(Math.max(y, 0), 1).toFixed(3)
    for (const surface of litSurfaces) {
      surface.style.setProperty("--mx", mx)
      surface.style.setProperty("--my", my)
    }
  }

  document.addEventListener(
    "pointermove",
    (event) => {
      pending = event
      frame ||= requestAnimationFrame(flush)
    },
    { passive: true }
  )
  document.documentElement.addEventListener("pointerleave", () => {
    pending = null
    release()
  })
}

```

### `src/card/types.ts`

```ts
/** 品质从低到高；界面的筛选、排序、概率展示都从这里取顺序。 */
export const RARITIES = ["C", "UC", "R", "E", "L", "Radiant", "Prismatic"] as const

export type Rarity = (typeof RARITIES)[number]

/** 职业四大类；十四子职业后续在此扩展 */
export type Job = "tank" | "warrior" | "mage" | "support"

/** 九属性，挂在技能上，不挂在卡上 */
export type Element =
  | "metal"
  | "wood"
  | "earth"
  | "ice"
  | "fire"
  | "thunder"
  | "light"
  | "dark"
  | "physical"

export type Mod =
  | "HD"
  | "HR"
  | "DT"
  | "FL"
  | "NC"
  | "EZ"
  | "HT"
  | "NF"
  | "SD"
  | "PF"
  | "SO"
  | "CL"

export interface CardSkill {
  name: string
  element: Element
  /** 行动点消耗 */
  ap: number
  /** 法系才有的 MP 消耗 */
  mp?: number
  /** 被动技能：AP 恒 0，且不显示 MP */
  passive?: boolean
}

export interface CardFaceData {
  id: string
  name: string
  rarity: Rarity
  job: Job
  level: number
  mods: Mod[]
  /** 普通卡 0–6；本体卡 0–12（每颗星两档） */
  constellation: number
  no: number
  total: number
  /** 实例序号：这张卡被发出的第几张；没有实例（图鉴、预览）时缺省 */
  serial?: number
  /** 这张卡累计发行多少张 */
  pulled?: number
  skills: CardSkill[]
  /** 立绘；缺省时使用占位图。玩家卡用头像地址，由浏览器随看随载。 */
  art?: string
  /** 个人主页 banner。没有地址就不要请求。 */
  banner?: string
  /** 卡面名字链到本人 osu! 主页 */
  profileUrl?: string
  /** 玩家卡身份信息 */
  country?: string
  globalRank?: number | null
  pp?: number | null
  isHero?: boolean
  /** 闪卡：仅实例属性，不改变卡池稀有度 */
  foil?: boolean
  /** 实例个体值，千分比：970–1030，默认 1000 */
  rollBp?: number
  /** 镜像卡：本体卡的复制体，单独卡型 */
  isMirror?: boolean
}


export type StarState = "empty" | "copper" | "prism"

```

