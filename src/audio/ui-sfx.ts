import { lastSfxAt, playSfx, type SfxId } from "./sfx"

/**
 * 全局按键音：页面上任何按钮 / 链接 / 页签被点到，都至少有一声反馈。
 *
 * 各个面板自己在点击里调了 playSfx 的（翻页、装备、开包……）优先：React 的点击处理挂在 #root 上，
 * 比这里 document 上的监听先跑，所以只要这次点击里已经响过，这里就不再叠一声。
 *
 * 想换音或不出声，在元素（或它的祖先）上写 data-sfx：
 *   <button data-sfx="open">   指定音名
 *   <div data-sfx="none">      这一块里的点击都不出默认音
 */

const CLICKABLE =
  'button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [role="option"], input[type="checkbox"], input[type="radio"]'

/** 这次点击里已经响过专属音效的判定窗口：同一次事件派发内，留一点余量 */
const HANDLED_MS = 40

function defaultSound(el: Element): SfxId {
  if (el.matches('[role="tab"]')) return "tab"
  if (el.matches('input[type="checkbox"], input[type="radio"]')) return "toggle"
  return "click"
}

function onClick(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  const el = target.closest(CLICKABLE)
  if (!el) return
  if (el.matches(":disabled, [aria-disabled='true']")) return
  if (performance.now() - lastSfxAt() < HANDLED_MS) return
  const named = el.closest<HTMLElement>("[data-sfx]")?.dataset.sfx
  if (named === "none") return
  playSfx((named as SfxId | undefined) ?? defaultSound(el))
}

function onChange(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  if (target.closest<HTMLElement>("[data-sfx]")?.dataset.sfx === "none") return
  playSfx("tick")
}

let installed = false

/** 只装一次；HMR 重复执行模块时不会叠监听 */
export function installUiSfx() {
  if (installed) return
  installed = true
  document.addEventListener("click", onClick)
  document.addEventListener("change", onChange)
}
