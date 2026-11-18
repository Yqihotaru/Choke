import type { CardFaceData, Element } from "../card/types"

export type BattlePhase = "prepare" | "battle" | "victory"
export type TurnOwner = "player" | "enemy"

export interface BossTrait {
  name: string
  element: Element
  locked?: boolean
}

export interface BossIntent {
  id: string
  name: string
  element: Element
  kind: string
  desc: string
}

export interface BossState {
  name: string
  hp: number
  maxHp: number
  /** 无敌结界剩余阻挡次数；>0 时命中伤害强制为 0 并消耗 1 层 */
  barrierHits: number
  awakenStack: number
  maxAwaken: number
  weaknesses: Element[]
  traits: BossTrait[]
  intents: BossIntent[]
}

export interface SupportUnit {
  id: string
  name: string
  element: Element
  job: CardFaceData["job"]
  roleText: string
  triggered?: boolean
}

export interface ActiveBattleSlot {
  card: CardFaceData
  cooldown: number
  boost: boolean
  hitDamage?: number
  guarding?: boolean
}

export interface BenchBattleCard {
  card: CardFaceData
  cooldown: number
}

export interface SkillDisplayMeta {
  mult: number
  cd: number
  range: string
  desc: string
}

export interface DamagePopup {
  id: number
  value: number
  combo: number
  isWeak: boolean
  blocked?: boolean
}

export interface VictoryRewardItem {
  id: string
  kind: "card" | "material" | "gold"
  title: string
  subtitle: string
  rarity?: CardFaceData["rarity"]
  isNew?: boolean
}

export interface VictorySummary {
  baseExp: number
  bonusRates: { label: string; pct: number }[]
  finalExp: number
  chestRatePct: number
  rewards: VictoryRewardItem[]
}

export interface BattleArenaProps {
  phase: BattlePhase
  turnOwner: TurnOwner
  turnBanner: "PLAYER TURN" | "ENEMY TURN" | null
  round: number
  ap: number
  maxAp?: number
  combo: number
  overkillPct: number

  boss: BossState
  partyName: string
  partyHp: number
  partyMaxHp: number
  partyBuffs: string[]
  slots: ActiveBattleSlot[]
  bench: BenchBattleCard[]
  supports: SupportUnit[]
  swapCooldown: number

  skillMetaMap?: Record<string, SkillDisplayMeta>
  activeCutin: { cardName: string; jobLabel: string; skillName: string } | null
  supportCutin: { name: string; actionText: string } | null
  guardBanner: string | null
  damagePopup: DamagePopup | null
  bossSlashKey: number
  enemyLaserTargets: number[]

  speedHigh: boolean
  logs: string[]
  dialogue: { speaker: string; title: string; text: string } | null
  victory: VictorySummary | null

  onStartBattle: () => void
  onCastSkill: (slotIndex: number, skillName: string, element: Element, apCost: number) => void
  onDefend: () => void
  onEndRound: () => void
  onFinishOverkill: () => void
  onSwapCard: (activeSlotIndex: number, benchCardId: string) => void
  onToggleSpeed: () => void
  onAdvanceDialogue: () => void
  onSkipDialogue: () => void
  onRestartDemo?: () => void
}