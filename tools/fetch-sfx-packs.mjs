/**
 * 下载音效素材包到 tools/sfx-library/（该目录不进仓库）。
 * 用法：node tools/fetch-sfx-packs.mjs vcsl
 *
 * vcsl：Versilian Community Sample Library（CC0），只取一批"纯音"乐器与打击乐。
 * 每个包写一份 pack.json（来源、作者、授权、核对日期），筛选页读它。
 */
import { execFile, execFileSync } from "node:child_process"
import { promisify } from "node:util"
import { mkdirSync, writeFileSync, existsSync, renameSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "sfx-library")
const execFileAsync = promisify(execFile)

const VCSL_PICK = [
  "Idiophones/Struck Idiophones/Glockenspiel/",
  "Idiophones/Struck Idiophones/Tubular Glockenspiel/",
  "Idiophones/Struck Idiophones/Marimba/",
  "Idiophones/Struck Idiophones/Xylophone/Soft Mallets/",
  "Idiophones/Struck Idiophones/Vibraphone/Soft Mallets/",
  "Idiophones/Struck Idiophones/Hand Chimes/",
  "Idiophones/Struck Idiophones/Hand Bells, Nepalese/",
  "Idiophones/Struck Idiophones/Finger Cymbals/",
  "Idiophones/Struck Idiophones/Bell Tree/Individual/",
  "Idiophones/Struck Idiophones/Agogo Bells/",
  "Idiophones/Struck Idiophones/Cowbells/",
  "Idiophones/Struck Idiophones/Triangles/",
  "Idiophones/Struck Idiophones/Tubular Bells 3 - Legacy/",
  "Idiophones/Struck Idiophones/Woodblock/",
  "Idiophones/Struck Idiophones/Claves/",
  "Idiophones/Struck Idiophones/Claps/",
  "Idiophones/Struck Idiophones/Slapstick/",
  "Idiophones/Struck Idiophones/Hi-Hat Cymbal/",
  "Idiophones/Struck Idiophones/Anvil/",
  "Idiophones/Struck Idiophones/Brake Drum/",
  "Idiophones/Struck Idiophones/Balafon/Soft Mallet/",
  "Idiophones/Struck Idiophones/Gong 1/",
  "Idiophones/Plucked Idiophones/Kalimba, Kenya/",
  "Idiophones/Plucked Idiophones/Kalimba, Tanzania/",
  "Idiophones/Friction Idiophones/Wine Glasses/Releases/Fast/",
  "Membranophones/Struck Membranophones/Bass Drum 1/",
  "Membranophones/Struck Membranophones/Conga/",
  "Membranophones/Struck Membranophones/Darbuka/",
  "Membranophones/Struck Membranophones/Bongos/",
  "Membranophones/Struck Membranophones/Frame Drum/",
  "Membranophones/Struck Membranophones/Tom 1/Mallet/",
  "Membranophones/Struck Membranophones/Tom 2/Mallet/",
  "Membranophones/Struck Membranophones/Snare Drum, Modern 3/",
]

async function pool(items, size, fn) {
  let next = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const item = items[next++]
        await fn(item)
      }
    }),
  )
}

async function fetchVcsl() {
  const tree = await (
    await fetch("https://api.github.com/repos/sgossner/VCSL/git/trees/master?recursive=1", {
      headers: { "User-Agent": "choke-sfx" },
    })
  ).json()
  const files = tree.tree.filter(
    (e) => e.type === "blob" && /\.(wav|flac|ogg)$/i.test(e.path) && VCSL_PICK.some((p) => e.path.startsWith(p)),
  )
  const outDir = join(ROOT, "vcsl")
  const total = files.reduce((s, f) => s + f.size, 0)
  console.log(`vcsl: ${files.length} 个文件，约 ${(total / 1048576).toFixed(0)} MB`)
  let done = 0
  await pool(files, 4, async (f) => {
    const dest = join(outDir, f.path)
    if (!existsSync(dest)) {
      const url = "https://raw.githubusercontent.com/sgossner/VCSL/master/" + f.path.split("/").map(encodeURIComponent).join("/")
      mkdirSync(dirname(dest), { recursive: true })
      // Node 自带的 fetch 连 raw.githubusercontent.com 经常超时，改用 curl（自带重试）
      await execFileAsync("curl", ["-sSL", "--fail", "--retry", "5", "--retry-delay", "2", "--retry-all-errors", "-o", dest + ".part", url])
      renameSync(dest + ".part", dest)
    }
    done += 1
    if (done % 50 === 0) console.log(`  ${done}/${files.length}`)
  })
  writeFileSync(
    join(outDir, "pack.json"),
    JSON.stringify(
      {
        name: "VCSL 乐器与打击乐（纯音）",
        author: "Versilian Studios LLC (Sam Gossner et al.)",
        license: "CC0 1.0",
        licenseUrl: "https://github.com/sgossner/VCSL/blob/master/LICENSE",
        sourceUrl: "https://github.com/sgossner/VCSL",
        checkedAt: new Date().toISOString().slice(0, 10),
        attribution: false,
        note: "README 与 LICENSE 均声明 CC0，无需署名；只取了其中一批钟琴、木琴、铃、钟、鼓等。",
      },
      null,
      2,
    ),
  )
  console.log("完成")
}

