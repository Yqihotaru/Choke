import { useState } from "react"

const speeds = [0.5, 1, 2, 4] as const

export function usePlaybackSpeed() {
  const [index, setIndex] = useState(1)
  const speed = speeds[index]!
  const next = (index + 1) % speeds.length
  return {
    label: `${speed}×`,
    hint: `战斗速度：${speed}×，点击切换至 ${speeds[next]}×`,
    cycle: () => setIndex(i => (i + 1) % speeds.length),
    stepGap: 380 / speed,
  }
}
