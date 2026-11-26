import { faceFromDef, type CardDef } from "@/card/def"
import type { CardFaceData, CardSkillRef, Element as CardElement, Job, Rarity } from "@/card/types"
import type { EncounterSpec, EncounterSummary } from "@choke/shared/battle/content"
import type { DungeonId, DungeonRewards } from "@choke/shared/dungeons"
import type { ItemId, ItemStack } from "@choke/shared/items"
import type { MailView } from "@choke/shared/mail"
import type { LedgerKind, LedgerPage } from "@choke/shared/ledger"
import type { QuestsOverview } from "@choke/shared/quests"

export type ItemWallet = Partial<Record<ItemId, number>>
/** `/users/:id/cards` 和 `/users/:id/deck` 共用的卡行 */
export interface ApiUserCard {
  id: string
  name: string
  rarity: Rarity
  job: Job
  no: number
  total: number
  country: string | null
  globalRank: number | null
  pp: string | null
  profileUrl: string | null
  art: string | null
  banner: string | null
  skillRefs: CardSkillRef[]
  version: number
  userCardId: number
  level: number
  constellation: number
  exp: number
  foil?: boolean
  /** 实例发行序号；pulled 是该卡定义的累计发行数 */
  serial?: number
  pulled?: number
  /** 实例个体值，千分比 970–1030 */
  rollBp?: number
  obtainedAt?: string
}

export type CardSort = "recent" | "rarity" | "pp" | "name"

export interface CardPage {
  rows: ApiUserCard[]
  total: number
  limit: number
  offset: number
}

export interface DeckSlot {
  slot: number
  card: ApiUserCard | null
}

export interface ApiDeck {
  name: string
  slots: DeckSlot[]
  updatedAt: string | null
}

function toCardDef(row: ApiCardDef): CardDef {
  return {
    id: row.id,
    osuId: null,
    name: row.name,
    rarity: row.rarity,
    job: row.job,
    no: row.no,
    total: row.total,
    country: row.country ?? undefined,
    globalRank: row.globalRank,
    pp: row.pp == null ? null : Number(row.pp),
    profileUrl: row.profileUrl ?? undefined,
    art: row.art ?? undefined,
    banner: row.banner ?? undefined,
    version: row.version ?? 1,
  }
}

export function toFace(row: ApiUserCard): CardFaceData {
  return faceFromDef(toCardDef(row), {
    level: row.level,
    constellation: row.constellation,
    foil: row.foil,
    rollBp: row.rollBp,
    serial: row.serial,
    pulled: row.pulled,
    skillRefs: row.skillRefs,
  })
}

/** 图鉴里的卡定义（没有实例状态）转卡面：1 级、0 命座 */
export function defToFace(row: ApiCardDef): CardFaceData {
  return faceFromDef(toCardDef(row))
}

const REQUEST_TIMEOUT_MS = 15_000

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  let res: Response
  try {
    res = await fetch(url, { credentials: "include", ...init, signal })
  } catch (err) {
    if (init?.signal?.aborted) throw err
    if (timeout.aborted) throw new ApiError("请求超时，请稍后再试", "timeout")
    throw new ApiError("网络不通，请检查连接", "network")
  }
  let data: { ok?: boolean; data?: unknown; error?: { message?: string; code?: string } }
  try {
    data = await res.json()
  } catch {
    throw new ApiError(res.ok ? "服务器返回了无法识别的内容" : `服务暂时不可用（${res.status}）`, "bad_response")
  }
  if (!res.ok || !data.ok) throw new ApiError(data.error?.message ?? "请求失败", data.error?.code)
  return data.data as T
}

/** 带机器码的接口错误，调用方可以按 code 分支处理（例如 NO_PACK）。 */
export class ApiError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = "ApiError"
    this.code = code
  }
}