/** Kenney 的音频包（页面标注 CC0）。下载按钮要先向 download-link 换一个带签名的临时地址，这里照做 */
const KENNEY = {
  "digital-audio": "Digital Audio",
  "music-jingles": "Music Jingles",
  "casino-audio": "Casino Audio",
  "impact-sounds": "Impact Sounds",
  "interface-sounds": "Interface Sounds",
  "rpg-audio": "RPG Audio",
  "sci-fi-sounds": "Sci-fi Sounds",
  "ui-audio": "UI Audio",
}

async function fetchKenney() {
  for (const [slug, title] of Object.entries(KENNEY)) {
    const dir = join(ROOT, `kenney-${slug}`)
    if (existsSync(join(dir, "pack.json"))) {
      console.log(`${slug}: 已有，跳过`)
      continue
    }
    const page = `https://kenney.nl/assets/${slug}`
    const id = Buffer.from(`assets/${slug}`).toString("hex")
    const headers = { "User-Agent": "Mozilla/5.0", Referer: page }
    const html = await (await fetch(page, { headers })).text()
    if (!/Creative Commons CC0/i.test(html)) {
      console.log(`${slug}: 页面没有标注 CC0，跳过`)
      continue
    }
    const link = await (await fetch(`https://kenney.nl/download-link/${id}`, { headers })).json()
    if (!link.url) throw new Error(`${slug}: 没拿到下载地址 ${JSON.stringify(link)}`)
    const bytes = Buffer.from(await (await fetch(link.url, { headers })).arrayBuffer())
    mkdirSync(dir, { recursive: true })
    const zip = join(dir, "_pack.zip")
    writeFileSync(zip, bytes)
    execFileSync("tar", ["-xf", zip, "-C", dir])
    rmSync(zip)
    writeFileSync(
      join(dir, "pack.json"),
      JSON.stringify(
        {
          name: `Kenney - ${title}`,
          author: "Kenney (kenney.nl)",
          license: "CC0 1.0",
          licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
          sourceUrl: page,
          checkedAt: new Date().toISOString().slice(0, 10),
          attribution: false,
          note: "页面 License 一栏标注 Creative Commons CC0",
        },
        null,
        2,
      ),
    )
    console.log(`${slug}: 完成`)
  }
}

/** OpenGameArt：逐页核对，只收许可图标仅为 CC0 的页面；其余一律跳过并报出来 */
const OGA = [
  "37-hitspunches",
  "freeze-spell-0",
  "ice-spells",
  "earth-element-magic-spell",
  "magic-spell-sfx",
  "spell-sounds",
  "elemental-spell",
  "point-bell",
  "bell-arpeggio-24",
]

async function fetchOga() {
  for (const slug of OGA) {
    const dir = join(ROOT, `oga-${slug}`)
    if (existsSync(join(dir, "pack.json"))) {
      console.log(`${slug}: 已有，跳过`)
      continue
    }
    const page = `https://opengameart.org/content/${slug}`
    const html = await (await fetch(page, { headers: { "User-Agent": "Mozilla/5.0" } })).text()
    const licenses = [...new Set([...html.matchAll(/license_images\/([a-z0-9_-]+)\.png/gi)].map((m) => m[1].toLowerCase()))]
    if (licenses.length !== 1 || licenses[0] !== "cc0") {
      console.log(`${slug}: 许可是 [${licenses.join(", ") || "未识别"}]，不是纯 CC0，跳过`)
      continue
    }
    const title = html.match(/property="og:title" content="([^"]*)"/)?.[1] ?? slug
    const author = html.match(/Author:&nbsp;[\s\S]{0,200}?<a href="\/users\/[^"]*">([^<]*)</)?.[1] ?? "未知"
    const urls = [
      ...new Set(
        [...html.matchAll(/href="(https:\/\/opengameart\.org\/sites\/default\/files\/[^"]*\.(?:ogg|wav|mp3|flac|zip|7z))"/gi)].map((m) => m[1]),
      ),
    ]
    if (urls.length === 0) {
      console.log(`${slug}: 没找到可下载的音频文件（可能是 7z 或要登录），跳过`)
      continue
    }
    mkdirSync(dir, { recursive: true })
    for (const url of urls) {
      const name = decodeURIComponent(url.split("/").pop())
      const bytes = Buffer.from(await (await fetch(url)).arrayBuffer())
      const dest = join(dir, name)
      writeFileSync(dest, bytes)
      if (/\.(zip|7z)$/i.test(name)) {
        if (/\.7z$/i.test(name)) {
          // Windows 自带的 tar 解不了 7z；用环境变量 SEVENZIP 指定 7z/7za 的路径
          const seven = process.env.SEVENZIP
          if (!seven) throw new Error("需要解 7z：请设置环境变量 SEVENZIP 指向 7z.exe / 7za.exe")
          execFileSync(seven, ["x", "-y", `-o${dir}`, dest], { stdio: "ignore" })
        } else execFileSync("tar", ["-xf", dest, "-C", dir])
        rmSync(dest)
      }
    }
    writeFileSync(
      join(dir, "pack.json"),
      JSON.stringify(
        {
          name: `OpenGameArt - ${title}`,
          author,
          license: "CC0 1.0",
          licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
          sourceUrl: page,
          checkedAt: new Date().toISOString().slice(0, 10),
          attribution: false,
          note: "页面许可图标仅为 CC0",
        },
        null,
        2,
      ),
    )
    console.log(`${slug}: 完成（${urls.length} 个文件，作者 ${author}）`)
  }
}

const target = process.argv[2]
if (target === "vcsl") await fetchVcsl()
else if (target === "kenney") await fetchKenney()
else if (target === "oga") await fetchOga()
else console.log("用法: node tools/fetch-sfx-packs.mjs vcsl|kenney|oga")
