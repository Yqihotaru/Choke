import { useRef, useState } from "react"
import { createPortal } from "react-dom"

import { playSfx } from "@/audio/sfx"
import { useModal } from "@/ui/useModal"
import { usePresence } from "@/ui/usePresence"

import { Pages } from "@/desk/shell/BookPages"
import "@/desk/panels/player/about-panel.css"

const TOOLS = [
  {
    href: "/card-lab",
    label: "卡面实验室",
    note: "自动加载 src/lab/faces/ 下所有卡面版本，并排对比材质、尺寸、战斗态和本体卡命座。",
  },
  {
    href: "/card-editor",
    label: "卡牌编辑器",
    note: "手动拼一张卡，检查字段、卡面和技能排布。",
  },
  {
    href: "/pool-lab",
    label: "卡池实验室",
    note: "导入排行榜数据，构建卡池并导出卡定义。",
  },
  {
    href: "/holo-lab.html",
    label: "全息参考",
    note: "闪卡 / 箔面效果的视觉参考页。",
    external: true,
  },
  // 音效实验室只在开发模式存在，正式版不带
  ...(import.meta.env.DEV
    ? [
        {
          href: "/sfx-lab",
          label: "音效实验室",
          note: "按游戏内的播放链路试听全部音效，对比合成与录音，挑选素材并导出清单。",
          external: false,
        },
      ]
    : []),
]

const CONTRIBUTORS = [
  { name: "Glimmer_Miku", role: "策划 / 后端 / 战斗规则" },
  { name: "Yqihotaru", role: "桌面亮色主题 / 分辨率适配" },
  { name: "Claude", role: "战斗界面与表现" },
]

/** 音效素材：全部 CC0，逐文件出处见 public/sfx/CREDITS.md */
const SOUND_CREDITS = [
  { name: "Kenney", note: "Casino / UI / Interface / Impact / RPG / Sci-Fi Audio、85 Short music jingles", href: "https://kenney.nl/assets" },
  { name: "BigSoundBank", note: "Joseph Sardin：风铃、翻页、撕纸、玻璃碎裂", href: "https://bigsoundbank.com/" },
  { name: "OpenGameArt", note: "100 CC0 SFX、75 CC0 breaking sfx（rubberduck）、Various Paper Sound Effects（Luckius）", href: "https://opengameart.org/" },
]

const POLICIES = {
  privacy: {
    title: "隐私政策",
    body: [
      "我们只保存运行游戏所必需的数据：osu! 公开资料（用户名、头像、pp、排名）、你主动填写的邮箱，以及你的卡册、卡组、金币与进度。",
      "邮箱只用于登录与找回账号，不会用于营销，也不会出售或提供给第三方。",
      "卡面头像与封面来自 osu! 公开 CDN，由你的浏览器直接加载。",
      "你可以随时要求删除账号及全部数据；删除后卡册、卡组与市场挂单都会一并清除。",
    ],
  },
  terms: {
    title: "游玩协议",
    body: [
      "Choke! 是非盈利同人项目，与 osu! 官方无关。",
      "禁止利用漏洞、脚本或市场对倒获取不当利益；违规账号可被限制市场功能或封禁。",
      "市场交易以服务端记录为准；因误操作导致的交易不会回滚。",
      "游戏内所有玩家卡面素材版权归原作者与 osu! 所有，仅用于展示。",
    ],
  },
} as const

type PolicyKey = keyof typeof POLICIES

/** 和 about-panel.css 里弹层离场动画的时长一致 */
const POLICY_EXIT_MS = 170

export function AboutPanel() {
  /** 正在看的是哪一份；关掉之后先留着，离场动画播完前内容不能空 */
  const [policy, setPolicy] = useState<PolicyKey>("privacy")
  const [open, setOpen] = useState(false)
  const policyRef = useRef<HTMLDivElement>(null)
  const { mounted, leaving } = usePresence(open, POLICY_EXIT_MS)

  const show = (key: PolicyKey) => {
    playSfx("paper")
    setPolicy(key)
    setOpen(true)
  }
  const close = () => {
    playSfx("close")
    setOpen(false)
  }

  useModal(policyRef, { active: open, onClose: close })

  return (
    <>
      <Pages
        left={
          <div className="about-center">
            <img className="about-logo" src="/brand/choke-lockup-horizontal.svg" alt="Choke!" />
            <p className="about-text">
              把 osu! 玩家数据做成卡牌：开包、收藏、组卡、战斗。
            </p>
            <p className="bk-note">
              非官方粉丝作品；玩家数据来自 osu! 公开 API 与公开排行榜。
            </p>

            <hr className="bk-divider" />

            <span className="bk-label">Contributors</span>
            <div className="about-people">
              {CONTRIBUTORS.map((person) => (
                <div className="about-person" key={person.name}>
                  <b>{person.name}</b>
                  <span>{person.role}</span>
                </div>
              ))}
            </div>

            <hr className="bk-divider" />

            <span className="bk-label">音效素材 · CC0</span>
            <div className="about-people">
              {SOUND_CREDITS.map((source) => (
                <a
                  className="about-person"
                  key={source.name}
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  <b>{source.name}</b>
                  <span>{source.note}</span>
                </a>
              ))}
            </div>
            <p className="bk-note">
              <a href="/sfx/CREDITS.md" target="_blank" rel="noreferrer">
                逐文件出处
              </a>
            </p>
          </div>
        }
        right={
          <div className="about-center">
            <span className="bk-label">实验室工具</span>
            <p className="bk-note">开发用页面。正式上线后仅对指定账户开放。</p>
            <div className="bk-list">
              {TOOLS.map((tool) => (
                <a
                  className="bk-row about-link"
                  key={tool.href}
                  href={tool.href}
                  target={tool.external ? "_blank" : undefined}
                  rel={tool.external ? "noreferrer" : undefined}
                >
                  <span className="about-link__text">
                    <b>
                      {tool.label}
                      <span className="bk-tag about-dev">开发用</span>
                    </b>
                    <em>{tool.note}</em>
                  </span>
                  <i aria-hidden>›</i>
                </a>
              ))}
            </div>

            <hr className="bk-divider" />

            <div className="about-policies">
              <button type="button" className="bk-btn" onClick={() => show("privacy")}>
                隐私政策
              </button>
              <button type="button" className="bk-btn" onClick={() => show("terms")}>
                游玩协议
              </button>
            </div>
          </div>
        }
      />

      {/* 挂到 body：书有自己的定位上下文，留在书里的话遮罩只盖得住书，焦点移进去还会把桌面顶歪 */}
      {mounted &&
        createPortal(
          <div
            className={`about-policy-layer ${leaving ? "is-leaving" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={POLICIES[policy].title}
            ref={policyRef}
            onClick={close}
          >
            <div className="about-policy-card" onClick={(event) => event.stopPropagation()}>
              <span className="bk-label">{policy === "privacy" ? "PRIVACY" : "TERMS"}</span>
              <b>{POLICIES[policy].title}</b>
              {POLICIES[policy].body.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <button type="button" className="bk-btn bk-btn--main" onClick={close}>
                我知道了
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
