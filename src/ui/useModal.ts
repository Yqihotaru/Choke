import { useEffect, useRef } from "react"
import type { RefObject } from "react"

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface ModalOptions {
  /** 为 false 时不接管键盘与焦点（弹窗未显示时） */
  active?: boolean
  /** Esc 触发；不传则不处理 Esc */
  onClose?: () => void
}

function visibleFocusables(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getClientRects().length > 0,
  )
}

/**
 * 弹窗的键盘与焦点管理：打开时把焦点移进去，Tab 在内部循环，Esc 关闭，关闭后把焦点还给触发者。
 * 容器需要能接收焦点，所以会补一个 tabIndex=-1。
 */
export function useModal(ref: RefObject<HTMLElement | null>, { active = true, onClose }: ModalOptions = {}) {
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const root = ref.current
    if (!active || !root) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!root.hasAttribute("tabindex")) root.tabIndex = -1
    if (!root.contains(document.activeElement)) {
      const first = visibleFocusables(root)[0]
      ;(first ?? root).focus({ preventScroll: true })
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeRef.current) {
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== "Tab") return
      const items = visibleFocusables(root)
      if (items.length === 0) {
        e.preventDefault()
        root.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      if (e.shiftKey && (current === first || current === root)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && current === last) {
        e.preventDefault()
        first.focus()
      } else if (!root.contains(current)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("keydown", onKey, true)
      if (previous && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [ref, active])
}
