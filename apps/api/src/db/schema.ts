import { sql } from "drizzle-orm"
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
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

import type { MailAttachment, MailAudience } from "@choke/shared/mail"
import type { BattleAction } from "@choke/shared/battle/actions"
import type { EncounterSpec } from "@choke/shared/battle/content"
import type { ExpeditionAllocation } from "@choke/shared/expedition-points"
import type { MapDef, Reward } from "@choke/shared/expedition/content"
import type {
  BattleStatus,
  ExpeditionEnd,
  ExpeditionPoolCard,
  ExpeditionSettlement,
  ExpeditionStatus,
} from "@choke/shared/expedition/view"
import type { CardSkillRef } from "@choke/shared/types"

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
  /** 邮箱登录：邮箱唯一，密码只存 scrypt 哈希 */
  email: text("email"),
  passwordHash: text("password_hash"),
  /** 对外展示的 Choke! 数字 ID，与 osu! id 解耦 */
  publicId: integer("public_id")
    .notNull()
    .default(sql`nextval('users_public_id_seq')`),
  /** 是否完成新手引导；完成前不发新手包 */
  onboarded: boolean("onboarded").notNull().default(false),
  /** 已废弃：旧版个人加成，恒为 0；列保留只为兼容旧库 */
  heroBonus: integer("hero_bonus").notNull().default(0),
  /** 闪卡精华：只来自闪卡，只用于镀闪 */
  essence: integer("essence").notNull().default(0),
  /** 经验池：可以随意分给任何一张卡，不能交易、不能转赠 */
  expPool: integer("exp_pool").notNull().default(0),
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
  /** 已弃用：体力系统已取消，列保留不用，日后统一清 */
  stamina: integer("stamina").notNull().default(240),
  staminaUpdatedAt: bigint("stamina_updated_at", { mode: "number" }).notNull().default(0),
  /** 最近一次活跃（/auth/me 刷新）；镜像池按它筛活跃账号 */
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  /** 已弃用：挂机包已取消，onlineDay / onlineSeconds 两列保留不用，日后统一清 */
  onlineDay: text("online_day"),
  onlineSeconds: integer("online_seconds").notNull().default(0),
  /** 管理员：只能在数据库里改（scripts/set-admin.ts），没有任何接口能设置 */
  isAdmin: boolean("is_admin").notNull().default(false),
  /** 账号绑定时落选而被封存：不能登录，osu! id 和邮箱已释放，原值存在 sealed_*（见 migrations/0016） */
  sealedAt: timestamp("sealed_at", { withTimezone: true }),
  sealedInto: text("sealed_into"),
  sealedOsuId: bigint("sealed_osu_id", { mode: "number" }),
  sealedEmail: text("sealed_email"),
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
    /** 这张卡自己的技能 id：[{ skillId }]；发卡时掷一次，可消耗碎片+金币重洗 */
    skillRefs: jsonb("skill_refs").$type<CardSkillRef[]>().notNull().default(sql`'[]'::jsonb`),
    /** 单卡技能重洗保底计数：0..(pityInterval-2) 为随机洗，达到 pityInterval-1 时下一次触发自选并归零 */
    skillRerollCount: integer("skill_reroll_count").notNull().default(0),
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

/** 碎片、经验道具等可堆叠物品；item_id 见 @choke/shared/items */
export const userItems = pgTable(
  "user_items",
  {
    userId: text("user_id").notNull(),
    itemId: text("item_id").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.itemId] })],
)

/** 统一商店周期限购计数（日/周/月重置周期见 @choke/shared/reset） */
export const shopPurchases = pgTable(
  "shop_purchases",
  {
    userId: text("user_id").notNull(),
    itemId: text("item_id").notNull(),
    periodKey: text("period_key").notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.itemId, table.periodKey] })],
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
    deposit: integer("deposit").notNull().default(0),
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

export const dungeonRuns = pgTable(
  "dungeon_runs",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    dungeon: text("dungeon").notNull(),
    cost: integer("cost").notNull(),
    rewards: jsonb("rewards").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("dungeon_runs_user_idx").on(table.userId, table.createdAt.desc())],
)

