import { useEffect, useRef, type CSSProperties } from "react"

import { hashOf } from "./data"
import "./card-foil.css"

/**
 * 闪卡膜，所有卡面共用：放在卡面根节点的最后一个子元素。
 * 各层的 --mx / --my 由 light.ts 按光标写入（根节点需带 card-face 类）；
 * 扫光只在进入视口附近时播放。
 */
export function CardFoil({ seed }: { seed: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) element.dataset.sweepVisible = ""
        else delete element.dataset.sweepVisible
      },
      { rootMargin: "100px" }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className="card-foil"
      // 每张闪卡的扫光错开，不会整页一起闪
      style={{ "--seed": hashOf(seed) % 97 } as CSSProperties}
      aria-hidden
    >
      <i className="card-foil__film" />
      <i className="card-foil__dodge" />
      <i className="card-foil__glitter" />
      <i className="card-foil__glitter card-foil__glitter--b" />
      <i className="card-foil__glare" />
      <i className="card-foil__sweep" />
    </div>
  )
}
