type ImpactSurface = "gauge" | "card" | "row" | "enemy"

export function reducedImpactMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

// Peak displacement (CSS px) at a large hit. Recoil is lateral on the gauge,
// downward on the receiving cards, and diagonal on the enemy scene.
const recoil = {
  gauge: [9, -3],
  card: [-5, 14],
  row: [-3, 7],
  enemy: [-14, 7],
} as const

const active = new WeakMap<Element, Animation>()

export function impact(node: Element | null | undefined, ratio: number, surface: ImpactSurface): void {
  if (!node || !Number.isFinite(ratio) || ratio <= 0 || (surface === "row" && ratio < 0.1)) return

  // Replace only our last impulse. Card selection, hover and HP transitions keep running.
  active.get(node)?.cancel()
  const strength = Math.min(1, 0.19 + Math.sqrt(ratio) * 1.8)
  const [dx, dy] = recoil[surface]
  const pose = (scale: number) => `${dx * strength * scale}px ${dy * strength * scale}px`
  const reduced = reducedImpactMotion()
  const frames: Keyframe[] = reduced
    ? [{ filter: "brightness(1.3)", composite: "add" }, { filter: "brightness(1)", composite: "add" }]
    : [
        { translate: pose(1), offset: 0 },
        { translate: pose(-0.62), offset: 0.30 },
        { translate: pose(0.25), offset: 0.62 },
        { translate: "0px 0px", offset: 1 },
      ]
  active.set(node, node.animate(frames, {
    id: `battle-impact-${surface}`,
    duration: reduced ? 120 : 100 + 110 * strength,
    easing: "ease-out",
  }))
}

// One quiet envelope for a flurry. Resume from the visible opacity rather than
// restarting at black on each hit, including a hit during the release.
export function sustainHurtTint(node: HTMLElement | null): void {
  if (!node || reducedImpactMotion()) return
  const from = Number(getComputedStyle(node).opacity)
  active.get(node)?.cancel()
  active.set(node, node.animate([
    { opacity: from, offset: 0 },
    { opacity: 1, offset: 0.2 },
    { opacity: 1, offset: 0.65 },
    { opacity: 0, offset: 1 },
  ], { id: "battle-hurt-tint", duration: 600, easing: "linear" }))
}
