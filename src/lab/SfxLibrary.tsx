import { useEffect, useMemo, useState } from "react"

import { previewRaw } from "@/audio/sfx"
import { ELEMENT_LABEL } from "@/card/types"

import meta from "./sfx-meta.json"

/**
 * 素材库（仅开发模式）：浏览 tools/sfx-library/ 下各素材包里的音频，
 * 按包 / 关键字 / 时长筛选，试听，挑进候选清单，最后导出 JSON 给我转码入库。
 * 素材文件由 vite 开发服务器的 /__sfx-library 接口提供（见 tools/sfx-library-plugin.ts）。
 */

interface PackFile {
  path: string
  size: number
  dur: number | null
}
interface Pack {
  id: string
  name: string
  author?: string
  license: string
  licenseUrl?: string
  sourceUrl?: string
  checkedAt?: string
  attribution?: boolean
  note?: string
  files: PackFile[]
}
interface Candidate {
  target: string
  pack: string
  file: string
}

const CAND_KEY = "choke:sfx-lib-candidates"
const PAGE = 150

const META = meta as unknown as { groups: [string, string[]][]; uses: Record<string, string> }

/** 候选的"目标音名"：游戏里现有的音名，加上以后按属性 / 状态触发的几个 */
const TARGETS: { value: string; label: string }[] = [
  ...Object.entries(ELEMENT_LABEL).map(([el, label]) => ({ value: `element-${el}`, label: `属性技能 · ${label}` })),
  { value: "status-apply", label: "状态生效" },
  ...META.groups.flatMap(([group, names]) => names.map((n) => ({ value: n, label: `${n}（${group}）` }))),
]

function readCandidates(): Candidate[] {
  try {
    return JSON.parse(window.localStorage.getItem(CAND_KEY) || "[]") as Candidate[]
  } catch {
    return []
  }
}

const fileUrl = (pack: string, path: string) =>
  `/__sfx-library/f/${encodeURIComponent(pack)}/${path.split("/").map(encodeURIComponent).join("/")}`

