import { Howl } from "howler"

type SfxName = "click" | "hit" | "crit" | "miss" | "heal" | "guard" | "turn" | "win" | "lose"

const SOURCES: Record<SfxName, string> = {
  click: "/sfx/click.wav",
  hit: "/sfx/hit.wav",
  crit: "/sfx/crit.wav",
  miss: "/sfx/miss.wav",
  heal: "/sfx/heal.wav",
  guard: "/sfx/guard.wav",
  turn: "/sfx/turn.wav",
  win: "/sfx/win.wav",
  lose: "/sfx/lose.wav",
}

const VOLUME: Record<SfxName, number> = {
  click: 0.25,
  hit: 0.45,
  crit: 0.55,
  miss: 0.3,
  heal: 0.4,
  guard: 0.4,
  turn: 0.35,
  win: 0.45,
  lose: 0.4,
}

let sounds: Record<SfxName, Howl> | null = null

function ensure() {
  if (sounds) return sounds
  sounds = Object.fromEntries(
    (Object.keys(SOURCES) as SfxName[]).map((name) => [
      name,
      new Howl({ src: [SOURCES[name]], preload: true, volume: VOLUME[name] }),
    ]),
  ) as Record<SfxName, Howl>
  return sounds
}

export function playSfx(name: SfxName, options: { rate?: number; volume?: number } = {}) {
  const sound = ensure()[name]
  const id = sound.play()
  if (id == null) return
  if (options.rate) sound.rate(options.rate, id)
  if (options.volume != null) sound.volume(options.volume, id)
}

/** Combo 越高音调越高，模仿街机连击的兴奋感。 */
export function playHit(combo: number, crit = false) {
  playSfx(crit ? "crit" : "hit", { rate: 1 + Math.min(combo, 8) * 0.07 })
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
