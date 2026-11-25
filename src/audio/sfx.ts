import type { Element } from "@/card/types"

type SfxName =
  | "click"
  | "hit"
  | "crit"
  | "miss"
  | "heal"
  | "guard"
  | "turn"
  | "win"
  | "lose"
  | "cutin"
  | "break"
  | "down"
  | "tick"
  | "pick"
  | "lift"
  | "drop"
  | "thud"
  | "paper"
  | "flip"
  | "slide"
  | "coin"
  | "levelup"
  | "melt"
  | "shatter"
  | "deny"
  | "error"
  | "success"
  | "equip"
  | "unequip"
  | "tear"
  | "charge"
  | "shine"
  | "reveal-c"
  | "reveal-r"
  | "reveal-e"
  | "reveal-l"
  | "reveal-radiant"
  | "reveal-prismatic"
  | "hover"
  | "open"
  | "close"
  | "tab"
  | "toggle"
  | "notify"
  | "claim"
  | "send"
  | "whoosh"
  | "deal"
  | "stamp"
  | "select"
  | "ap"
  | "start"
  | "warn"
  | "laser"
  | "buff"
  | "debuff"
  | "star"

export type SfxId = SfxName

interface SfxOptions {
  rate?: number
  volume?: number
  /** 过多少秒再响。排在音频时钟上，不占 JS 定时器：一串发牌声、落地声用它错开 */
  delay?: number
}

/** 正在排的这一声整体往后挪多少秒；只在 playSfx 同步渲染期间非零 */
let startOffset = 0

const STORAGE_KEY = "choke:sfx-volume"

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuf: AudioBuffer | null = null
let volume = readVolume()

function readVolume() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const n = raw == null ? 0.8 : Number(raw)
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0.8
  } catch {
    return 0.8
  }
}

export function getSfxVolume() {
  return volume
}

export function setSfxVolume(next: number) {
  volume = Math.min(Math.max(next, 0), 1)
  try {
    window.localStorage.setItem(STORAGE_KEY, String(volume))
  } catch {
    // 存储不可用时只保留内存值
  }
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02)
}

function ensure() {
  if (ctx && master) {
    if (ctx.state === "suspended") void ctx.resume()
    return { ctx, master }
  }
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  ctx = new Ctor()
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -14
  comp.ratio.value = 6
  master = ctx.createGain()
  master.gain.value = volume
  master.connect(comp)
  comp.connect(ctx.destination)
  const len = ctx.sampleRate
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = noiseBuf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return { ctx, master }
}

/**
 * 每个音名用什么来源：
 * - synth：纯合成（电子音，默认）
 * - sample：录音 + 合成低频体
 * - bare：纯录音，不叠合成
 * 游戏默认一律用合成音，不请求 public/sfx/；试听页（/sfx-lab，仅开发模式）需要听录音样本时再按需加载。
 */
export type SfxSource = "synth" | "sample" | "bare"
export const SFX_SOURCE: Partial<Record<SfxId, SfxSource>> = {}

/** 真实录音样本：public/sfx/manifest.json 里列出的音名走样本，其余回退合成。解码失败的变体留 null，保证下标与清单对齐。 */
const samples = new Map<SfxName, (AudioBuffer | null)[]>()
let manifestData: Record<string, string[]> = {}
let samplesLoading: Promise<void> | null = null

function preloadSamples(c: AudioContext) {
  if (samplesLoading) return samplesLoading
  const base = `${import.meta.env.BASE_URL}sfx/`
  samplesLoading = (async () => {
    let manifest: Record<string, string[]>
    try {
      const res = await fetch(`${base}manifest.json`)
      if (!res.ok) return
      manifest = await res.json()
    } catch {
      return
    }
    manifestData = manifest
    await Promise.all(
      Object.entries(manifest).map(async ([name, files]) => {
        const decoded = await Promise.all(
          files.map(async (file) => {
            try {
              const res = await fetch(`${base}${file}`)
              if (!res.ok) return null
              return await c.decodeAudioData(await res.arrayBuffer())
            } catch {
              return null
            }
          }),
        )
        if (decoded.some((b) => b !== null)) samples.set(name as SfxName, decoded)
      }),
    )
  })()
  return samplesLoading
}

/** 播样本时保留的合成低频体：战斗冲击需要分量，样本本身不带。 */
const SAMPLE_BODY: Partial<Record<SfxName, (c: AudioContext, o: AudioNode, r: number) => void>> = {
  hit: (c, o, r) => tone(c, o, { type: "sine", f0: 190, f1: 55, dur: 0.16, gain: 0.5 }, r),
  crit: (c, o, r) => tone(c, o, { type: "sine", f0: 52, f1: 30, dur: 0.5, gain: 0.7 }, r),
  break: (c, o, r) => tone(c, o, { type: "sine", f0: 120, f1: 45, dur: 0.3, gain: 0.5 }, r),
  down: (c, o, r) => tone(c, o, { type: "sine", f0: 70, f1: 30, dur: 0.6, gain: 0.6 }, r),
}

