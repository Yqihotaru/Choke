import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  getSfxVolume,
  hasSampleBody,
  hasSynth,
  loadSfxLibrary,
  playHit,
  previewSfx,
  setSfxVolume,
  type SfxId,
  type SfxSource,
} from "@/audio/sfx"
import { ELEMENT_LABEL, type Element } from "@/card/types"

import meta from "./sfx-meta.json"
import "./sfx-lab.css"

/**
 * 音效试听页（仅开发模式，路由 /sfx-lab）。
 * 播放走游戏自己的链路（src/audio/sfx.ts），听到的和游戏里一致：
 * 战斗冲击音会叠合成低频体，录音会有 ±3% 的音高随机。
 * 每个音名可以对比 纯合成 / 录音+低频 / 纯录音 三种来源，选定后导出，填进 sfx.ts 的 SFX_SOURCE。
 */

const META = meta as unknown as {
  groups: [string, string[]][]
  uses: Record<string, string>
  sources: Record<string, string>
  flags: Record<string, string[]>
}

type Mark = "keep" | "drop"
type Library = Awaited<ReturnType<typeof loadSfxLibrary>>

const MARK_KEY = "choke:sfx-audition-marks"
const PICK_KEY = "choke:sfx-lab-picks"
const ELEMENTS = Object.keys(ELEMENT_LABEL) as Element[]

const SOURCE_LABEL: Record<SfxSource, string> = {
  synth: "纯合成",
  sample: "录音 + 低频",
  bare: "纯录音",
}

function readJson<T>(key: string): T {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "{}") as T
  } catch {
    return {} as T
  }
}

/** 没有合成低频体的音名，"录音 + 低频"其实就是纯录音，直接叫"录音" */
function sourceLabel(name: string, source: SfxSource) {
  return source === "sample" && !hasSampleBody(name) ? "录音" : SOURCE_LABEL[source]
}

function sourcesFor(name: string): SfxSource[] {
  if (!hasSynth(name)) return ["sample"]
  return hasSampleBody(name) ? ["synth", "sample", "bare"] : ["synth", "sample"]
}

interface Item {
  name: string
  file: string
  index: number
}

