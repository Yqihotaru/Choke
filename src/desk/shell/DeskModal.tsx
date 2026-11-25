import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react"

import { playSfx } from "@/audio/sfx"

import { AboutPanel } from "@/desk/panels/player/AboutPanel"
import { AccountPanel } from "@/desk/panels/player/AccountPanel"
import { AlbumPanel } from "@/desk/panels/cards/AlbumPanel"
import type { ApiUserCard } from "@/desk/session/api"
import { BackpackPanel } from "@/desk/panels/cards/BackpackPanel"
import { BattlePanel } from "@/desk/panels/battle/BattlePanel"
import { CodexPanel } from "@/desk/panels/cards/CodexPanel"
import { DeckPanel } from "@/desk/panels/cards/DeckPanel"
import { GachaPanel, type PoolId } from "@/desk/panels/shop/GachaPanel"
import { MarketPanel } from "@/desk/panels/shop/MarketPanel"
import { PANEL_META, type PanelId } from "@/desk/lib/panels"
import { onDeskData } from "@/desk/session/events"
import { CardDragLayer } from "@/desk/shell/DragGhost"
import { PanelContext, type PanelApi } from "@/desk/shell/PanelFrame"
import { useModal } from "@/ui/useModal"
import { isModuleUnlocked, unlockLevelOf } from "@/tutorial/unlocks"
import "@/desk/panel-ui.css"
import "@/desk/shell/desk-modal.css"

export interface DeskModalHandle {
  /** 播完离场动画再通知外面关掉 */
  close: () => void
}

interface Props {
  ref?: Ref<DeskModalHandle>
  panel: PanelId
  /** 当前分组的页签；只有一个时不显示页签栏 */
  tabs: PanelId[]
  userId: string | null
  username: string | null
  publicId?: number | null
  avatarUrl?: string | null
  essence?: number
  coins?: number
  hero?: ApiUserCard | null
  onSelect: (id: PanelId) => void
  onClose: () => void
  onLogout?: () => void
  onHeroClaimed?: () => void
  level: number
  tutorialDone: boolean
  onLocked?: (id: PanelId, need: number) => void
}

/**
 * 居中的面板弹窗：顶部是当前分组的页签，下面是当前面板。一次只挂载一个面板。
 * 遮罩不拦截指针：打开面板时仍要把桌面上的卡拖进卡册 / 卡组槽位。
 * 根节点带 `book` 类名只是标记，教程和拖放用它判断「面板是否打开」，不匹配任何样式。
 */