interface PlayOptions {
  source?: SfxSource
  /** 指定第几个变体；不指定则随机 */
  variant?: number
  /** 关掉 ±3% 的音高随机 */
  fixedPitch?: boolean
}

function playSample(c: AudioContext, o: AudioNode, name: SfxName, rate: number, opts: PlayOptions = {}) {
  const variants = samples.get(name)
  if (!variants) return false
  const usable = variants.filter((b): b is AudioBuffer => b !== null)
  const buffer = opts.variant != null ? variants[opts.variant] : usable[Math.floor(Math.random() * usable.length)]
  if (!buffer) return false
  const src = c.createBufferSource()
  src.buffer = buffer
  // 同一个音每次略有不同，连点时不会像机关枪
  src.playbackRate.value = rate * (opts.fixedPitch ? 1 : 0.97 + Math.random() * 0.06)
  src.connect(o)
  src.start(c.currentTime + startOffset)
  if (opts.source !== "bare") SAMPLE_BODY[name]?.(c, o, rate)
  return true
}

function render(c: AudioContext, o: AudioNode, name: SfxName, rate: number, opts: PlayOptions = {}) {
  const source = opts.source ?? SFX_SOURCE[name] ?? "synth"
  if (source !== "synth" && playSample(c, o, name, rate, { ...opts, source })) return
  SYNTH[name](c, o, rate)
}

interface ToneSpec {
  type?: OscillatorType
  f0: number
  f1?: number
  dur: number
  gain?: number
  at?: number
  attack?: number
}

