export type PanelId =
  | "codex"
  | "album"
  | "deck"
  | "backpack"
  | "battle"
  | "packs"
  | "market"
  | "about"
  | "account"

export const PANEL_IDS: PanelId[] = [
  "packs",
  "backpack",
  "album",
  "codex",
  "deck",
  "battle",
  "market",
  "account",
  "about",
]

export const PANEL_META: Record<PanelId, { label: string; sub: string }> = {
  packs: { label: "抽卡", sub: "GACHA" },
  backpack: { label: "背包", sub: "BACKPACK" },
  album: { label: "卡册", sub: "COLLECTION" },
  codex: { label: "图鉴", sub: "CODEX" },
  deck: { label: "卡组", sub: "DECK" },
  battle: { label: "对战", sub: "BATTLE" },
  market: { label: "市场", sub: "MARKET" },
  account: { label: "账号", sub: "ACCOUNT" },
  about: { label: "关于", sub: "ABOUT" },
}

/** 底栏入口；一个入口打开时，弹窗顶部只显示这一组的分页签 */
export type NavGroupId = "open" | "collection" | "deck" | "battle" | "market"

/** deck 和 battle 共用一组页签：教程 battle-tab 步骤要在卡组面板里点到 book-tab-battle */
export const NAV_GROUPS: { id: NavGroupId; label: string; panel: PanelId; panels: PanelId[] }[] = [
  { id: "open", label: "开包", panel: "packs", panels: ["packs", "backpack"] },
  { id: "collection", label: "收藏", panel: "album", panels: ["album", "codex"] },
  { id: "deck", label: "卡组", panel: "deck", panels: ["deck", "battle"] },
  { id: "battle", label: "对战", panel: "battle", panels: ["deck", "battle"] },
  { id: "market", label: "市场", panel: "market", panels: ["market"] },
]

/** 顶栏头像打开的分组 */
export const PROFILE_PANELS: PanelId[] = ["account", "about"]

export function groupOf(panel: PanelId): PanelId[] {
  if (PROFILE_PANELS.includes(panel)) return PROFILE_PANELS
  return NAV_GROUPS.find((group) => group.panels.includes(panel))!.panels
}

/** 当前面板高亮底栏哪一项；deck / battle 各自对应同名分组 */
export function navGroupOf(panel: PanelId | null): NavGroupId | null {
  if (!panel || PROFILE_PANELS.includes(panel)) return null
  const group = NAV_GROUPS.find((g) => g.panel === panel) ?? NAV_GROUPS.find((g) => g.panels.includes(panel))
  return group?.id ?? null
}