export function fetchUserCards(
  userId: string,
  params: {
    rarity?: string
    q?: string
    sort?: CardSort
    page?: number
    limit?: number
    signal?: AbortSignal
    /** 只取这些 user_cards 实例 */
    ids?: number[]
  } = {},
): Promise<CardPage> {
  const { rarity, q, sort = "recent", page = 0, limit = 24, signal, ids } = params
  const search = new URLSearchParams({
    sort,
    limit: String(limit),
    offset: String(page * limit),
  })
  if (rarity) search.set("rarity", rarity)
  if (q) search.set("q", q)
  if (ids?.length) search.set("ids", ids.join(","))
  return request<CardPage>(`/api/users/${userId}/cards?${search.toString()}`, { signal })
}

export function fetchDeck(userId: string, signal?: AbortSignal): Promise<ApiDeck> {
  return request<ApiDeck>(`/api/users/${userId}/deck`, { signal })
}

export function saveDeck(
  userId: string,
  slots: (number | null)[],
): Promise<ApiDeck> {
  return request<ApiDeck>(`/api/users/${userId}/deck`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slots }),
  })
}

export function fetchFuel(
  userId: string,
  userCardId: number,
  signal?: AbortSignal,
): Promise<{ rows: ApiUserCard[] }> {
  return request<{ rows: ApiUserCard[] }>(
    `/api/users/${userId}/cards/${userCardId}/fuel`,
    { signal },
  )
}

export function levelUpCard(
  userId: string,
  userCardId: number,
): Promise<{ card: ApiUserCard; spent: number }> {
  return request<{ card: ApiUserCard; spent: number }>(
    `/api/users/${userId}/cards/${userCardId}/level`,
    { method: "POST" },
  )
}

export function ascendCard(
  userId: string,
  userCardId: number,
): Promise<{ card: ApiUserCard; consumedUserCardId: number }> {
  return request<{ card: ApiUserCard; consumedUserCardId: number }>(
    `/api/users/${userId}/cards/${userCardId}/constellation`,
    { method: "POST" },
  )
}

export interface FeedResult {
  card: ApiUserCard
  gained: number
  /** 满级后溢出作废的经验 */
  wasted: number
  levelsGained: number
  essenceGained: number
  /** 只有喂了闪卡才返回 */
  essence?: number
  items: ItemWallet
  consumedUserCardIds: number[]
}

