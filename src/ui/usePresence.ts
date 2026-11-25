import { useEffect, useState } from "react"

/**
 * 让弹层有离场动画：open 变 false 后先留在页面上 exitMs 毫秒，这段时间里 leaving 为 true，
 * 样式用它播离场动画，播完才真正卸载。
 */
export function usePresence(open: boolean, exitMs = 160) {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open) return
    const timer = window.setTimeout(() => setMounted(false), exitMs)
    return () => window.clearTimeout(timer)
  }, [open, exitMs])

  return { mounted, leaving: mounted && !open }
}
