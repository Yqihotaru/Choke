/**
 * 种子随机流。只用 32 位整数运算，任何 JS 引擎（浏览器 / Node）算出来都一样。
 *
 * 一场出征只存一个种子；各处按名字派生独立的流，例如 `${种子}/battle-3/player`。
 * 流的状态就是一个 uint32，存在 BattleState 里，复制 / 序列化战斗时一起带走。
 */

/** 字符串 → uint32（cyrb53 的 32 位输出） */
export function hashSeed(text: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  return h1 >>> 0
}

/** 从种子派生一条命名随机流的初始状态 */
export function deriveStream(seed: string, name: string): number {
  return hashSeed(`${seed}/${name}`)
}

/** mulberry32 走一步：返回 [新状态, [0, 1) 的随机数] */
export function nextRandom(stream: number): [number, number] {
  const a = (stream + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return [a >>> 0, ((t ^ (t >>> 14)) >>> 0) / 4294967296]
}

/** 新种子（服务端用；客户端只在本地试玩时用） */
export function randomSeed(): string {
  const bytes = new Uint8Array(12)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}