/** 喂养：多张卡 + 多种物品一次喂给目标卡，服务端自动升级 */
export function feedCard(
  userId: string,
  userCardId: number,
  input: { cards?: number[]; items?: ItemStack[] },
): Promise<FeedResult> {
  return request<FeedResult>(`/api/users/${userId}/cards/${userCardId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cards: input.cards ?? [], items: input.items ?? [] }),
  })
}

export interface PackInventory {
  packs: Record<string, number>
  heroClaimed: boolean
}

export interface PackCatalogEntry {
  id: string
  name: string
  short: string
  color: string
  weights: Record<string, number>
  foilRate: number
  /** 活动包：库存为 0 时前端隐藏 */
  event?: boolean
}

export interface GameConfig {
  packs: PackCatalogEntry[]
  packSize: number
  deckSize: number
  starterPacks: { id: string; count: number; name: string }[]
  mirrorRate: number
}

let configPromise: Promise<GameConfig> | null = null

/** 规则配置是静态的；同一次会话里多处要用，缓存一份。 */
export function fetchGameConfig(): Promise<GameConfig> {
  if (!configPromise) {
    configPromise = request<GameConfig>("/api/config").catch((error) => {
      configPromise = null
      throw error
    })
  }
  return configPromise
}

export interface CardStats {
  total: number
  byRarity: Record<string, number>
}

let statsPromise: Promise<CardStats> | null = null

export function fetchCardStats(): Promise<CardStats> {
  if (!statsPromise) {
    statsPromise = request<CardStats>("/api/cards/stats").catch((error) => {
      statsPromise = null
      throw error
    })
  }
  return statsPromise
}

let encountersPromise: Promise<EncounterSummary[]> | null = null

/** 全部遭遇的摘要（选关、桌面战斗面板用）；内容是静态的，缓存一份 */
export function fetchEncounters(): Promise<EncounterSummary[]> {
  if (!encountersPromise) {
    encountersPromise = request<EncounterSummary[]>("/api/battle/encounters").catch((error) => {
      encountersPromise = null
      throw error
    })
  }
  return encountersPromise
}

const encounterCache = new Map<string, Promise<EncounterSpec>>()

/** 一场遭遇的完整数据（敌人、AI、支援、三星），开战直接交给引擎 */
export function fetchEncounter(id: string): Promise<EncounterSpec> {
  let promise = encounterCache.get(id)
  if (!promise) {
    promise = request<EncounterSpec>(`/api/battle/encounters/${encodeURIComponent(id)}`).catch((error) => {
      encounterCache.delete(id)
      throw error
    })
    encounterCache.set(id, promise)
  }
  return promise
}

export function fetchPackInventory(userId: string, signal?: AbortSignal): Promise<PackInventory> {
  return request<PackInventory>(`/api/users/${userId}/packs`, { signal })
}

export function openMysteryPack(
  userId: string,
  answers: string[],
): Promise<{ hero: ApiUserCard | null; packs: Record<string, number> }> {
  return request<{ hero: ApiUserCard | null; packs: Record<string, number> }>(
    `/api/users/${userId}/packs/mystery/open`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    },
  )
}

export interface AccountMe {
  id: string
  publicId: number | null
  username: string
  osuId: number | null
  email?: string | null
  /** 游客：既没有 osu! 也没有邮箱 */
  isGuest?: boolean
  /** osu：绑定了 osu!（可能同时有邮箱）；email：只有邮箱；guest：游客。旧后端没有 */
  kind?: AccountKind
  hasEmail?: boolean
  /** 只决定要不要显示后台入口；真正的权限在服务端 */
  isAdmin?: boolean
  avatarUrl: string | null
  profileUrl: string | null
  onboarded: boolean
  essence: number
  /** 碎片、经验道具等；旧后端没有这个字段 */
  items?: ItemWallet
  coins: number
  hero: ApiUserCard | null
}

export function emailRegister(
  email: string,
  password: string,
  username?: string,
): Promise<{ id: string; username: string; email: string; onboarded: boolean }> {
  return request("/auth/email/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, username }),
  })
}

export function emailLogin(
  email: string,
  password: string,
): Promise<{ id: string; username: string; email: string; onboarded: boolean }> {
  return request("/auth/email/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
}

export function fetchMe(signal?: AbortSignal): Promise<AccountMe> {
  return request<AccountMe>("/auth/me", { signal })
}

/* ============================ 账号绑定 ============================ */

export type AccountKind = "guest" | "email" | "osu"

/** 二选一界面里一边账号的对比数据 */
export interface BindAccountSummary {
  id: string
  username: string
  kind: AccountKind
  level: number
  tutorialDone: boolean
  coins: number
  cardCount: number
  bestRarity: string | null
  lastSeenAt: string
  createdAt: string
}

export interface PendingBind {
  osuId: number
  osuUsername: string
  /** 毫秒时间戳，过了要重新点绑定 */
  expiresAt: number
  /** 现在登录的账号 */
  current: BindAccountSummary
  /** 已经占着这个 osu! 号的账号 */
  osu: BindAccountSummary
}

export function fetchPendingBind(signal?: AbortSignal): Promise<{ pending: PendingBind | null }> {
  return request("/auth/bind/pending", { signal })
}

export function resolveBind(
  choice: "keep-current" | "keep-osu",
): Promise<{ userId: string; sealedUserId: string; kept: "current" | "osu" }> {
  return request("/auth/bind/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ choice, confirm: true }),
  })
}

export function cancelBind(): Promise<null> {
  return request("/auth/bind/cancel", { method: "POST" })
}

/** 给没有邮箱的账号补邮箱和密码 */
export function bindEmail(email: string, password: string): Promise<{ email: string }> {
  return request("/auth/email/bind", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
}

export function enhanceCard(
  userId: string,
  userCardId: number,
  action: "foil",
): Promise<{
  card: ApiUserCard
  cost: number
  essence: number
  action: "foil"
}> {
  return request(`/api/users/${userId}/cards/${userCardId}/enhance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  })
}

