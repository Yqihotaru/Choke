import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

export const cards = pgTable(
  "cards",
  {
    id: text("id").primaryKey(),
    osuId: bigint("osu_id", { mode: "number" }).unique(),
    name: text("name").notNull(),
    rarity: text("rarity").notNull(),
    job: text("job").notNull(),
    no: integer("no").notNull(),
    total: integer("total").notNull(),
    country: text("country"),
    globalRank: integer("global_rank"),
    pp: numeric("pp"),
    profileUrl: text("profile_url"),
    art: text("art"),
    banner: text("banner"),
    skills: jsonb("skills").notNull(),
    /** pool / hero / mirror；公共卡池只抽 pool */
    cardType: text("card_type").notNull().default("pool"),
    /** 镜像卡对应的 osu! 账号；公共卡与本体卡为 null */
    originOsuId: bigint("origin_osu_id", { mode: "number" }),
    /** 已废弃：旧版本体卡个人加成，恒为 0；列保留只为兼容旧库 */
    heroBonus: integer("hero_bonus").notNull().default(0),
    version: integer("version").notNull().default(1),
    /** 累计发行数；每发一张 +1，给新实例当序号，不随熔卡减少 */
    pulled: integer("pulled").notNull().default(0),
  },
  (table) => [
    index("cards_rarity_idx").on(table.rarity),
    index("cards_rarity_pp_idx").on(table.rarity, table.pp.desc().nullsLast()),
    index("cards_country_pp_idx").on(table.country, table.pp.desc().nullsLast()),
    index("cards_name_idx").on(table.name),
    index("cards_name_trgm_idx").using("gin", table.name.op("gin_trgm_ops")),
    index("cards_pp_idx").on(table.pp.desc().nullsLast()),
    index("cards_type_rarity_idx").on(table.cardType, table.rarity),
  ],
)

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  osuId: bigint("osu_id", { mode: "number" }).unique(),
  /** 对外展示的 Choke! 数字 ID，与 osu! id 解耦 */
  publicId: integer("public_id")
    .notNull()
    .default(sql`nextval('users_public_id_seq')`),
  /** 是否完成新手引导；完成前不发新手包 */
  onboarded: boolean("onboarded").notNull().default(false),
  /** 已废弃：旧版个人加成，恒为 0；列保留只为兼容旧库 */
  heroBonus: integer("hero_bonus").notNull().default(0),
  /** 分解/闪卡用精华 */
  essence: integer("essence").notNull().default(0),
  /** 市场用金币 */
  coins: integer("coins").notNull().default(100),
  /** 玩家等级 / 教程进度（由前端同步，市场等服务端校验） */
  playerLevel: integer("player_level").notNull().default(1),
  playerExp: integer("player_exp").notNull().default(0),
  tutorialStep: text("tutorial_step").notNull().default("idle"),
  tutorialDone: boolean("tutorial_done").notNull().default(false),
  progressUpdatedAt: bigint("progress_updated_at", { mode: "number" }).notNull().default(0),
  /** 回归玩家补发的一次性教程包 */
  tutorialPackClaimed: boolean("tutorial_pack_claimed").notNull().default(false),
  /** 最近一次活跃（/auth/me 刷新）；镜像池按它筛活跃账号 */
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const userCards = pgTable(
  "user_cards",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    cardId: text("card_id").notNull(),
    level: integer("level").notNull().default(1),
    constellation: integer("constellation").notNull().default(0),
    /** 当前等级内累计的经验；升级时扣除 */
    exp: integer("exp").notNull().default(0),
    /** 闪卡：实例属性，任何卡都可能出 */
    foil: boolean("foil").notNull().default(false),
    /** 这张卡的第几张：发行时从 cards.pulled 领号，熔卡、转手都不变 */
    serial: integer("serial").notNull().default(0),
    /** 实例个体值，千分比：970–1030；抽到时掷一次，之后不变 */
    rollBp: integer("roll_bp").notNull().default(1000),
    mods: jsonb("mods").notNull().default(sql`'[]'::jsonb`),
    obtainedAt: timestamp("obtained_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("user_cards_user_idx").on(table.userId),
    index("user_cards_user_obtained_idx").on(table.userId, table.obtainedAt.desc()),
    index("user_cards_user_card_idx").on(table.userId, table.cardId),
    index("user_cards_card_idx").on(table.cardId),
  ],
)

export const decks = pgTable("decks", {
  userId: text("user_id").primaryKey(),
  name: text("name").notNull().default("主卡组"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export const deckSlots = pgTable(
  "deck_slots",
  {
    userId: text("user_id").notNull(),
    /** 主队槽位 1–7 */
    slot: integer("slot").notNull(),
    userCardId: integer("user_card_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.slot] })],
)

export const userPacks = pgTable(
  "user_packs",
  {
    userId: text("user_id").notNull(),
    pool: text("pool").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.pool] })],
)

export const packTokens = pgTable(
  "pack_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    pool: text("pool").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("pack_tokens_user_idx").on(table.userId)],
)

export const packOpenings = pgTable(
  "pack_openings",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    pool: text("pool").notNull(),
    count: integer("count").notNull(),
    seed: text("seed").notNull(),
    results: jsonb("results").notNull(),
    pityBefore: integer("pity_before").notNull(),
    pityAfter: integer("pity_after").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("pack_openings_user_idx").on(table.userId)],
)

export const pity = pgTable(
  "pity",
  {
    userId: text("user_id").notNull(),
    pool: text("pool").notNull(),
    counter: integer("counter").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.pool] })],
)

export const marketListings = pgTable(
  "market_listings",
  {
    id: serial("id").primaryKey(),
    sellerId: text("seller_id").notNull(),
    userCardId: integer("user_card_id").notNull(),
    price: integer("price").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("market_listings_status_idx").on(table.status),
    // 同一张卡同时只能有一条 active 上架；sold / cancelled 留作历史
    uniqueIndex("market_listings_active_card_idx")
      .on(table.userCardId)
      .where(sql`${table.status} = 'active'`),
  ],
)
