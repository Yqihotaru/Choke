import {
  createContext,
  use,
  useImperativeHandle,
  useRef,
  type ReactNode,
  type Ref,
} from "react"

import type { PanelId } from "@/desk/lib/panels"

/** 弹窗提供给面板的东西：标题、关闭、切换面板、数据版本 */
export interface PanelApi {
  eyebrow: string
  title: string
  active: boolean
  revision: number
  invalidate: () => void
  close: () => void
  /** 切到别的面板；和点页签同一套逻辑，包括锁定检查 */
  select: (id: PanelId) => void
}

export const PanelContext = createContext<PanelApi | null>(null)

export function usePanel(): PanelApi {
  const panel = use(PanelContext)
  if (!panel) throw new Error("usePanel 只能用在 DeskModal 里面")
  return panel
}

interface PagesProps {
  /** 加在根元素上，桌面拖放靠它识别面板（如 backpack-panel） */
  className?: string
  rootRef?: Ref<HTMLDivElement>
  left: ReactNode
  right: ReactNode
}

/** 两栏面板根：宽屏左右并排，窄屏单栏；每栏自己滚动。 */
export function Pages({ className, rootRef, left, right }: PagesProps) {
  const element = useRef<HTMLDivElement>(null)
  useImperativeHandle(rootRef, () => element.current!, [])
  return (
    <div ref={element} className={`panel-split ${className ?? ""}`} data-no-light>
      <section className="panel-split__col panel-split__col--left">{left}</section>
      <section className="panel-split__col panel-split__col--right">{right}</section>
    </div>
  )
}
