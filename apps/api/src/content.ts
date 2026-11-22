import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

// import 时即完成 schema + 交叉引用校验；失败会直接抛错，服务端拒绝启动
import { CONTENT_FILES } from "@choke/shared/content"

export const CONTENT_DIR = path.resolve(import.meta.dirname, "../../../content")

function listFiles(dir: string, prefix = ""): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      return entry.isDirectory() ? listFiles(path.join(dir, entry.name), rel) : [rel]
    })
    .sort()
}

/** content/ 里所有文件；有没接入的文件就报错，避免新加的内容被悄悄忽略 */
function checkFiles(): string[] {
  const files = listFiles(CONTENT_DIR)
  const known = new Set<string>(CONTENT_FILES)
  const unknown = files.filter((file) => !known.has(file))
  const missing = CONTENT_FILES.filter((file) => !files.includes(file))
  if (unknown.length > 0 || missing.length > 0) {
    throw new Error(
      [
        "content/ 目录和已接入的文件对不上：",
        unknown.length > 0 ? `  没接入：${unknown.join(", ")}（在 packages/shared/src/content/index.ts 里接入）` : "",
        missing.length > 0 ? `  缺少：${missing.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }
  return files
}

/**
 * 内容版本 = 全部内容文件的哈希（换行统一成 LF，Windows / Linux 检出结果一致）。
 * 出征记录开始时的版本，重放时用同一版内容。
 */
function hashContent(files: string[]): string {
  const hash = crypto.createHash("sha256")
  for (const file of files) {
    const text = fs.readFileSync(path.join(CONTENT_DIR, file), "utf8").replace(/\r\n/g, "\n")
    hash.update(`${file}\0${text}\0`)
  }
  return hash.digest("hex").slice(0, 12)
}

export const CONTENT_VERSION = hashContent(checkFiles())
