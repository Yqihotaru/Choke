import { z } from "zod"

import { TUTORIAL_STEPS } from "../tutorial"
import { RARITIES } from "../types"

/**
 * content/ 的 zod schema。这里只描述「数据长什么样」和「互相引用是否成立」，
 * 不含任何具体数值。新增内容文件时：加 schema → 加进 contentSchema → 在 index.ts import。
 */

/** 神秘卡包有专门的开包流程，id 是代码概念，不是内容 */
export const MYSTERY_PACK_ID = "mystery"

const rarity = z.enum(RARITIES)
const int = z.number().int()
const positiveInt = int.positive()
const nonNegative = z.number().nonnegative()
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, "id 只能用字母、数字和连字符")
const perRarity = <T extends z.ZodType>(value: T) => z.record(rarity, value)
const levelCostMap = z.record(z.string().regex(/^[1-9][0-9]*$/, "突破等级必须是正整数"), positiveInt)

/** 升级曲线：[等级, 占满级总经验的比例]，分段线性 */
const levelCurve = z
  .array(z.tuple([positiveInt, z.number().min(0).max(1)]))
  .min(2)
  .superRefine((points, ctx) => {
    const [first] = points
    const last = points[points.length - 1]!
    if (first![0] !== 1 || first![1] !== 0) ctx.addIssue({ code: "custom", message: "曲线必须从 [1, 0] 开始" })
    if (last[1] !== 1) ctx.addIssue({ code: "custom", message: "曲线必须以比例 1 结束" })
    for (let i = 1; i < points.length; i += 1) {
      if (points[i]![0] <= points[i - 1]![0]) ctx.addIssue({ code: "custom", message: "曲线等级必须严格递增", path: [i] })
      if (points[i]![1] < points[i - 1]![1]) ctx.addIssue({ code: "custom", message: "曲线比例不能下降", path: [i] })
    }
  })

export const progressionSchema = z.strictObject({
  card: z.strictObject({
    levelCap: z.strictObject({ normal: positiveInt, hero: positiveInt }),
    constellationCap: z.strictObject({ normal: positiveInt, hero: positiveInt }),
    /** lv1 → 满级累计经验 */
    levelExpTotal: perRarity(positiveInt),
    levelCurve: z.strictObject({ normal: levelCurve, hero: levelCurve }),
    /** 直接喂一张卡的基础经验 */
    feedExp: perRarity(positiveInt),
    /** 升过级的卡被喂掉 / 分解时，投入经验的返还比例 */
    refundRate: z.number().min(0).max(1),
    /** 分解一张卡得到的同品质碎片个数 */
    shardsPerDismantle: positiveInt,
    /** 特定等级突破金币消耗：等级 → 金币 */
    breakthroughCoins: levelCostMap,
    /** 特定等级突破同品质碎片消耗：品质 → (等级 → 碎片数) */
    breakthroughShards: perRarity(levelCostMap),
    /** 碎片+金币「逢 N 自选」洗技能配置 */
    skillReroll: z.strictObject({
      pityInterval: int.min(2),
      shards: perRarity(positiveInt),
      coins: perRarity(int.nonnegative()),
    }),
  }),
  player: z.strictObject({
    maxLevel: positiveInt,
    /** 第 i 项 = 从 Lv.(i+1) 升到下一级的经验；要写满 Lv1 到满级（maxLevel - 1 项），表之后才按最后一项 × rate^n 增长 */
    expTable: z.array(positiveInt).min(1),
    expGrowthRate: z.number().min(1),
    /** 跳过 / 走完教程后的等级 */
    tutorialGraduateLevel: positiveInt,
    /** 离开某一步时发的玩家经验 */
    tutorialStepExp: z.partialRecord(z.enum(TUTORIAL_STEPS), positiveInt),
    /** 副本每消耗 1 点体力给的玩家经验 */
    expPerStamina: nonNegative,
  }),
  expedition: z.strictObject({
    /** 免费卡槽数；slotCosts 的第 i 项 = 买第 baseSlots+i+1 个卡槽的点数 */
    baseSlots: positiveInt,
    slotCosts: z.array(positiveInt),
    /** AP 上限：基础值，花 cost 点一次性升到 upgraded */
    ap: z.strictObject({ base: positiveInt, upgraded: positiveInt, cost: positiveInt }),
    /** 稀有度权限：C、UC、R、E 免费；这三档按 L → Mythic → Prismatic 的顺序逐级解锁，前一档没点后一档不能点 */
    rarityCosts: z.strictObject({ L: positiveInt, Mythic: positiveInt, Prismatic: positiveInt }),
    /** [玩家等级, 到这一级时一次性给的点数]；按等级累加 */
    pointsByLevel: z.array(z.tuple([positiveInt, positiveInt])).min(1),
  }),
})