export function SfxLibrary() {
  const [packs, setPacks] = useState<Pack[] | null>(null)
  const [error, setError] = useState("")
  const [packId, setPackId] = useState("")
  const [query, setQuery] = useState("")
  const [minDur, setMinDur] = useState("")
  const [maxDur, setMaxDur] = useState("")
  const [cands, setCands] = useState<Candidate[]>(readCandidates)
  const [target, setTarget] = useState(TARGETS[0]!.value)
  const [cur, setCur] = useState("")
  const [notice, setNotice] = useState("")

  useEffect(() => {
    fetch("/__sfx-library/index.json?refresh=1")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ packs: Pack[] }>
      })
      .then((d) => setPacks(d.packs))
      .catch((e: unknown) => setError(`读取素材库失败：${String(e)}。请用 pnpm dev 打开本页。`))
  }, [])

  useEffect(() => {
    window.localStorage.setItem(CAND_KEY, JSON.stringify(cands))
  }, [cands])

  const filterKey = `${packId}|${query}|${minDur}|${maxDur}`
  const [more, setMore] = useState({ key: "", n: PAGE })
  const limit = more.key === filterKey ? more.n : PAGE
  const setLimit = (fn: (n: number) => number) => setMore({ key: filterKey, n: fn(limit) })

  const rows = useMemo(() => {
    if (!packs) return []
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const lo = minDur ? Number(minDur) : 0
    const hi = maxDur ? Number(maxDur) : Infinity
    const out: { pack: Pack; file: PackFile }[] = []
    for (const pack of packs) {
      if (packId && pack.id !== packId) continue
      for (const file of pack.files) {
        if (file.dur != null && (file.dur < lo || file.dur > hi)) continue
        if (file.dur == null && (lo > 0 || hi < Infinity)) continue
        const hay = `${pack.id} ${file.path}`.toLowerCase()
        if (words.every((w) => hay.includes(w))) out.push({ pack, file })
      }
    }
    return out
  }, [packs, packId, query, minDur, maxDur])

  const candKey = (c: { pack: string; file: string }) => `${c.pack}/${c.file}`
  const candSet = new Set(cands.map((c) => `${candKey(c)}→${c.target}`))

  const play = async (pack: Pack, file: PackFile) => {
    setCur(`${pack.id}/${file.path}`)
    try {
      const res = await fetch(fileUrl(pack.id, file.path))
      await previewRaw(await res.arrayBuffer())
    } catch (e) {
      setNotice(`播放失败：${String(e)}`)
    }
  }

  const toggleCand = (pack: Pack, file: PackFile) => {
    const next: Candidate = { target, pack: pack.id, file: file.path }
    setCands((prev) =>
      candSet.has(`${candKey(next)}→${target}`)
        ? prev.filter((c) => !(c.target === target && c.pack === pack.id && c.file === file.path))
        : [...prev, next],
    )
  }

  const exportCands = async () => {
    const byPack = new Map(packs?.map((p) => [p.id, p]))
    const out = cands.map((c) => {
      const p = byPack.get(c.pack)
      return {
        target: c.target,
        pack: c.pack,
        file: c.file,
        packName: p?.name,
        author: p?.author,
        license: p?.license,
        attribution: p?.attribution ?? null,
        sourceUrl: p?.sourceUrl,
        checkedAt: p?.checkedAt,
      }
    })
    const text = JSON.stringify(out, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setNotice("候选清单已复制到剪贴板")
    } catch {
      window.prompt("复制下面的内容", text)
    }
  }

  const unknownLicense = packs?.filter((p) => p.license === "未知").length ?? 0
  const total = packs?.reduce((s, p) => s + p.files.length, 0) ?? 0

  return (
    <div>
      {error && <div className="sfxlab__error">{error}</div>}
      {!packs && !error && <p className="sfxlab__muted">加载中…</p>}
      {packs && packs.length === 0 && (
        <div className="sfxlab__error">
          素材库是空的。先运行 <code>node tools/fetch-sfx-packs.mjs vcsl</code>（或 kenney / oga）下载素材包。
        </div>
      )}

      {packs && packs.length > 0 && (
        <>
          <section className="sfxlab__name">
            <div className="sfxlab__row-tools">
              <label>
                素材包
                <select value={packId} onChange={(e) => setPackId(e.target.value)}>
                  <option value="">全部（{packs.length} 个包 / {total} 个文件）</option>
                  {packs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}（{p.files.length}）
                    </option>
                  ))}
                </select>
              </label>
              <input
                type="search"
                placeholder="关键字（空格分隔，全部命中）"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ minWidth: 220 }}
              />
              <label>
                时长
                <input type="number" min="0" step="0.1" placeholder="最短" value={minDur} onChange={(e) => setMinDur(e.target.value)} style={{ width: 64 }} />
                –
                <input type="number" min="0" step="0.1" placeholder="最长" value={maxDur} onChange={(e) => setMaxDur(e.target.value)} style={{ width: 64 }} />
                秒
              </label>
              <span className="sfxlab__muted">命中 {rows.length} 个</span>
            </div>
            {unknownLicense > 0 && <div className="sfxlab__warn">有 {unknownLicense} 个素材包没有 pack.json，授权未知，不要用。</div>}
            {packId && (
              <div className="sfxlab__muted" style={{ marginTop: 8 }}>
                {(() => {
                  const p = packs.find((x) => x.id === packId)!
                  return (
                    <>
                      作者 {p.author ?? "未知"} · 授权 {p.license}
                      {p.attribution ? "（需署名）" : ""} · 核对于 {p.checkedAt ?? "—"}
                      {p.sourceUrl && (
                        <>
                          {" · "}
                          <a href={p.sourceUrl} target="_blank" rel="noreferrer">
                            来源页
                          </a>
                        </>
                      )}
                      {p.note ? ` · ${p.note}` : ""}
                    </>
                  )
                })()}
              </div>
            )}
          </section>

          <section className="sfxlab__name">
            <div className="sfxlab__row-tools">
              <label>
                加入候选时的目标
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  {TARGETS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="sfxlab__muted">
                {META.uses[target] ?? ""} 已选 {cands.length} 个候选（当前目标 {cands.filter((c) => c.target === target).length} 个）
              </span>
              <button type="button" className="sfxlab__btn" onClick={exportCands}>
                复制候选清单（JSON）
              </button>
              <button
                type="button"
                className="sfxlab__btn"
                onClick={() => {
                  if (window.confirm("清空所有候选？")) setCands([])
                }}
              >
                清空
              </button>
              {notice && <span className="sfxlab__muted">{notice}</span>}
            </div>
          </section>

          {rows.slice(0, limit).map(({ pack, file }) => {
            const id = `${pack.id}/${file.path}`
            const on = candSet.has(`${id}→${target}`)
            const targets = cands.filter((c) => c.pack === pack.id && c.file === file.path).map((c) => c.target)
            return (
              <div key={id} className={`sfxlab__variant${cur === id ? " is-cur" : ""}`} onClick={() => void play(pack, file)}>
                <span className="sfxlab__play">▶</span>
                <span className="sfxlab__file" title={id} style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {packId ? file.path : id}
                </span>
                <span className="sfxlab__dur">{file.dur != null ? `${file.dur.toFixed(2)}s` : "—"}</span>
                <span className="sfxlab__src">{targets.length > 0 ? `→ ${targets.join("、")}` : ""}</span>
                <button
                  type="button"
                  className={`sfxlab__mark is-keep${on ? " is-on" : ""}`}
                  title="加入 / 移出当前目标的候选"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleCand(pack, file)
                  }}
                >
                  ♥
                </button>
              </div>
            )
          })}
          {rows.length > limit && (
            <p>
              <button type="button" className="sfxlab__btn" onClick={() => setLimit((n) => n + PAGE)}>
                再显示 {Math.min(PAGE, rows.length - limit)} 个（还剩 {rows.length - limit}）
              </button>
            </p>
          )}
        </>
      )}
    </div>
  )
}
