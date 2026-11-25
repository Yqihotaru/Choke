import type { DockDropGroup } from "@/desk/lib/desk-page-model"
import { NAV_GROUPS, type NavGroupId } from "@/desk/lib/panels"
import { isModuleUnlocked, isModuleVisible, unlockLevelOf } from "@/tutorial/unlocks"
import type { PlayerProgress } from "@/tutorial/types"
import "@/desk/shell/desk-nav.css"

interface DeskDockProps {
  /** 当前打开面板所属分组；没开面板为 null */
  active: NavGroupId | null
  progress: Pick<PlayerProgress, "level" | "tutorialDone">
  /** 背包里的卡包总数 */
  packCount: number
  deckFilled: { filled: number; size: number } | null
  /** 拖动中悬在它上面、松手会被接住的入口 */
  hot: DockDropGroup | null
  /** 拖动中可以接住当前拖动物的入口（先轻微提示） */
  armed: DockDropGroup | null
  /** 刚接住东西、正在弹一下的入口 */
  receiving: DockDropGroup | null
  onOpen: (group: NavGroupId) => void
}

/** 底栏：固定的功能入口。拖动卡 / 卡包到对应按钮上就是收进去。 */
export function DeskDock({
  active,
  progress,
  packCount,
  deckFilled,
  hot,
  armed,
  receiving,
  onOpen,
}: DeskDockProps) {
  return (
    <nav className="desk-dock" aria-label="功能入口">
      {NAV_GROUPS.filter((group) => isModuleVisible(group.panel, progress)).map((group) => {
        const locked = !isModuleUnlocked(group.panel, progress)
        const note = locked
          ? `🔒 Lv.${unlockLevelOf(group.panel)}`
          : group.id === "open"
            ? `库存 ×${packCount}`
            : group.id === "deck" && deckFilled
              ? `${deckFilled.filled}/${deckFilled.size}`
              : null
        const dropGroup = group.id === "open" || group.id === "collection" ? group.id : null
        const classes = [
          "dock-btn",
          dropGroup && hot === dropGroup && "is-drop-hot",
          dropGroup && armed === dropGroup && "is-drop-armed",
          dropGroup && receiving === dropGroup && "is-receiving",
        ]
          .filter(Boolean)
          .join(" ")
        return (
          <button
            key={group.id}
            type="button"
            className={classes}
            data-group={group.id}
            data-tutorial-id={`${group.panel}-entry`}
            data-locked={locked || undefined}
            aria-disabled={locked || undefined}
            aria-pressed={active === group.id}
            onClick={() => onOpen(group.id)}
          >
            <b>{group.label}</b>
            {note && <small>{note}</small>}
          </button>
        )
      })}
    </nav>
  )
}

interface TopbarStatusProps {
  user: { username: string; avatarUrl: string | null; coins: number; essence: number } | null
  onOpenProfile: () => void
}

/** 顶栏左侧的状态：金币、精华、头像（点开账号面板）；未登录只有登录按钮。 */
export function DeskTopbarStatus({ user, onOpenProfile }: TopbarStatusProps) {
  if (!user) {
    return (
      <button type="button" className="desk-button" data-tutorial-id="account-entry" onClick={onOpenProfile}>
        登录
      </button>
    )
  }
  return (
    <>
      <span className="desk-wallet" title="金币">
        <i aria-hidden>●</i>
        {user.coins.toLocaleString("en-US")}
      </span>
      <span className="desk-wallet desk-wallet--essence" title="精华">
        <i aria-hidden>◆</i>
        {user.essence.toLocaleString("en-US")}
      </span>
      <button
        type="button"
        className="desk-avatar"
        data-tutorial-id="account-entry"
        aria-label={`${user.username} · 账号`}
        title={user.username}
        onClick={onOpenProfile}
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" draggable={false} referrerPolicy="no-referrer" />
        ) : (
          user.username.slice(0, 1).toUpperCase()
        )}
      </button>
    </>
  )
}