export interface MarketListing {
  id: number
  price: number
  sellerId: string
  sellerName: string
  sellerPublicId: number | null
  card: ApiUserCard
}

export interface OwnMarketListing {
  id: number
  price: number
  card: ApiUserCard
}

export function fetchMarketListings(signal?: AbortSignal): Promise<MarketListing[]> {
  return request<MarketListing[]>("/api/market/listings", { signal })
}

export function fetchOwnListings(
  userId: string,
  signal?: AbortSignal,
): Promise<OwnMarketListing[]> {
  return request<OwnMarketListing[]>(`/api/users/${userId}/market/listings`, { signal })
}

export function listMarketCard(
  userId: string,
  userCardId: number,
  price: number,
): Promise<{ id: number; price: number; card: ApiUserCard }> {
  return request(`/api/users/${userId}/market/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userCardId, price }),
  })
}

export function unlistMarketCard(
  userId: string,
  listingId: number,
): Promise<{ id: number }> {
  return request(`/api/users/${userId}/market/listings/${listingId}`, {
    method: "DELETE",
  })
}

export function buyMarketListing(
  userId: string,
  listingId: number,
): Promise<{ card: ApiUserCard; price: number; coins: number }> {
  return request(`/api/users/${userId}/market/buy/${listingId}`, {
    method: "POST",
  })
}

/* ============================ 认证 ============================ */

export function logout(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/auth/logout", { method: "POST" })
}

export function onboard(): Promise<{ onboarded: boolean }> {
  return request<{ onboarded: boolean }>("/auth/onboard", { method: "POST" })
}

export function claimTutorialPack(): Promise<{ granted?: boolean }> {
  return request<{ granted?: boolean }>("/auth/tutorial-pack", { method: "POST" })
}

/* ============================ 卡包 ============================ */

export interface OpenPackResult {
  results: {
    cardId: string
    rarity?: Rarity
    userCardId: number
    foil: boolean
    serial: number
    pulled: number
    /** 这张卡掷出的技能；技能挂在卡实例上 */
    skillRefs: CardSkillRef[]
  }[]
  packs?: Record<string, number>
}

export function takePack(
  userId: string,
  pool: string,
): Promise<{ token: string; packs: Record<string, number> }> {
  return request(`/api/users/${userId}/packs/${pool}/take`, { method: "POST" })
}

export function returnPack(
  userId: string,
  token: string,
): Promise<{ pool: string; packs: Record<string, number> }> {
  return request(`/api/users/${userId}/packs/return`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  })
}

export function openPack(
  pool: string,
  count: number,
  token?: string,
): Promise<OpenPackResult> {
  return request<OpenPackResult>(`/api/packs/${pool}/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count, token }),
  })
}

/* ============================ 卡牌详情 / 图鉴 ============================ */

export interface ApiCardDef {
  id: string
  name: string
  rarity: Rarity
  job: Job
  no: number
  total: number
  country: string | null
  globalRank: number | null
  pp: string | null
  profileUrl: string | null
  art: string | null
  banner: string | null
  version: number
  pulled?: number
  owned?: boolean
}

export function fetchCardDetail(id: string, signal?: AbortSignal): Promise<ApiCardDef> {
  return request<ApiCardDef>(`/api/cards/${encodeURIComponent(id)}`, { signal })
}

export function fetchCardCountries(
  signal?: AbortSignal,
): Promise<{ code: string; total: number }[]> {
  return request(`/api/cards/countries`, { signal })
}

