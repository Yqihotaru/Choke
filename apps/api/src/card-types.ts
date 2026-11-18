/**
 * 卡片来源类型。公共卡池只抽 `pool`；本体卡和镜像卡各自独立，
 * 不能混进公共卡池、图鉴统计或全服收集率。
 */
export const CARD_TYPES = {
  pool: "pool",
  hero: "hero",
  mirror: "mirror",
} as const

export type CardType = (typeof CARD_TYPES)[keyof typeof CARD_TYPES]

export const HERO_PREFIX = "hero-"
export const MIRROR_PREFIX = "mirror-"

export function isHeroId(id: string) {
  return id.startsWith(HERO_PREFIX)
}

export function isMirrorId(id: string) {
  return id.startsWith(MIRROR_PREFIX)
}
