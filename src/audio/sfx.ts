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

export type SfxId = SfxName

interface SfxOptions {
  rate?: number
  volume?: number
}

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
  void preloadSamples(ctx)
  return { ctx, master }
}

/** 真实录音样本：public/sfx/manifest.json 里列出的音名走样本，其余回退合成。 */
const samples = new Map<SfxName, AudioBuffer[]>()
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
        const ok = decoded.filter((b): b is AudioBuffer => b !== null)
        if (ok.length > 0) samples.set(name as SfxName, ok)
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

function playSample(c: AudioContext, o: AudioNode, name: SfxName, rate: number) {
  const variants = samples.get(name)
  if (!variants) return false
  const src = c.createBufferSource()
  src.buffer = variants[Math.floor(Math.random() * variants.length)]!
  // 同一个音每次略有不同，连点时不会像机关枪
  src.playbackRate.value = rate * (0.97 + Math.random() * 0.06)
  src.connect(o)
  src.start()
  SAMPLE_BODY[name]?.(c, o, rate)
  return true
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
  const t = c.currentTime + (spec.at ?? 0)
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
  const t = c.currentTime + (spec.at ?? 0)
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
}

const lastPlayed = new Map<SfxName, number>()

export function playSfx(name: SfxName, options: SfxOptions = {}) {
  if (volume <= 0) return
  const now = performance.now()
  if (now - (lastPlayed.get(name) ?? -1e9) < 30) return
  lastPlayed.set(name, now)
  try {
    const { ctx: c, master: m } = ensure()
    const out = c.createGain()
    out.gain.value = options.volume ?? 1
    out.connect(m)
    if (!playSample(c, out, name, options.rate ?? 1)) SYNTH[name](c, out, options.rate ?? 1)
  } catch {
    // 无音频设备或被浏览器拦截时静默
  }
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

/** 开包翻牌：稀有度越高，层次越多。 */
export function playReveal(rarity: string) {
  playSfx(REVEAL_BY_RARITY[rarity] ?? "reveal-c")
}

/** Combo 越高音调越高，最高 +8 级；传入属性则叠加对应属性层。 */
export function playHit(combo: number, crit = false, element?: Element) {
  const rate = 1 + Math.min(combo, 8) * 0.05
  playSfx(crit ? "crit" : "hit", { rate })
  if (!element || element === "physical") return
  try {
    const { ctx: c, master: m } = ensure()
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