export function fetchUserCodexStats(userId: string, signal?: AbortSignal): Promise<unknown> {
  return request(`/api/users/${userId}/codex/stats`, { signal })
}

export function fetchCodexPage(
  params: {
    userId?: string | null
    rarity?: string
    q?: string
    country?: string
    sort?: string
    owned?: string
    limit?: number
    offset?: number
    signal?: AbortSignal
  } = {},
): Promise<CardPage & { ownedTotal?: number }> {
  const { userId, rarity, q, country, sort = "rarity", owned, limit = 24, offset = 0, signal } = params
  const search = new URLSearchParams({ sort, limit: String(limit), offset: String(offset) })
  if (rarity) search.set("rarity", rarity)
  if (q) search.set("q", q)
  if (country) search.set("country", country)
  if (owned) search.set("owned", owned)
  const url = userId
    ? `/api/users/${userId}/codex?${search.toString()}`
    : `/api/cards?${search.toString()}`
  return request<CardPage & { ownedTotal?: number }>(url, { signal })
}

/* ============================ 教程进度 ============================ */

export interface ServerProgress {
  level: number
  exp: number
  tutorialStep: string
  tutorialDone: boolean
  linkedAccount?: boolean
  updatedAt: number
}

export function fetchProgress(userId: string, signal?: AbortSignal): Promise<ServerProgress | null> {
  return request<ServerProgress | null>(`/api/users/${userId}/progress`, { signal }).catch(() => null)
}

/** 请求把教程从 from 推进一步；下一步和经验由服务端决定。进度已变化时抛 step_mismatch */
export function advanceTutorialStep(
  userId: string,
  from: string,
): Promise<ServerProgress & { gained: number }> {
  return request(`/api/users/${userId}/tutorial/advance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from }),
  })
}

export function skipTutorialRemote(userId: string): Promise<ServerProgress> {
  return request(`/api/users/${userId}/tutorial/skip`, { method: "POST" })
}

/* ============================ 体力 / 副本 ============================ */

export interface StaminaState {
  value: number
  max: number
  nextIn: number
}

export function fetchStamina(userId: string, signal?: AbortSignal): Promise<StaminaState> {
  return request<StaminaState>(`/api/users/${userId}/stamina`, { signal })
}

export interface DungeonRunResult {
  rewards: DungeonRewards
  stamina: StaminaState
  essence: number
  coins: number
  /** 副本按体力给的玩家经验；旧后端没有这个字段 */
  player?: { level: number; exp: number; gained: number }
}

export interface DungeonStatus {
  id: DungeonId
  name: string
  summary: string
  cost: number
  rewards: DungeonRewards
  mapId?: string
  clears: number
  sweepUnlocked: boolean
}

export function fetchDungeons(userId: string, signal?: AbortSignal): Promise<DungeonStatus[]> {
  return request<DungeonStatus[]>(`/api/users/${userId}/dungeons`, { signal })
}

export function runDungeon(userId: string, dungeonId: string): Promise<DungeonRunResult> {
  return request<DungeonRunResult>(`/api/users/${userId}/dungeons/${dungeonId}/run`, {
    method: "POST",
  })
}

export function sweepDungeon(userId: string, dungeonId: string): Promise<DungeonRunResult> {
  return request<DungeonRunResult>(`/api/users/${userId}/dungeons/${dungeonId}/sweep`, {
    method: "POST",
  })
}

/* ============================ 签到 / 任务 ============================ */

export function fetchQuests(userId: string, signal?: AbortSignal): Promise<QuestsOverview> {
  return request<QuestsOverview>(`/api/users/${userId}/quests`, { signal })
}

export function signIn(
  userId: string,
): Promise<{ day: number; rewards: { label: string; count: number }[] }> {
  return request(`/api/users/${userId}/sign-in`, { method: "POST" })
}

export function claimAllQuests(
  userId: string,
): Promise<{ claimed: string[]; chests: string[]; rewards: { label: string; count: number }[] }> {
  return request(`/api/users/${userId}/quests/claim-all`, { method: "POST" })
}

export function dismantleCard(
  userId: string,
  userCardId: number,
): Promise<{
  removedUserCardId: number
  itemsGained: ItemStack[]
  essenceGained: number
  items: ItemWallet
  essence: number
}> {
  return request(`/api/users/${userId}/cards/${userCardId}/dismantle`, {
    method: "POST",
  })
}

export function dismantleCardsBatch(
  userId: string,
  userCardIds: number[],
): Promise<{
  removedUserCardIds: number[]
  itemsGained: ItemStack[]
  essenceGained: number
  items: ItemWallet
  essence: number
}> {
  return request(`/api/users/${userId}/cards/dismantle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userCardIds }),
  })
}