export const mails = pgTable(
  "mails",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull().default("system"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    /** null = 没有附件；格式见 @choke/shared/mail */
    attachment: jsonb("attachment").$type<MailAttachment | null>(),
    readAt: timestamp("read_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    pinned: boolean("pinned").notNull().default(false),
    /** 后台群发的批次；系统自动发的为 null */
    batchId: integer("batch_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("mails_user_created_idx").on(table.userId, table.createdAt.desc())],
)

/** 后台发信记录：谁、发给谁、发了什么 */
export const adminMailBatches = pgTable(
  "admin_mail_batches",
  {
    id: serial("id").primaryKey(),
    adminId: text("admin_id").notNull(),
    audience: jsonb("audience").$type<MailAudience>().notNull(),
    recipientCount: integer("recipient_count").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    attachment: jsonb("attachment").$type<MailAttachment | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("admin_mail_batches_created_idx").on(table.createdAt.desc())],
)

/** 流水：所有货币、道具、卡包、卡牌的增减，正数是得到、负数是失去 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    ref: text("ref").notNull().default(""),
    delta: integer("delta").notNull(),
    source: text("source").notNull(),
    sourceRef: text("source_ref"),
    userCardId: integer("user_card_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("ledger_user_idx").on(table.userId, table.id.desc())],
)

/** 远征：一次出征的全部进度。同一玩家最多一个未结束（active / suspended）的 */
export const expeditions = pgTable(
  "expeditions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    mapId: text("map_id").notNull(),
    status: text("status").$type<ExpeditionStatus>().notNull().default("active"),
    seed: text("seed").notNull(),
    contentVersion: text("content_version").notNull(),
    map: jsonb("map").$type<MapDef>().notNull(),
    pool: jsonb("pool").$type<ExpeditionPoolCard[]>().notNull(),
    allocation: jsonb("allocation").$type<ExpeditionAllocation>().notNull(),
    position: text("position").notNull(),
    nodeDone: boolean("node_done").notNull().default(false),
    flags: jsonb("flags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    hpRatio: doublePrecision("hp_ratio").notNull().default(1),
    /** 威胁值：只在走进带威胁的格子、做事件选择时变；档位由它和地图的阈值算出，战斗中不变 */
    threat: integer("threat").notNull().default(0),
    drops: jsonb("drops").$type<{ node: string; reward: Reward }[]>().notNull().default(sql`'[]'::jsonb`),
    /** 已弃用：体力系统已取消，列保留不用，日后统一清 */
    staminaCost: integer("stamina_cost").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: text("end_reason").$type<ExpeditionEnd>(),
    settlement: jsonb("settlement").$type<ExpeditionSettlement>(),
  },
  (table) => [
    index("expeditions_user_idx").on(table.userId, table.id.desc()),
    uniqueIndex("expeditions_one_open_idx")
      .on(table.userId)
      .where(sql`${table.status} in ('active', 'suspended')`),
  ],
)

export const expeditionBattles = pgTable(
  "expedition_battles",
  {
    id: serial("id").primaryKey(),
    expeditionId: integer("expedition_id").notNull(),
    nodeId: text("node_id").notNull(),
    status: text("status").$type<BattleStatus>().notNull().default("preparing"),
    encounter: jsonb("encounter").$type<EncounterSpec>().notNull(),
    seed: text("seed").notNull(),
    apMax: integer("ap_max").notNull(),
    hpRatioStart: doublePrecision("hp_ratio_start").notNull(),
    lineup: jsonb("lineup").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
    bench: jsonb("bench").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
    actions: jsonb("actions").$type<BattleAction[]>().notNull().default(sql`'[]'::jsonb`),
    retries: integer("retries").notNull().default(0),
    stars: integer("stars"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("expedition_battles_node_idx").on(table.expeditionId, table.nodeId)],
)

export const mapClears = pgTable(
  "map_clears",
  {
    userId: text("user_id").notNull(),
    mapId: text("map_id").notNull(),
    bestStars: integer("best_stars").notNull().default(0),
    /** 通关目标最多一次达成几个（地图没写目标就一直是 0） */
    bestObjectives: integer("best_objectives").notNull().default(0),
    clears: integer("clears").notNull().default(0),
    firstClearedAt: timestamp("first_cleared_at", { withTimezone: true }).defaultNow().notNull(),
    lastClearedAt: timestamp("last_cleared_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.mapId] })],
)

/** 图鉴数据：每个敌人击败过几次、揭开过哪些隐藏弱点 */
export const bestiary = pgTable(
  "bestiary",
  {
    userId: text("user_id").notNull(),
    enemyId: text("enemy_id").notNull(),
    defeated: integer("defeated").notNull().default(0),
    hiddenFound: jsonb("hidden_found").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.enemyId] })],
)

/** 任务进度与签到记录：按周期编号分开存，换周期自然从 0 开始（见 migrations/0011） */
export const questProgress = pgTable(
  "quest_progress",
  {
    userId: text("user_id").notNull(),
    questId: text("quest_id").notNull(),
    periodKey: text("period_key").notNull(),
    progress: integer("progress").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    autoClaimed: boolean("auto_claimed").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.questId, table.periodKey] })],
)

/** 每日推荐谱面用过的 osu! 成绩：score_id 唯一，同一条成绩只能用一次（见 migrations/0015） */
export const osuScoreClaims = pgTable(
  "osu_score_claims",
  {
    scoreId: bigint("score_id", { mode: "number" }).primaryKey(),
    userId: text("user_id").notNull(),
    beatmapId: integer("beatmap_id").notNull(),
    dayKey: text("day_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("osu_score_claims_user_day_idx").on(table.userId, table.dayKey)],
)

/** 本体卡吞噬镜像卡获得的共鸣属性（每个 mirror-<osuId> 只能吃 1 次，最多 8 条） */
export const heroResonance = pgTable(
  "hero_resonance",
  {
    userId: text("user_id").notNull(),
    sourceCardId: text("source_card_id").notNull(),
    attribute: text("attribute").notNull(),
    valueBp: integer("value_bp").notNull(),
    slot: integer("slot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.sourceCardId] }),
    index("hero_resonance_user_attr_idx").on(table.userId, table.attribute),
  ],
)