function tone(c: AudioContext, out: AudioNode, spec: ToneSpec, rate: number) {
  const t = c.currentTime + startOffset + (spec.at ?? 0)
  const attack = spec.attack ?? 0.004
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = spec.type ?? "sine"
  osc.frequency.setValueAtTime(spec.f0 * rate, t)
  if (spec.f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(spec.f1 * rate, 1), t + spec.dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(spec.gain ?? 0.3, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + spec.dur)
  osc.connect(g)
  g.connect(out)
  osc.start(t)
  osc.stop(t + spec.dur + 0.02)
}

interface NoiseSpec {
  filter?: BiquadFilterType
  f0: number
  f1?: number
  q?: number
  dur: number
  gain?: number
  at?: number
}

function noise(c: AudioContext, out: AudioNode, spec: NoiseSpec, rate: number) {
  if (!noiseBuf) return
  const t = c.currentTime + startOffset + (spec.at ?? 0)
  const src = c.createBufferSource()
  src.buffer = noiseBuf
  src.loop = true
  const f = c.createBiquadFilter()
  f.type = spec.filter ?? "bandpass"
  f.Q.value = spec.q ?? 1
  f.frequency.setValueAtTime(spec.f0 * rate, t)
  if (spec.f1 != null) f.frequency.exponentialRampToValueAtTime(Math.max(spec.f1 * rate, 20), t + spec.dur)
  const g = c.createGain()
  g.gain.setValueAtTime(spec.gain ?? 0.3, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + spec.dur)
  src.connect(f)
  f.connect(g)
  g.connect(out)
  src.start(t, Math.random() * 0.5)
  src.stop(t + spec.dur + 0.02)
}

/** 基础冲击：瞬态 + 噪声拍击 + 低频体 */
function impact(c: AudioContext, o: AudioNode, r: number, power = 1) {
  noise(c, o, { filter: "bandpass", f0: 2400, f1: 400, q: 0.8, dur: 0.07, gain: 0.5 * power }, r)
  tone(c, o, { type: "sine", f0: 190, f1: 55, dur: 0.16, gain: 0.7 * power }, r)
  tone(c, o, { type: "triangle", f0: 900, f1: 200, dur: 0.05, gain: 0.25 * power }, r)
}

/** 属性层：叠在基础冲击上，让不同属性一听就能分辨 */
function elementLayer(c: AudioContext, o: AudioNode, el: Element, r: number) {
  switch (el) {
    case "fire":
      noise(c, o, { filter: "lowpass", f0: 600, f1: 3200, q: 0.7, dur: 0.28, gain: 0.45 }, r)
      for (let i = 0; i < 4; i++)
        noise(c, o, { filter: "highpass", f0: 3500, dur: 0.025, gain: 0.25, at: 0.05 + i * 0.05 + Math.random() * 0.02 }, r)
      break
    case "ice":
      tone(c, o, { type: "sine", f0: 2600, f1: 2400, dur: 0.35, gain: 0.22 }, r)
      tone(c, o, { type: "sine", f0: 3900, f1: 3600, dur: 0.28, gain: 0.14, at: 0.02 }, r)
      noise(c, o, { filter: "highpass", f0: 6000, dur: 0.12, gain: 0.3 }, r)
      break
    case "thunder":
      tone(c, o, { type: "sawtooth", f0: 2400, f1: 120, dur: 0.14, gain: 0.3 }, r)
      noise(c, o, { filter: "highpass", f0: 2000, dur: 0.05, gain: 0.5 }, r)
      noise(c, o, { filter: "highpass", f0: 2500, dur: 0.05, gain: 0.4, at: 0.07 }, r)
      break
    case "light":
      ;[1318, 1760, 2349].forEach((f, i) => tone(c, o, { type: "sine", f0: f, dur: 0.4, gain: 0.2, at: i * 0.045 }, r))
      break
    case "dark":
      tone(c, o, { type: "sawtooth", f0: 140, f1: 38, dur: 0.45, gain: 0.35 }, r)
      tone(c, o, { type: "sawtooth", f0: 148, f1: 40, dur: 0.45, gain: 0.3 }, r)
      break
    case "metal":
      tone(c, o, { type: "square", f0: 1180, dur: 0.3, gain: 0.1 }, r)
      tone(c, o, { type: "square", f0: 1770, dur: 0.26, gain: 0.08 }, r)
      noise(c, o, { filter: "highpass", f0: 5000, dur: 0.06, gain: 0.3 }, r)
      break
    case "wood":
      tone(c, o, { type: "triangle", f0: 520, f1: 240, dur: 0.1, gain: 0.35 }, r)
      noise(c, o, { filter: "bandpass", f0: 1400, q: 2, dur: 0.09, gain: 0.3 }, r)
      break
    case "earth":
      tone(c, o, { type: "sine", f0: 90, f1: 38, dur: 0.38, gain: 0.7 }, r)
      noise(c, o, { filter: "lowpass", f0: 700, f1: 120, dur: 0.3, gain: 0.5 }, r)
      break
    default:
      break
  }
}

const SYNTH: Record<SfxName, (c: AudioContext, o: AudioNode, r: number) => void> = {
  click: (c, o, r) => {
    tone(c, o, { type: "square", f0: 1900, f1: 1100, dur: 0.035, gain: 0.12 }, r)
    tone(c, o, { type: "sine", f0: 700, dur: 0.05, gain: 0.1 }, r)
  },
  hit: (c, o, r) => impact(c, o, r),
  crit: (c, o, r) => {
    impact(c, o, r, 1.25)
    tone(c, o, { type: "sine", f0: 52, f1: 30, dur: 0.5, gain: 0.8 }, r)
    tone(c, o, { type: "triangle", f0: 1568, dur: 0.6, gain: 0.2, at: 0.02 }, r)
    tone(c, o, { type: "triangle", f0: 2349, dur: 0.5, gain: 0.14, at: 0.02 }, r)
    noise(c, o, { filter: "highpass", f0: 4000, dur: 0.22, gain: 0.35 }, r)
  },
  miss: (c, o, r) => {
    noise(c, o, { filter: "bandpass", f0: 600, f1: 3000, q: 1.5, dur: 0.16, gain: 0.3 }, r)
  },
  heal: (c, o, r) => {
    ;[523, 659, 784, 1047].forEach((f, i) => tone(c, o, { type: "sine", f0: f, dur: 0.35, gain: 0.2, at: i * 0.06 }, r))
  },
  guard: (c, o, r) => {
    tone(c, o, { type: "square", f0: 420, f1: 300, dur: 0.12, gain: 0.18 }, r)
    tone(c, o, { type: "sine", f0: 1320, dur: 0.4, gain: 0.16 }, r)
    noise(c, o, { filter: "highpass", f0: 3000, dur: 0.05, gain: 0.35 }, r)
  },
  turn: (c, o, r) => {
    tone(c, o, { type: "sine", f0: 392, dur: 0.18, gain: 0.25 }, r)
    tone(c, o, { type: "sine", f0: 587, dur: 0.3, gain: 0.25, at: 0.1 }, r)
    tone(c, o, { type: "triangle", f0: 1174, dur: 0.3, gain: 0.08, at: 0.1 }, r)
  },
  cutin: (c, o, r) => {
    noise(c, o, { filter: "bandpass", f0: 300, f1: 5000, q: 1.2, dur: 0.22, gain: 0.35 }, r)
    tone(c, o, { type: "sawtooth", f0: 220, f1: 660, dur: 0.18, gain: 0.1 }, r)
  },
  break: (c, o, r) => {
    impact(c, o, r, 1.1)
    noise(c, o, { filter: "highpass", f0: 3000, dur: 0.3, gain: 0.45 }, r)
    tone(c, o, { type: "square", f0: 880, f1: 110, dur: 0.25, gain: 0.15 }, r)
  },
  down: (c, o, r) => {
    tone(c, o, { type: "sawtooth", f0: 330, f1: 55, dur: 0.6, gain: 0.3 }, r)
    tone(c, o, { type: "sine", f0: 70, f1: 30, dur: 0.6, gain: 0.7 }, r)
  },
  win: (c, o, r) => {
    ;[523, 659, 784, 1047, 1319].forEach((f, i) => {
      tone(c, o, { type: "triangle", f0: f, dur: 0.5, gain: 0.22, at: i * 0.1 }, r)
      tone(c, o, { type: "sine", f0: f * 2, dur: 0.4, gain: 0.08, at: i * 0.1 }, r)
    })
    tone(c, o, { type: "triangle", f0: 1047, dur: 1.1, gain: 0.2, at: 0.55 }, r)
    tone(c, o, { type: "triangle", f0: 1319, dur: 1.1, gain: 0.18, at: 0.55 }, r)
    tone(c, o, { type: "triangle", f0: 1568, dur: 1.1, gain: 0.16, at: 0.55 }, r)
  },
  lose: (c, o, r) => {
    ;[392, 349, 311, 262].forEach((f, i) => tone(c, o, { type: "sawtooth", f0: f, dur: 0.55, gain: 0.14, at: i * 0.22 }, r))
    tone(c, o, { type: "sine", f0: 65, f1: 40, dur: 1.2, gain: 0.5, at: 0.5 }, r)
  },
  tick: (c, o, r) => {
    tone(c, o, { type: "sine", f0: 1500, f1: 1200, dur: 0.03, gain: 0.08 }, r)
  },
  pick: (c, o, r) => {
    tone(c, o, { type: "triangle", f0: 660, dur: 0.07, gain: 0.14 }, r)
    tone(c, o, { type: "sine", f0: 990, dur: 0.1, gain: 0.1, at: 0.035 }, r)
  },
  lift: (c, o, r) => {
    noise(c, o, { filter: "bandpass", f0: 1800, f1: 3200, q: 1.2, dur: 0.06, gain: 0.12 }, r)
    tone(c, o, { type: "sine", f0: 420, f1: 560, dur: 0.06, gain: 0.08 }, r)
  },
  drop: (c, o, r) => {
    tone(c, o, { type: "sine", f0: 200, f1: 110, dur: 0.09, gain: 0.3 }, r)
    noise(c, o, { filter: "bandpass", f0: 1200, f1: 500, q: 1, dur: 0.05, gain: 0.18 }, r)
  },
  thud: (c, o, r) => {
    tone(c, o, { type: "sine", f0: 120, f1: 55, dur: 0.18, gain: 0.45 }, r)
    noise(c, o, { filter: "lowpass", f0: 500, f1: 150, dur: 0.12, gain: 0.25 }, r)
  },
  paper: (c, o, r) => {
    noise(c, o, { filter: "bandpass", f0: 3500, f1: 1800, q: 0.7, dur: 0.14, gain: 0.2 }, r)
    noise(c, o, { filter: "highpass", f0: 5000, dur: 0.05, gain: 0.1, at: 0.05 }, r)
  },
  flip: (c, o, r) => {
    noise(c, o, { filter: "bandpass", f0: 900, f1: 4500, q: 1, dur: 0.11, gain: 0.22 }, r)
    tone(c, o, { type: "triangle", f0: 300, f1: 180, dur: 0.06, gain: 0.1, at: 0.08 }, r)
  },
  slide: (c, o, r) => {
    noise(c, o, { filter: "bandpass", f0: 500, f1: 900, q: 0.9, dur: 0.2, gain: 0.2 }, r)
    tone(c, o, { type: "sine", f0: 95, f1: 70, dur: 0.22, gain: 0.2, at: 0.12 }, r)
  },
  coin: (c, o, r) => {
    tone(c, o, { type: "square", f0: 1568, dur: 0.07, gain: 0.1 }, r)
    tone(c, o, { type: "square", f0: 2093, dur: 0.28, gain: 0.1, at: 0.07 }, r)
    tone(c, o, { type: "sine", f0: 4186, dur: 0.2, gain: 0.05, at: 0.07 }, r)
  },
  levelup: (c, o, r) => {
    ;[523, 659, 784, 1047].forEach((f, i) => tone(c, o, { type: "triangle", f0: f, dur: 0.22, gain: 0.2, at: i * 0.07 }, r))
    tone(c, o, { type: "sine", f0: 2093, dur: 0.5, gain: 0.08, at: 0.28 }, r)
  },
  melt: (c, o, r) => {
    noise(c, o, { filter: "lowpass", f0: 400, f1: 2400, q: 0.8, dur: 0.5, gain: 0.35 }, r)
    tone(c, o, { type: "sawtooth", f0: 110, f1: 330, dur: 0.5, gain: 0.12 }, r)
    tone(c, o, { type: "sine", f0: 880, f1: 1760, dur: 0.4, gain: 0.1, at: 0.35 }, r)
  },
  shatter: (c, o, r) => {
    noise(c, o, { filter: "highpass", f0: 3500, dur: 0.3, gain: 0.4 }, r)
    for (let i = 0; i < 5; i++)
      tone(c, o, { type: "triangle", f0: 2200 + Math.random() * 2400, f1: 900, dur: 0.1, gain: 0.07, at: 0.03 + i * 0.045 }, r)
    tone(c, o, { type: "sine", f0: 140, f1: 60, dur: 0.15, gain: 0.3 }, r)
  },
  deny: (c, o, r) => {
    tone(c, o, { type: "square", f0: 260, dur: 0.07, gain: 0.12 }, r)
    tone(c, o, { type: "square", f0: 200, dur: 0.12, gain: 0.12, at: 0.08 }, r)
  },
  error: (c, o, r) => {
    tone(c, o, { type: "sawtooth", f0: 190, f1: 120, dur: 0.22, gain: 0.2 }, r)
    tone(c, o, { type: "sine", f0: 80, f1: 55, dur: 0.25, gain: 0.3 }, r)
  },
  success: (c, o, r) => {
    tone(c, o, { type: "triangle", f0: 659, dur: 0.12, gain: 0.18 }, r)
    tone(c, o, { type: "triangle", f0: 988, dur: 0.3, gain: 0.18, at: 0.09 }, r)
    tone(c, o, { type: "sine", f0: 1976, dur: 0.3, gain: 0.06, at: 0.09 }, r)
  },
  equip: (c, o, r) => {
    noise(c, o, { filter: "highpass", f0: 3000, dur: 0.04, gain: 0.25 }, r)
    tone(c, o, { type: "square", f0: 520, f1: 780, dur: 0.07, gain: 0.1 }, r)
    tone(c, o, { type: "sine", f0: 1560, dur: 0.18, gain: 0.1, at: 0.04 }, r)
  },
  unequip: (c, o, r) => {
    tone(c, o, { type: "square", f0: 780, f1: 480, dur: 0.08, gain: 0.1 }, r)
    noise(c, o, { filter: "bandpass", f0: 1500, q: 1, dur: 0.05, gain: 0.15 }, r)
  },
  tear: (c, o, r) => {
    noise(c, o, { filter: "bandpass", f0: 2800, f1: 6000, q: 0.6, dur: 0.22, gain: 0.4 }, r)
    noise(c, o, { filter: "highpass", f0: 4500, dur: 0.12, gain: 0.25, at: 0.05 }, r)
    tone(c, o, { type: "sine", f0: 150, f1: 70, dur: 0.15, gain: 0.3, at: 0.1 }, r)
  },
  charge: (c, o, r) => {
    tone(c, o, { type: "sawtooth", f0: 120, f1: 520, dur: 0.7, gain: 0.1 }, r)
    tone(c, o, { type: "sine", f0: 60, dur: 0.12, gain: 0.35 }, r)
    tone(c, o, { type: "sine", f0: 60, dur: 0.12, gain: 0.35, at: 0.28 }, r)
    tone(c, o, { type: "sine", f0: 60, dur: 0.12, gain: 0.4, at: 0.5 }, r)
  },
  shine: (c, o, r) => {
    ;[3136, 3951, 4699].forEach((f, i) => tone(c, o, { type: "sine", f0: f, dur: 0.25, gain: 0.05, at: i * 0.05 }, r))
  },
  "reveal-c": (c, o, r) => {
    SYNTH.flip(c, o, r)
  },
  "reveal-r": (c, o, r) => {
    SYNTH.flip(c, o, r)
    tone(c, o, { type: "triangle", f0: 784, dur: 0.3, gain: 0.14, at: 0.1 }, r)
  },
  "reveal-e": (c, o, r) => {
    SYNTH.flip(c, o, r)
    ;[659, 830, 988].forEach((f, i) => tone(c, o, { type: "triangle", f0: f, dur: 0.45, gain: 0.14, at: 0.1 + i * 0.03 }, r))
    SYNTH.shine(c, o, r)
  },
  "reveal-l": (c, o, r) => {
    SYNTH.flip(c, o, r)
    tone(c, o, { type: "sine", f0: 70, f1: 40, dur: 0.6, gain: 0.5, at: 0.05 }, r)
    ;[523, 659, 784, 1047].forEach((f, i) => tone(c, o, { type: "triangle", f0: f, dur: 0.9, gain: 0.14, at: 0.1 + i * 0.04 }, r))
    SYNTH.shine(c, o, r)
  },
  "reveal-radiant": (c, o, r) => {
    SYNTH.flip(c, o, r)
    tone(c, o, { type: "sine", f0: 60, f1: 32, dur: 0.9, gain: 0.6, at: 0.05 }, r)
    ;[392, 494, 587, 784, 988].forEach((f, i) => tone(c, o, { type: "triangle", f0: f, dur: 1.2, gain: 0.14, at: 0.08 + i * 0.05 }, r))
    noise(c, o, { filter: "highpass", f0: 5000, dur: 0.5, gain: 0.2, at: 0.1 }, r)
    SYNTH.shine(c, o, r)
  },
  "reveal-prismatic": (c, o, r) => {
    SYNTH.flip(c, o, r)
    tone(c, o, { type: "sine", f0: 55, f1: 28, dur: 1.2, gain: 0.7, at: 0.05 }, r)
    ;[523, 659, 784, 988, 1175, 1568].forEach((f, i) => {
      tone(c, o, { type: "triangle", f0: f, dur: 0.5, gain: 0.14, at: 0.08 + i * 0.07 }, r)
      tone(c, o, { type: "sine", f0: f * 2, dur: 0.4, gain: 0.05, at: 0.08 + i * 0.07 }, r)
    })
    tone(c, o, { type: "triangle", f0: 1047, dur: 1.6, gain: 0.14, at: 0.6 }, r)
    tone(c, o, { type: "triangle", f0: 1568, dur: 1.6, gain: 0.12, at: 0.6 }, r)
    noise(c, o, { filter: "highpass", f0: 6000, dur: 0.7, gain: 0.22, at: 0.1 }, r)
    SYNTH.shine(c, o, r)
  },
  // ---------- 界面 ----------
  hover: (c, o, r) => {
    tone(c, o, { type: "sine", f0: 1800, f1: 1650, dur: 0.022, gain: 0.03 }, r)
  },
  // 面板 / 弹层打开：一口往上的气 + 落定的软底
  open: (c, o, r) => {
    noise(c, o, { filter: "bandpass", f0: 700, f1: 2600, q: 0.8, dur: 0.14, gain: 0.14 }, r)
    tone(c, o, { type: "sine", f0: 300, f1: 460, dur: 0.1, gain: 0.1, at: 0.02 }, r)
    tone(c, o, { type: "triangle", f0: 920, dur: 0.12, gain: 0.05, at: 0.09 }, r)
  },
  close: (c, o, r) => {
    noise(c, o, { filter: "bandpass", f0: 2400, f1: 600, q: 0.8, dur: 0.12, gain: 0.12 }, r)
    tone(c, o, { type: "sine", f0: 420, f1: 250, dur: 0.1, gain: 0.1, at: 0.01 }, r)
  },
  tab: (c, o, r) => {
    tone(c, o, { type: "triangle", f0: 880, dur: 0.045, gain: 0.08 }, r)
    tone(c, o, { type: "sine", f0: 1320, dur: 0.07, gain: 0.05, at: 0.03 }, r)
  },
  toggle: (c, o, r) => {
    tone(c, o, { type: "square", f0: 1300, f1: 900, dur: 0.025, gain: 0.07 }, r)
    noise(c, o, { filter: "highpass", f0: 4000, dur: 0.018, gain: 0.1 }, r)
  },
  // 新邮件 / 有东西可领：两声小铃
  notify: (c, o, r) => {
    tone(c, o, { type: "sine", f0: 1175, dur: 0.22, gain: 0.14 }, r)
    tone(c, o, { type: "sine", f0: 1568, dur: 0.4, gain: 0.14, at: 0.11 }, r)
    tone(c, o, { type: "triangle", f0: 3136, dur: 0.3, gain: 0.03, at: 0.11 }, r)
  },
  // 领奖：硬币落袋 + 一串上行亮音
  claim: (c, o, r) => {
    SYNTH.coin(c, o, r)
    ;[1047, 1319, 1568, 2093].forEach((f, i) =>
      tone(c, o, { type: "triangle", f0: f, dur: 0.28, gain: 0.1, at: 0.12 + i * 0.055 }, r),
    )
    noise(c, o, { filter: "highpass", f0: 6000, dur: 0.25, gain: 0.08, at: 0.14 }, r)
  },
  send: (c, o, r) => {
    noise(c, o, { filter: "bandpass", f0: 900, f1: 5200, q: 1.1, dur: 0.2, gain: 0.18 }, r)
    tone(c, o, { type: "sine", f0: 520, f1: 1040, dur: 0.18, gain: 0.08 }, r)
  },
  // 东西飞过去：卡牌飞行、换人
  whoosh: (c, o, r) => {
    noise(c, o, { filter: "bandpass", f0: 500, f1: 3400, q: 1.4, dur: 0.16, gain: 0.2 }, r)
    noise(c, o, { filter: "bandpass", f0: 3400, f1: 900, q: 1.4, dur: 0.14, gain: 0.12, at: 0.1 }, r)
  },
  // 一张牌拍到桌上：短促的纸声 + 轻敲
  deal: (c, o, r) => {
    noise(c, o, { filter: "bandpass", f0: 4200, f1: 1600, q: 0.8, dur: 0.05, gain: 0.2 }, r)
    tone(c, o, { type: "sine", f0: 260, f1: 150, dur: 0.06, gain: 0.2, at: 0.035 }, r)
  },
  stamp: (c, o, r) => {
    tone(c, o, { type: "sine", f0: 150, f1: 62, dur: 0.14, gain: 0.5 }, r)
    noise(c, o, { filter: "lowpass", f0: 900, f1: 200, dur: 0.07, gain: 0.3 }, r)
    tone(c, o, { type: "triangle", f0: 1400, f1: 700, dur: 0.03, gain: 0.08 }, r)
  },
  // ---------- 战斗 ----------
  select: (c, o, r) => {
    tone(c, o, { type: "triangle", f0: 740, f1: 1110, dur: 0.05, gain: 0.14 }, r)
    noise(c, o, { filter: "highpass", f0: 5000, dur: 0.02, gain: 0.08 }, r)
  },
  ap: (c, o, r) => {
    tone(c, o, { type: "square", f0: 988, dur: 0.04, gain: 0.07 }, r)
    tone(c, o, { type: "sine", f0: 1480, f1: 1318, dur: 0.12, gain: 0.1, at: 0.03 }, r)
  },
  // 开战：一记大鼓 + 往上顶的铜管感
  start: (c, o, r) => {
    tone(c, o, { type: "sine", f0: 110, f1: 42, dur: 0.5, gain: 0.75 }, r)
    noise(c, o, { filter: "lowpass", f0: 1400, f1: 180, dur: 0.22, gain: 0.4 }, r)
    ;[196, 294, 392].forEach((f, i) =>
      tone(c, o, { type: "sawtooth", f0: f, f1: f * 1.5, dur: 0.42, gain: 0.07, at: 0.06 + i * 0.03 }, r),
    )
    noise(c, o, { filter: "bandpass", f0: 600, f1: 5200, q: 1, dur: 0.4, gain: 0.16, at: 0.05 }, r)
    tone(c, o, { type: "triangle", f0: 1175, dur: 0.5, gain: 0.1, at: 0.4 }, r)
  },
  warn: (c, o, r) => {
    tone(c, o, { type: "sawtooth", f0: 233, dur: 0.11, gain: 0.14 }, r)
    tone(c, o, { type: "sawtooth", f0: 220, dur: 0.2, gain: 0.14, at: 0.15 }, r)
    tone(c, o, { type: "sine", f0: 58, dur: 0.34, gain: 0.3 }, r)
  },
  laser: (c, o, r) => {
    tone(c, o, { type: "sawtooth", f0: 1900, f1: 240, dur: 0.24, gain: 0.14 }, r)
    tone(c, o, { type: "square", f0: 950, f1: 120, dur: 0.24, gain: 0.07 }, r)
    noise(c, o, { filter: "highpass", f0: 3200, dur: 0.16, gain: 0.2 }, r)
  },
  buff: (c, o, r) => {
    ;[659, 880, 1175].forEach((f, i) => tone(c, o, { type: "sine", f0: f, f1: f * 1.06, dur: 0.2, gain: 0.12, at: i * 0.045 }, r))
    noise(c, o, { filter: "highpass", f0: 5500, dur: 0.18, gain: 0.06, at: 0.05 }, r)
  },
  debuff: (c, o, r) => {
    ;[523, 415, 311].forEach((f, i) => tone(c, o, { type: "triangle", f0: f, f1: f * 0.94, dur: 0.2, gain: 0.12, at: i * 0.05 }, r))
    tone(c, o, { type: "sine", f0: 90, f1: 60, dur: 0.25, gain: 0.2 }, r)
  },
  // 结算评价的星星一颗颗盖上去
  star: (c, o, r) => {
    tone(c, o, { type: "sine", f0: 160, f1: 80, dur: 0.1, gain: 0.3 }, r)
    tone(c, o, { type: "triangle", f0: 1568, dur: 0.3, gain: 0.16, at: 0.015 }, r)
    tone(c, o, { type: "sine", f0: 3136, dur: 0.24, gain: 0.06, at: 0.015 }, r)
  },
}

const lastPlayed = new Map<SfxName, number>()
let lastAny = -1e9

/** 最近一次有人调用 playSfx 的时刻（performance.now()）；全局按键音靠它判断「这次点击已经有专属音效了」 */
export function lastSfxAt() {
  return lastAny
}

/**
 * 页面还没被点过时，浏览器会把 AudioContext 挂起；这时排进去的声音不会丢，而是攒到第一次点击时一口气全响。
 * 所以挂起、且当前不在用户手势里（resume 不会马上生效）时，这一声直接不排。
 */
function audible(c: AudioContext) {
  return c.state === "running" || navigator.userActivation?.isActive === true
}

export function playSfx(name: SfxName, options: SfxOptions = {}) {
  const now = performance.now()
  lastAny = now
  if (volume <= 0) return
  // 节流按「实际响起的时刻」算：同一下排出去的一串延时音不会互相吃掉
  const due = now + (options.delay ?? 0) * 1000
  if (Math.abs(due - (lastPlayed.get(name) ?? -1e9)) < 30) return
  lastPlayed.set(name, due)
  try {
    const { ctx: c, master: m } = ensure()
    if (!audible(c)) return
    const out = c.createGain()
    out.gain.value = options.volume ?? 1
    out.connect(m)
    startOffset = options.delay ?? 0
    render(c, out, name, options.rate ?? 1)
  } catch {
    // 无音频设备或被浏览器拦截时静默
  } finally {
    startOffset = 0
  }
}

/** 试听页用：不节流，可指定来源与变体，等录音加载完再播。 */
export async function previewSfx(name: SfxName, options: SfxOptions & PlayOptions = {}) {
  const { ctx: c, master: m } = ensure()
  await preloadSamples(c)
  const out = c.createGain()
  out.gain.value = options.volume ?? 1
  out.connect(m)
  render(c, out, name, options.rate ?? 1, options)
}

/** 试听页用：录音清单（音名 → 文件）与每个变体的时长，等加载完才有。 */
export async function loadSfxLibrary() {
  const { ctx: c } = ensure()
  await preloadSamples(c)
  const durations: Record<string, (number | null)[]> = {}
  for (const [name, variants] of samples) durations[name] = variants.map((b) => b?.duration ?? null)
  return { manifest: manifestData, durations }
}

/** 素材库试听用：播放任意一段音频文件的原始数据，走同一条 master → 压缩器链路；新的一段会掐掉上一段。 */
let libSource: AudioBufferSourceNode | null = null
export async function previewRaw(data: ArrayBuffer, options: { volume?: number; rate?: number } = {}) {
  const { ctx: c, master: m } = ensure()
  const buf = await c.decodeAudioData(data)
  try {
    libSource?.stop()
  } catch {
    // 已经播完
  }
  const src = c.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = options.rate ?? 1
  const out = c.createGain()
  out.gain.value = options.volume ?? 1
  src.connect(out)
  out.connect(m)
  src.start()
  libSource = src
  return buf.duration
}

/** 试听页用：这个音名有没有合成版本。 */
export function hasSynth(name: string): name is SfxName {
  return name in SYNTH
}

/** 试听页用：这个音名播录音时是否会叠合成低频体。 */
export function hasSampleBody(name: string) {
  return name in SAMPLE_BODY
}

const REVEAL_BY_RARITY: Record<string, SfxName> = {
  C: "reveal-c",
  UC: "reveal-c",
  R: "reveal-r",
  E: "reveal-e",
  L: "reveal-l",
  Mythic: "reveal-radiant",
  Prismatic: "reveal-prismatic",
}

/** 开包翻牌：稀有度越高，层次越多。rate 让连着翻的几张一张比一张高 */
export function playReveal(rarity: string, rate = 1) {
  playSfx(REVEAL_BY_RARITY[rarity] ?? "reveal-c", { rate })
}

/** Combo 越高音调越高，最高 +8 级；传入属性则叠加对应属性层。 */
export function playHit(combo: number, crit = false, element?: Element) {
  const rate = 1 + Math.min(combo, 8) * 0.05
  playSfx(crit ? "crit" : "hit", { rate })
  if (!element || element === "physical") return
  try {
    const { ctx: c, master: m } = ensure()
    if (!audible(c)) return
    const out = c.createGain()
    out.gain.value = 0.8
    out.connect(m)
    elementLayer(c, out, element, rate)
  } catch {
    // 同上
  }
}

export function playClick() {
  playSfx("click")
}

export function playTurn() {
  playSfx("turn")
}

export function playWin() {
  playSfx("win")
}

export function playLose() {
  playSfx("lose")
}