export function DeskModal({
  ref,
  panel,
  tabs,
  userId,
  username,
  publicId = null,
  avatarUrl = null,
  essence = 0,
  coins = 0,
  hero,
  onSelect,
  onClose,
  onLogout,
  onHeroClaimed,
  level,
  tutorialDone,
  onLocked,
}: Props) {
  const [gachaPool, setGachaPool] = useState<PoolId>("normal")
  const [leavingFor, setLeavingFor] = useState<PanelId | null>(null)
  // 离场动画只属于发起关闭的那一次打开；期间换了面板就不再算
  const leaving = leavingFor === panel
  const shown = useRef(panel)
  useEffect(() => {
    shown.current = panel
  }, [panel])
  const rootRef = useRef<HTMLElement>(null)
  const leaveTimer = useRef<number | null>(null)
  const [revision, setRevision] = useState(0)
  const invalidate = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => onDeskData(null, invalidate), [invalidate])

  const unlocked = (id: PanelId) => isModuleUnlocked(id, { level, tutorialDone })

  const selectPanel = (id: PanelId) => {
    if (id === panel) return
    if (!unlocked(id)) {
      playSfx("deny")
      onLocked?.(id, unlockLevelOf(id))
      return
    }
    playSfx("tab")
    onSelect(id)
  }

  const close = useCallback(() => {
    if (leaveTimer.current) return
    const snapshot = shown.current
    setLeavingFor(snapshot)
    playSfx("flip")
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null
      // 170ms 里又切到了别的面板：新面板不能被这次关闭带走
      if (shown.current === snapshot) onClose()
      else setLeavingFor(null)
    }, 170)
  }, [onClose])

  useImperativeHandle(ref, () => ({ close }))
  useEffect(
    () => () => {
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current)
    },
    [],
  )
  useEffect(() => {
    playSfx("flip")
  }, [])

  useModal(rootRef, {
    onClose: () => {
      if (!document.querySelector(".card-detail")) close()
    },
  })

  const meta = PANEL_META[panel]
  const api = useMemo<PanelApi>(
    () => ({
      eyebrow: meta.sub,
      title: meta.label,
      active: true,
      revision,
      invalidate,
      close,
      select: selectPanel,
    }),
    // selectPanel 只依赖 panel / level / tutorialDone / 回调，随它们变化重建即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta.sub, meta.label, revision, invalidate, close, panel, level, tutorialDone, onSelect, onLocked],
  )

  return (
    <>
      <div className="desk-modal-scrim" aria-hidden />
      <section
        ref={rootRef}
        className={`desk-modal book ${leaving ? "is-leaving" : ""}`}
        role="dialog"
        aria-label={meta.label}
        data-object={panel}
        tabIndex={-1}
      >
        <header className="desk-modal__head">
          {tabs.length > 1 ? (
            <nav className="desk-modal__tabs" role="tablist" aria-label="切换">
              {tabs.map((id) => {
                const locked = !unlocked(id)
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    className="desk-modal__tab"
                    aria-selected={panel === id}
                    data-object={id}
                    data-tutorial-id={`book-tab-${id}`}
                    data-locked={locked || undefined}
                    aria-disabled={locked || undefined}
                    onClick={() => selectPanel(id)}
                  >
                    {PANEL_META[id].label}
                    {locked && <span className="desk-modal__lock"> 🔒 Lv.{unlockLevelOf(id)}</span>}
                  </button>
                )
              })}
            </nav>
          ) : (
            <h2 className="desk-modal__title">{meta.label}</h2>
          )}
          <button type="button" className="desk-modal__close" aria-label="关闭" onClick={close}>
            ×
          </button>
        </header>
        <div className="desk-modal__body">
          {unlocked(panel) ? (
            <PanelContext value={api}>
              {panel === "codex" && <CodexPanel userId={userId} />}
              {panel === "album" && <AlbumPanel userId={userId} />}
              {panel === "deck" && <DeckPanel userId={userId} />}
              {panel === "backpack" && (
                <BackpackPanel
                  userId={userId}
                  onOpenGacha={(pool) => {
                    setGachaPool(pool as PoolId)
                    selectPanel("packs")
                  }}
                  onHeroClaimed={onHeroClaimed}
                />
              )}
              {panel === "battle" && (
                <BattlePanel userId={userId} onOpenDeck={() => selectPanel("deck")} />
              )}
              {panel === "packs" && <GachaPanel userId={userId} initialPool={gachaPool} />}
              {panel === "market" && (
                <MarketPanel userId={userId} onOpenAlbum={() => selectPanel("album")} />
              )}
              {panel === "about" && <AboutPanel />}
              {panel === "account" && (
                <AccountPanel
                  userId={userId}
                  username={username}
                  publicId={publicId}
                  avatarUrl={avatarUrl}
                  essence={essence}
                  coins={coins}
                  hero={hero}
                  onLogout={onLogout}
                  onOpenBackpack={() => selectPanel("backpack")}
                />
              )}
            </PanelContext>
          ) : (
            <div className="desk-modal__locked" role="note">
              <span className="bk-eyebrow">LOCKED</span>
              <h2>{meta.label}</h2>
              <p>达到 Lv.{unlockLevelOf(panel)} 解锁</p>
              <button type="button" className="bk-btn bk-btn--main" onClick={close}>
                关闭
              </button>
            </div>
          )}
        </div>
        <CardDragLayer root={rootRef} />
      </section>
    </>
  )
}