const itemSchema = z.discriminatedUnion("kind", [
  z.strictObject({ name: z.string().min(1), kind: z.literal("shard"), rarity, exp: positiveInt }),
  z.strictObject({ name: z.string().min(1), kind: z.literal("exp"), exp: positiveInt }),
])

export const itemsSchema = z.record(id, itemSchema)

const itemStack = z.strictObject({ itemId: z.string(), count: positiveInt })

export const dungeonRewardsSchema = z.strictObject({
  essence: positiveInt.optional(),
  coins: positiveInt.optional(),
  /** 普通卡包数量 */
  packs: positiveInt.optional(),
  items: z.array(itemStack).min(1).optional(),
})

export const dungeonsSchema = z.record(
  id,
  z.strictObject({
    name: z.string().min(1),
    summary: z.string(),
    /** 体力消耗 */
    cost: positiveInt,
    /** 绑定的小远征地图 id；配置后需首通该地图才解锁扫荡 */
    mapId: id.optional(),
    rewards: dungeonRewardsSchema,
  }),
)

/** 功能解锁表：功能 id → 解锁条件。条件之间是"且"；服务端和前端共用这一份 */
export const unlocksSchema = z.record(
  id,
  z.strictObject({
    name: z.string().min(1),
    /** 玩家等级至少到这一级 */
    level: positiveInt,
    /** 要先完成新手引导 */
    tutorial: z.boolean().optional(),
    /** 要绑定 osu! 的账号；游客和只有邮箱的账号只能看 */
    linkedAccount: z.boolean().optional(),
  }),
)

export const economySchema = z.strictObject({
  /** 闪卡分解 / 被喂掉时的精华基数（再乘 foilEssenceMultiplier）；非闪卡不产精华 */
  foilEssence: perRarity(nonNegative),
  foilEssenceMultiplier: nonNegative,
  /** 精华镀闪的花费 */
  foilCost: positiveInt,
  /** 市场单卡价格上限（金币） */
  marketMaxPrice: positiveInt,
})

const weights = z.partialRecord(rarity, z.number().positive())

export const packsSchema = z.strictObject({
  /** 每包张数 */
  packSize: positiveInt,
  packs: z.record(
    id,
    z.strictObject({
      name: z.string().min(1),
      short: z.string().min(1),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      weights: weights.refine((w) => Object.keys(w).length > 0, "至少一档权重"),
      foilRate: z.number().min(0).max(1),
      /** 额外第 6 张镜像卡的品质权重；空对象 = 这个包不出镜像卡 */
      mirrorWeights: weights,
      /** 活动包：只靠发放获得，库存为 0 时前端隐藏 */
      event: z.boolean().optional(),
    }),
  ),
  /** 新手礼包：卡包 id（或神秘卡包 id）→ 数量 */
  starterGrant: z.record(id, positiveInt),
  /** 新手包兜底：开最后一包时还没出过这一档及以上，最后一张改成这一档 */
  starterGuarantee: z.strictObject({ pool: id, rarity }),
  mystery: z.strictObject({ name: z.string().min(1) }),
  mirror: z.strictObject({ rate: z.number().min(0).max(1), activeDays: positiveInt }),
})

const shopPackStack = z.strictObject({ pool: id, count: positiveInt })

const shopCostSchema = z
  .strictObject({
    coins: positiveInt.optional(),
    items: z.array(itemStack).min(1).optional(),
  })
  .refine((c) => Boolean(c.coins) || Boolean(c.items?.length), "商品必须至少消耗金币或一种物品")

const shopRewardSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("fixed"),
      stamina: positiveInt.optional(),
      items: z.array(itemStack).min(1).optional(),
      packs: z.array(shopPackStack).min(1).optional(),
    })
    .refine(
      (r) => Boolean(r.stamina) || Boolean(r.items?.length) || Boolean(r.packs?.length),
      "固定商品必须至少包含体力、物品或卡包之一",
    ),
  z.strictObject({
    kind: z.literal("gamble"),
    pool: z
      .array(
        z.strictObject({
          weight: z.number().positive(),
          items: z.array(itemStack).min(1),
        }),
      )
      .min(2),
  }),
])

export const shopSchema = z.record(
  id,
  z.strictObject({
    name: z.string().min(1),
    summary: z.string().min(1),
    section: z.enum(["supply", "gamble", "pity"]),
    period: z.enum(["daily", "weekly", "monthly"]),
    limit: positiveInt,
    cost: shopCostSchema,
    reward: shopRewardSchema,
  }),
)

/** 整个 content/：先各自校验，再检查跨文件引用和经济上的硬约束 */
export const contentSchema = z
  .strictObject({
    progression: progressionSchema,
    items: itemsSchema,
    dungeons: dungeonsSchema,
    economy: economySchema,
    packs: packsSchema,
    unlocks: unlocksSchema,
    shop: shopSchema,
  })
  .superRefine((content, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message })
    const { card, player } = content.progression

    for (const kind of ["normal", "hero"] as const) {
      const curve = card.levelCurve[kind]
      if (curve[curve.length - 1]![0] !== card.levelCap[kind]) {
        issue(["progression", "card", "levelCurve", kind], `曲线最后一个点必须是满级 ${card.levelCap[kind]}`)
      }
    }
    for (const lvlStr of Object.keys(card.breakthroughCoins)) {
      if (Number(lvlStr) >= card.levelCap.normal) {
        issue(["progression", "card", "breakthroughCoins", lvlStr], `突破等级必须小于普通卡满级 ${card.levelCap.normal}`)
      }
    }
    for (const r of RARITIES) {
      for (const lvlStr of Object.keys(card.breakthroughShards[r])) {
        if (Number(lvlStr) >= card.levelCap.normal) {
          issue(["progression", "card", "breakthroughShards", r, lvlStr], `突破等级必须小于普通卡满级 ${card.levelCap.normal}`)
        }
      }
    }
    if (player.tutorialGraduateLevel > player.maxLevel) {
      issue(["progression", "player", "tutorialGraduateLevel"], "不能超过玩家等级上限")
    }
    if (player.expTable.length < player.maxLevel - 1) {
      issue(["progression", "player", "expTable"], `要写满 Lv1 到 Lv${player.maxLevel}，至少 ${player.maxLevel - 1} 项`)
    }
    for (const [featureId, feature] of Object.entries(content.unlocks)) {
      if (feature.level > player.maxLevel) {
        issue(["unlocks", featureId, "level"], "不能超过玩家等级上限")
      }
      if (!feature.tutorial && feature.level > player.tutorialGraduateLevel) {
        issue(["unlocks", featureId, "level"], `不要求完成引导的功能，等级不能高于毕业等级 ${player.tutorialGraduateLevel}`)
      }
    }
    if (!content.unlocks.market) {
      issue(["unlocks", "market"], "缺少 market（市场的解锁条件）")
    }

    const { expedition } = content.progression
    if (expedition.ap.upgraded <= expedition.ap.base) {
      issue(["progression", "expedition", "ap", "upgraded"], "升级后的 AP 上限必须高于基础值")
    }
    expedition.pointsByLevel.forEach(([level], i) => {
      const previous = expedition.pointsByLevel[i - 1]?.[0] ?? 0
      if (level <= previous) {
        issue(["progression", "expedition", "pointsByLevel", i], "等级必须严格递增")
      }
      if (level > player.maxLevel) {
        issue(["progression", "expedition", "pointsByLevel", i], "不能超过玩家等级上限")
      }
    })
    if (expedition.pointsByLevel[0]![0] !== 1) {
      issue(["progression", "expedition", "pointsByLevel", 0], "第一项必须是 1 级（新玩家开局就有点数）")
    }

    // 每个品质恰好一种碎片，id 固定为 shard-<品质>；分解再喂必须比直接喂亏
    for (const r of RARITIES) {
      const shard = content.items[`shard-${r}`]
      if (!shard || shard.kind !== "shard" || shard.rarity !== r) {
        issue(["items", `shard-${r}`], `缺少 ${r} 品质的碎片（kind: shard, rarity: ${r}）`)
        continue
      }
      if (shard.exp * card.shardsPerDismantle >= card.feedExp[r]) {
        issue(["items", `shard-${r}`, "exp"], `${card.shardsPerDismantle} 个碎片的经验不能达到直接喂卡（${card.feedExp[r]}）`)
      }
    }
    for (const [itemId, item] of Object.entries(content.items)) {
      if (item.kind === "shard" && itemId !== `shard-${item.rarity}`) {
        issue(["items", itemId], `碎片 id 必须是 shard-${item.rarity}`)
      }
    }
    if (!Object.values(content.items).some((item) => item.kind === "exp")) {
      issue(["items"], "至少需要一种经验道具（分解返还要用）")
    }

    for (const [dungeonId, dungeon] of Object.entries(content.dungeons)) {
      const { rewards } = dungeon
      if (!rewards.essence && !rewards.coins && !rewards.packs && !rewards.items) {
        issue(["dungeons", dungeonId, "rewards"], "副本没有任何奖励")
      }
      rewards.items?.forEach((stack, i) => {
        if (!Object.hasOwn(content.items, stack.itemId)) {
          issue(["dungeons", dungeonId, "rewards", "items", i, "itemId"], `物品 ${stack.itemId} 不存在`)
        }
      })
    }

    const packIds = Object.keys(content.packs.packs)
    const { starterGuarantee, starterGrant } = content.packs
    if (!packIds.includes(starterGuarantee.pool)) {
      issue(["packs", "starterGuarantee", "pool"], `卡包 ${starterGuarantee.pool} 不存在`)
    }
    if (packIds.includes(MYSTERY_PACK_ID)) {
      issue(["packs", "packs", MYSTERY_PACK_ID], `${MYSTERY_PACK_ID} 留给神秘卡包，公共卡包不能用`)
    }
    for (const grantId of Object.keys(starterGrant)) {
      if (grantId !== MYSTERY_PACK_ID && !packIds.includes(grantId)) {
        issue(["packs", "starterGrant", grantId], `卡包 ${grantId} 不存在`)
      }
    }

    // 商店跨文件引用与「产出严禁进市场」硬约束（仅允许绑定挂机包 idle）
    for (const [shopId, entry] of Object.entries(content.shop)) {
      entry.cost.items?.forEach((stack, i) => {
        if (!Object.hasOwn(content.items, stack.itemId)) {
          issue(["shop", shopId, "cost", "items", i, "itemId"], `物品 ${stack.itemId} 不存在`)
        }
      })
      if (entry.reward.kind === "fixed") {
        entry.reward.items?.forEach((stack, i) => {
          if (!Object.hasOwn(content.items, stack.itemId)) {
            issue(["shop", shopId, "reward", "items", i, "itemId"], `物品 ${stack.itemId} 不存在`)
          }
        })
        entry.reward.packs?.forEach((pack, i) => {
          if (!packIds.includes(pack.pool)) {
            issue(["shop", shopId, "reward", "packs", i, "pool"], `卡包 ${pack.pool} 不存在`)
          } else if (pack.pool !== "idle") {
            issue(["shop", shopId, "reward", "packs", i, "pool"], "商店仅允许发放绑定卡包（idle），禁止发放可交易卡包")
          }
        })
      } else {
        entry.reward.pool.forEach((opt, i) => {
          opt.items.forEach((stack, j) => {
            if (!Object.hasOwn(content.items, stack.itemId)) {
              issue(["shop", shopId, "reward", "pool", i, "items", j, "itemId"], `物品 ${stack.itemId} 不存在`)
            }
          })
        })
      }
    }
  })

export type ContentData = z.infer<typeof contentSchema>
