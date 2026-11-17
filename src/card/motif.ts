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
