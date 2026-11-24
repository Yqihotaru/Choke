/** 卡包 / 卡池配置的服务端入口；数值在 content/packs.json。前端通过 GET /config 读取。 */
/** 概率口径：Design/经济与养成系统 v0.3.md §4.2。卡包无保底（§4.5）。 */
import { CONTENT, MYSTERY_PACK_ID, type PackId } from "@choke/shared/content"

export type { PackId }

export const PACKS = CONTENT.packs.packs

export const PACK_SIZE = CONTENT.packs.packSize

/** 活动包：只靠发放获得，前端库存为 0 时整行隐藏 */
export const EVENT_PACKS: readonly PackId[] = (Object.keys(PACKS) as PackId[]).filter((id) => PACKS[id].event)

export const STARTER_PACKS = CONTENT.packs.starterGrant

/** 新手包兜底：开最后一包时，如果新手包里还没出过这一档及以上，最后一张改成这一档。 */
export const STARTER_GUARANTEE = CONTENT.packs.starterGuarantee

/** 神秘卡包不在公共卡池里，单独一个 id/名字。 */
export const MYSTERY_PACK = { id: MYSTERY_PACK_ID, name: CONTENT.packs.mystery.name } as const