export function SfxLab() {
  const [lib, setLib] = useState<Library | null>(null)
  const [error, setError] = useState("")
  const [marks, setMarks] = useState<Record<string, Mark>>(() => readJson(MARK_KEY))
  const [picks, setPicks] = useState<Record<string, SfxSource>>(() => readJson(PICK_KEY))
  const [query, setQuery] = useState("")
  const [volume, setVolume] = useState(getSfxVolume)
  const [body, setBody] = useState(true)
  const [fixedPitch, setFixedPitch] = useState(false)
  const [cur, setCur] = useState<{ name: string; index: number } | null>(null)
  const [playing, setPlaying] = useState("")
  const [hitCombo, setHitCombo] = useState(0)
  const [hitCrit, setHitCrit] = useState(false)
  const [notice, setNotice] = useState("")
  const chainToken = useRef(0)

  useEffect(() => {
    loadSfxLibrary()
      .then((result) => {
        if (Object.keys(result.manifest).length === 0) setError("读取 /sfx/manifest.json 失败，请用 pnpm dev 打开本页。")
        setLib(result)
      })
      .catch((e: unknown) => setError(String(e)))
  }, [])

  useEffect(() => {
    window.localStorage.setItem(MARK_KEY, JSON.stringify(marks))
  }, [marks])
  useEffect(() => {
    window.localStorage.setItem(PICK_KEY, JSON.stringify(picks))
  }, [picks])

  const groups = useMemo(() => {
    if (!lib) return []
    const known = new Set(META.groups.flatMap(([, names]) => names))
    const all: [string, string[]][] = [...META.groups, ["其他", Object.keys(lib.manifest).filter((n) => !known.has(n))]]
    const q = query.trim().toLowerCase()
    return all
      .map(([title, names]) => {
        const shown = names.filter(
          (n) => lib.manifest[n]?.length && (!q || n.includes(q) || (META.uses[n] ?? "").includes(q)),
        )
        return [title, shown] as [string, string[]]
      })
      .filter(([, names]) => names.length > 0)
  }, [lib, query])

  const items = useMemo<Item[]>(
    () => groups.flatMap(([, names]) => names.flatMap((name) => lib!.manifest[name]!.map((file, index) => ({ name, file, index })))),
    [groups, lib],
  )

  const playOne = useCallback(
    async (name: string, source: SfxSource, variant?: number) => {
      if (!hasSynth(name)) return
      await previewSfx(name as SfxId, { source, variant, fixedPitch })
    },
    [fixedPitch],
  )

  const playVariant = useCallback(
    (name: string, index: number) => {
      chainToken.current += 1
      setCur({ name, index })
      void playOne(name, body ? "sample" : "bare", index)
    },
    [body, playOne],
  )

  const playAll = useCallback(
    async (name: string) => {
      if (!lib) return
      const token = ++chainToken.current
      for (let i = 0; i < lib.manifest[name]!.length; i += 1) {
        if (token !== chainToken.current) return
        setCur({ name, index: i })
        await playOne(name, body ? "sample" : "bare", i)
        await new Promise((r) => window.setTimeout(r, 900))
      }
    },
    [body, lib, playOne],
  )

  const compare = useCallback(
    (name: string, source: SfxSource) => {
      chainToken.current += 1
      setPlaying(`${name}:${source}`)
      void playOne(name, source)
    },
    [playOne],
  )

  const setMark = useCallback((file: string, kind: Mark) => {
    setMarks((prev) => {
      const next = { ...prev }
      if (next[file] === kind) delete next[file]
      else next[file] = kind
      return next
    })
  }, [])

  const togglePick = (name: string, source: SfxSource) =>
    setPicks((prev) => {
      const next = { ...prev }
      if (next[name] === source) delete next[name]
      else next[name] = source
      return next
    })

  useEffect(() => {
    if (!cur) return
    document.getElementById(`v-${cur.name}-${cur.index}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [cur])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "SELECT") return
      if (items.length === 0) return
      const at = cur ? items.findIndex((it) => it.name === cur.name && it.index === cur.index) : -1
      const here = at >= 0 ? items[at]! : items[0]!
      const names = groups.flatMap(([, list]) => list)
      if (e.code === "Space") {
        e.preventDefault()
        playVariant(here.name, here.index)
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        const next = items[Math.min(Math.max(at + (e.key === "ArrowDown" ? 1 : -1), 0), items.length - 1)]!
        setCur({ name: next.name, index: next.index })
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault()
        const nextName = names[names.indexOf(here.name) + (e.key === "ArrowRight" ? 1 : -1)]
        if (nextName) setCur({ name: nextName, index: 0 })
      } else if (e.key === "a" || e.key === "A") void playAll(here.name)
      else if (e.key === "k" || e.key === "K") setMark(here.file, "keep")
      else if (e.key === "x" || e.key === "X") setMark(here.file, "drop")
      else if (e.key >= "1" && e.key <= "3") {
        const source = sourcesFor(here.name)[Number(e.key) - 1]
        if (source) compare(here.name, source)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [items, groups, cur, playVariant, playAll, setMark, compare])

  const exportChoice = async () => {
    const keep: Record<string, string[]> = {}
    const drop: Record<string, string[]> = {}
    for (const it of items) {
      const m = marks[it.file]
      if (m === "keep") (keep[it.name] ??= []).push(it.file)
      if (m === "drop") (drop[it.name] ??= []).push(it.file)
    }
    const text = JSON.stringify({ source: picks, keep, drop }, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setNotice("已复制到剪贴板")
    } catch {
      window.prompt("复制下面的内容", text)
    }
  }

  const keepCount = Object.values(marks).filter((m) => m === "keep").length
  const dropCount = Object.values(marks).filter((m) => m === "drop").length

  return (
    <div className="sfxlab">
      <header className="sfxlab__head">
        <h1>Choke! 音效实验室</h1>
        <p>
          仅开发模式 · 播放走游戏自己的链路 · 录音清单 <code>/sfx/manifest.json</code>，出处见 <code>public/sfx/CREDITS.md</code>
        </p>
        <div className="sfxlab__bar">
          <span>
            <kbd>空格</kbd> 播放 · <kbd>↑</kbd>
            <kbd>↓</kbd> 变体 · <kbd>←</kbd>
            <kbd>→</kbd> 音名 · <kbd>1</kbd>
            <kbd>2</kbd>
            <kbd>3</kbd> 合成 / 录音+低频 / 纯录音 · <kbd>A</kbd> 连播 · <kbd>K</kbd> 喜欢 · <kbd>X</kbd> 淘汰
          </span>
          <label>
            音量
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => {
                setVolume(Number(e.target.value))
                setSfxVolume(Number(e.target.value))
              }}
            />
          </label>
          <label title="战斗冲击音（命中、暴击、破防、倒下）在游戏里会叠合成低频体，默认开">
            <input type="checkbox" checked={body} onChange={(e) => setBody(e.target.checked)} /> 叠合成低频
          </label>
          <label title="游戏里每次播放录音都有 ±3% 的音高随机；关掉后每次一样，便于比较">
            <input type="checkbox" checked={fixedPitch} onChange={(e) => setFixedPitch(e.target.checked)} /> 固定音高
          </label>
          <input type="search" placeholder="筛选音名或用途…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="button" onClick={exportChoice}>
            复制我的选择（JSON）
          </button>
          <span>
            喜欢 {keepCount} · 淘汰 {dropCount} · 游戏用 {Object.keys(picks).length} 项 {notice}
          </span>
        </div>
      </header>

      <main className="sfxlab__main">
        {error && <div className="sfxlab__error">{error}</div>}
        {!lib && !error && <p className="sfxlab__muted">加载中…</p>}

        <h2>战斗命中（含属性层）</h2>
        <section className="sfxlab__name">
          <div className="sfxlab__head-row">
            <span className="sfxlab__title">playHit</span>
            <span className="sfxlab__use">属性层是纯合成，叠在命中 / 暴击上；Combo 越高音调越高。物理属性没有属性层。</span>
          </div>
          <div className="sfxlab__row-tools">
            <label>
              Combo
              <select value={hitCombo} onChange={(e) => setHitCombo(Number(e.target.value))}>
                {[0, 2, 4, 6, 8].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input type="checkbox" checked={hitCrit} onChange={(e) => setHitCrit(e.target.checked)} /> 暴击
            </label>
            {ELEMENTS.map((el) => (
              <button key={el} type="button" className="sfxlab__btn" onClick={() => playHit(hitCombo, hitCrit, el)}>
                ▶ {ELEMENT_LABEL[el]}
              </button>
            ))}
          </div>
        </section>

        {groups.map(([title, names]) => (
          <div key={title}>
            <h2>{title}</h2>
            {names.map((name) => {
              const files = lib!.manifest[name]!
              const sources = sourcesFor(name)
              return (
                <section className="sfxlab__name" key={name}>
                  <div className="sfxlab__head-row">
                    <span className="sfxlab__title">{name}</span>
                    <span className="sfxlab__use">{META.uses[name] ?? ""}</span>
                    <button type="button" className="sfxlab__btn" onClick={() => void playAll(name)}>
                      ▶ 全部连播
                    </button>
                  </div>

                  <div className="sfxlab__row-tools">
                    <span className="sfxlab__muted">对比</span>
                    {sources.map((source) => (
                      <button
                        key={source}
                        type="button"
                        className={`sfxlab__btn${playing === `${name}:${source}` ? " is-last" : ""}`}
                        onClick={() => compare(name, source)}
                      >
                        ▶ {sourceLabel(name, source)}
                      </button>
                    ))}
                    <span className="sfxlab__muted sfxlab__gap">定为游戏用</span>
                    {sources.map((source) => (
                      <button
                        key={source}
                        type="button"
                        className={`sfxlab__chip${picks[name] === source ? " is-on" : ""}`}
                        onClick={() => togglePick(name, source)}
                      >
                        {sourceLabel(name, source)}
                      </button>
                    ))}
                  </div>

                  {files.map((file, index) => {
                    const d = lib!.durations[name]?.[index]
                    const isCur = cur?.name === name && cur.index === index
                    return (
                      <div
                        id={`v-${name}-${index}`}
                        key={file}
                        className={`sfxlab__variant${isCur ? " is-cur" : ""}`}
                        onClick={() => playVariant(name, index)}
                      >
                        <span className="sfxlab__play">▶</span>
                        <span className="sfxlab__file">{file.split("/").pop()}</span>
                        <span className="sfxlab__dur">{d != null ? `${d.toFixed(2)}s` : ""}</span>
                        <span className="sfxlab__src">
                          {META.sources[file] ?? ""}
                          {(META.flags[file] ?? []).map((t) => (
                            <span className="sfxlab__tag" key={t}>
                              {t}
                            </span>
                          ))}
                        </span>
                        <button
                          type="button"
                          className={`sfxlab__mark is-keep${marks[file] === "keep" ? " is-on" : ""}`}
                          title="喜欢 (K)"
                          onClick={(e) => {
                            e.stopPropagation()
                            setMark(file, "keep")
                          }}
                        >
                          ♥
                        </button>
                        <button
                          type="button"
                          className={`sfxlab__mark is-drop${marks[file] === "drop" ? " is-on" : ""}`}
                          title="淘汰 (X)"
                          onClick={(e) => {
                            e.stopPropagation()
                            setMark(file, "drop")
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </section>
              )
            })}
          </div>
        ))}
      </main>
    </div>
  )
}
