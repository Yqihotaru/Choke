import { closeSync, createReadStream, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs"
import { extname, join, relative, resolve, sep } from "node:path"
import type { Plugin } from "vite"

/**
 * 音效素材库的开发服务器接口（仅 vite dev，不进正式版打包）。
 * 素材放在 tools/sfx-library/<素材包>/ 下，每个包可带一个 pack.json 记录出处与授权。
 *   GET /__sfx-library/index.json[?refresh=1]   所有包与文件清单（含时长）
 *   GET /__sfx-library/f/<包>/<相对路径>          文件本体
 */

const ROOT = resolve(import.meta.dirname, "sfx-library")
const BASE = "/__sfx-library"
const AUDIO = new Set([".wav", ".ogg", ".mp3", ".flac", ".opus"])
const MIME: Record<string, string> = {
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".opus": "audio/ogg",
}

interface PackMeta {
  name?: string
  author?: string
  license?: string
  licenseUrl?: string
  sourceUrl?: string
  checkedAt?: string
  /** 授权是否要求署名（CC-BY 为 true） */
  attribution?: boolean
  note?: string
}

function readChunk(fd: number, position: number, length: number) {
  const buf = Buffer.alloc(length)
  const n = readSync(fd, buf, 0, length, position)
  return buf.subarray(0, n)
}

/** 只读文件头估算时长（秒）；读不出来返回 null */
function durationOf(file: string, size: number): number | null {
  const ext = extname(file).toLowerCase()
  let fd = -1
  try {
    fd = openSync(file, "r")
    if (ext === ".wav") {
      const head = readChunk(fd, 0, Math.min(size, 4096))
      const fmt = head.indexOf("fmt ")
      const data = head.indexOf("data")
      if (fmt < 0 || data < 0) return null
      const byteRate = head.readUInt32LE(fmt + 16)
      const dataSize = head.readUInt32LE(data + 4)
      return byteRate > 0 ? Math.min(dataSize, size - data - 8) / byteRate : null
    }
    if (ext === ".flac") {
      const head = readChunk(fd, 0, 64)
      if (head.length < 26 || head.toString("latin1", 0, 4) !== "fLaC") return null
      const hi = head.readUInt32BE(18)
      const rate = hi >>> 12
      const total = (hi & 0xf) * 2 ** 32 + head.readUInt32BE(22)
      return rate > 0 ? total / rate : null
    }
    if (ext === ".ogg" || ext === ".opus") {
      const head = readChunk(fd, 0, 256)
      const vorbis = head.indexOf("\x01vorbis", 0, "latin1")
      const opus = head.indexOf("OpusHead", 0, "latin1")
      let rate = 0
      if (vorbis >= 0) rate = head.readUInt32LE(vorbis + 12)
      else if (opus >= 0) rate = 48000
      if (!rate) return null
      const tailLen = Math.min(size, 65536)
      const tail = readChunk(fd, size - tailLen, tailLen)
      const last = tail.lastIndexOf("OggS", tail.length, "latin1")
      if (last < 0 || last + 14 > tail.length) return null
      const granule = Number(tail.readBigUInt64LE(last + 6))
      return granule > 0 ? granule / rate : null
    }
    return null
  } catch {
    return null
  } finally {
    if (fd >= 0) closeSync(fd)
  }
}

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (AUDIO.has(extname(entry.name).toLowerCase())) out.push(full)
  }
}

function buildIndex() {
  if (!existsSync(ROOT)) return { packs: [] }
  const packs = []
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue
    const dir = join(ROOT, entry.name)
    let meta: PackMeta = {}
    try {
      meta = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8")) as PackMeta
    } catch {
      // 没有 pack.json 时按"授权未知"处理
    }
    const found: string[] = []
    walk(dir, found)
    const files = found
      .map((file) => {
        const size = statSync(file).size
        return {
          path: relative(dir, file).split(sep).join("/"),
          size,
          dur: durationOf(file, size),
        }
      })
      .sort((a, b) => a.path.localeCompare(b.path))
    packs.push({ id: entry.name, license: "未知", ...meta, name: meta.name ?? entry.name, files })
  }
  return { packs }
}

export function sfxLibraryPlugin(): Plugin {
  let cache: ReturnType<typeof buildIndex> | null = null
  return {
    name: "choke-sfx-library",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(BASE, (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost")
        if (url.pathname === "/index.json") {
          if (!cache || url.searchParams.has("refresh")) cache = buildIndex()
          res.setHeader("Content-Type", "application/json; charset=utf-8")
          res.end(JSON.stringify(cache))
          return
        }
        if (url.pathname.startsWith("/f/")) {
          const rel = decodeURIComponent(url.pathname.slice(3))
          const full = resolve(ROOT, rel)
          const ext = extname(full).toLowerCase()
          if (!full.startsWith(ROOT + sep) || !AUDIO.has(ext) || !existsSync(full)) {
            res.statusCode = 404
            res.end("not found")
            return
          }
          res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream")
          createReadStream(full).pipe(res)
          return
        }
        next()
      })
    },
  }
}