export interface SkillRerollCandidate {
  id: string
  name: string
  element: CardElement
  ap: number
  passive?: boolean
  desc: string
}

export interface SkillRerollInfo {
  userCardId: number
  skillRerollCount: number
  pityInterval: number
  remainingUntilSelect: number
  selectReady: boolean
  cost: {
    coins: number
    shards: number
    shardItemId: ItemId
  }
  candidates: SkillRerollCandidate[]
}

export interface SkillRerollResult {
  card: ApiUserCard
  slot: number
  mode: "random" | "select"
  previousSkillId: string
  newSkillId: string
  skillRerollCount: number
  pityInterval: number
  selectReady: boolean
  coinsSpent: number
  shardsSpent: number
  shardItemId: ItemId
  coins: number
  items: ItemWallet
}

export function fetchSkillRerollInfo(
  userId: string,
  userCardId: number,
  signal?: AbortSignal,
): Promise<SkillRerollInfo> {
  return request<SkillRerollInfo>(`/api/users/${userId}/cards/${userCardId}/reroll-skill`, { signal })
}

export function rerollCardSkill(
  userId: string,
  userCardId: number,
  input: { slot: number; skillId?: string },
): Promise<SkillRerollResult> {
  return request<SkillRerollResult>(`/api/users/${userId}/cards/${userCardId}/reroll-skill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

export interface MailBoxData {
  mails: MailView[]
  summary: MailSummary
  pinLimit: number
}

export interface MailSummary {
  unread: number
  claimable: number
  pinned: number
}

export function fetchMails(userId: string): Promise<MailBoxData> {
  return request<MailBoxData>(`/api/users/${userId}/mails`)
}

export function fetchMailSummary(userId: string): Promise<MailSummary> {
  return request<MailSummary>(`/api/users/${userId}/mails/summary`)
}

export function readMail(userId: string, mailId: number): Promise<unknown> {
  return request(`/api/users/${userId}/mails/${mailId}/read`, { method: "POST" })
}

export function claimMail(userId: string, mailId: number): Promise<unknown> {
  return request(`/api/users/${userId}/mails/${mailId}/claim`, { method: "POST" })
}

export function claimAllMails(userId: string): Promise<{ claimed: number }> {
  return request(`/api/users/${userId}/mails/claim-all`, { method: "POST" })
}

export function pinMail(userId: string, mailId: number, pinned: boolean): Promise<unknown> {
  return request(`/api/users/${userId}/mails/${mailId}/pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned }),
  })
}

export function deleteMail(userId: string, mailId: number): Promise<unknown> {
  return request(`/api/users/${userId}/mails/${mailId}`, { method: "DELETE" })
}

export function fetchLedger(
  userId: string,
  options: { kind?: LedgerKind; before?: number } = {},
): Promise<LedgerPage> {
  const query = new URLSearchParams()
  if (options.kind) query.set("kind", options.kind)
  if (options.before) query.set("before", String(options.before))
  const suffix = query.size > 0 ? `?${query}` : ""
  return request<LedgerPage>(`/api/users/${userId}/ledger${suffix}`)
}