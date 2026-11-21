import { faceFromDef } from "@/card/def"
import type { CardFaceData, CardSkill, CardSkillRef, Job, Rarity } from "@/card/types"

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
  skills: CardSkill[]
  /** 技能引用（新）：存在时优先于 skills */
  skillRefs?: CardSkillRef[]
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

export function toFace(row: ApiUserCard): CardFaceData {
  return faceFromDef(
    {
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
      skills: row.skills,
      skillRefs: row.skillRefs,
      version: row.version ?? 1,
    },
    {
      level: row.level,
      constellation: row.constellation,
      foil: row.foil,
      rollBp: row.rollBp,
      serial: row.serial,
      pulled: row.pulled,
    },
  )
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init })
  const data = await res.json()
  if (!data.ok) throw new ApiError(data.error?.message ?? "请求失败", data.error?.code)
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

export function meltCard(
  userId: string,
  userCardId: number,
  sourceUserCardId: number,
): Promise<{
  card: ApiUserCard
  gained: number
  essenceGained: number
  essence: number
  consumedUserCardId: number
}> {
  return request<{
    card: ApiUserCard
    gained: number
    essenceGained: number
    essence: number
    consumedUserCardId: number
  }>(`/api/users/${userId}/cards/${userCardId}/melt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceUserCardId }),
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
}

export interface GameConfig {
  packs: PackCatalogEntry[]
  pity: { threshold: number; rarity: string }
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
  avatarUrl: string | null
  profileUrl: string | null
  onboarded: boolean
  essence: number
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
    fromPity?: boolean
    userCardId: number
    foil: boolean
    serial: number
    pulled: number
  }[]
  pity: { before: number; after: number }
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
  skills: CardSkill[]
  skillRefs?: CardSkillRef[]
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
  updatedAt: number
}

export function fetchProgress(userId: string, signal?: AbortSignal): Promise<ServerProgress | null> {
  return request<ServerProgress | null>(`/api/users/${userId}/progress`, { signal }).catch(() => null)
}

export function saveProgress(
  userId: string,
  progress: ServerProgress,
): Promise<ServerProgress | null> {
  return request<ServerProgress | null>(`/api/users/${userId}/progress`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      level: progress.level,
      exp: progress.exp,
      tutorialStep: progress.tutorialStep,
      tutorialDone: progress.tutorialDone,
      updatedAt: progress.updatedAt,
    }),
  }).catch(() => null)
}
