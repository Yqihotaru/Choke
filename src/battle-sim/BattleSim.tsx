import { useEffect, useRef, useState } from "react"

import type { CardFaceData, Element } from "../card/types"
import { BattleArenaView } from "./BattleArenaView"
import type {
  ActiveBattleSlot,
  BattlePhase,
  BenchBattleCard,
  BossIntent,
  BossState,
  DamagePopup,
  SkillDisplayMeta,
  SupportUnit,
  TurnOwner,
  VictorySummary,
} from "./battle.types"

const SKILL_META: Record<string, SkillDisplayMeta> = {
  "突击·零一": { mult: 1.0, cd: 3, range: "近战单体", desc: "0 AP 起手突击，快速叠高 Combo 倍率" },
  "极限流连打": { mult: 2.5, cd: 3, range: "近战连击", desc: "高倍率连续打击，受 BOOST 增幅显著" },
  "巨型突击": { mult: 2.3, cd: 3, range: "光属性", desc: "命中弱点属性时伤害额外提升 50%" },
  "巨型手里剑": { mult: 2.9, cd: 3, range: "远程投掷", desc: "无视部分重装甲减伤" },
  "铁壁架势": { mult: 0.9, cd: 2, range: "自身防御", desc: "攻击后提高下回合坦克援护概率" },
  "贰式豪翔波": { mult: 2.7, cd: 3, range: "远程穿透", desc: "暗属性冲击波，高额破盾" },
  "泡菜火锅": { mult: 0.8, cd: 2, range: "全队回复", desc: "恢复讨伐队 4,200 HP 并附加恢复状态" },
  "轮攻之剑": { mult: 2.4, cd: 3, range: "冰属性", desc: "命中冰弱点触发极寒暴击" },
  "毗沙门天加护": { mult: 1.5, cd: 2, range: "光属性", desc: "附带全队 1 回合士气增幅" },
  "舞女": { mult: 1.1, cd: 2, range: "火属性", desc: "消耗 1 AP 触发连击鼓舞" },
  "六色破坏光线": { mult: 4.8, cd: 4, range: "全属性贯通", desc: "高费爆发奥义，最适合打 OVER KILL" },
  "魔力球": { mult: 1.8, cd: 2, range: "法术单体", desc: "稳定法术输出" },
  "烈焰斩": { mult: 2.4, cd: 3, range: "火属性", desc: "备战火系主力技" },
}

const INTENT_POOL: BossIntent[] = [
  { id: "breath", name: "恐息", element: "dark", kind: "全体远程 (0.5倍)", desc: "对多名队员发射魔能射线" },
  { id: "awaken", name: "魔人觉醒", element: "fire", kind: "阶段蓄力", desc: "叠加 1 层觉醒，满 4 层后暴走" },
  { id: "wait", name: "待机", element: "physical", kind: "无行动", desc: "本回合蓄力喘息，抓紧破盾" },
]

const INITIAL_PARTY: CardFaceData[] = [
  {
    id: "hero-7562902",
    name: "Mrekk",
    rarity: "L",
    job: "warrior",
    level: 64,
    mods: ["HD", "DT"],
    constellation: 8,
    no: 1,
    total: 200000,
    globalRank: 1,
    pp: 28412,
    country: "AU",
    isHero: true,
    foil: true,
    skills: [
      { name: "突击·零一", element: "physical", ap: 0 },
      { name: "极限流连打", element: "thunder", ap: 2 },
      { name: "不屈斗志", element: "fire", ap: 0, passive: true },
    ],
  },
  {
    id: "pool-2",
    name: "chocomint",
    rarity: "Radiant",
    job: "mage",
    level: 53,
    mods: ["HD", "HR"],
    constellation: 5,
    no: 2,
    total: 200000,
    globalRank: 14,
    pp: 19850,
    country: "KR",
    skills: [
      { name: "巨型突击", element: "light", ap: 2 },
      { name: "巨型手里剑", element: "metal", ap: 3 },
    ],
  },
  {
    id: "pool-3",
    name: "WhiteCat",
    rarity: "E",
    job: "tank",
    level: 44,
    mods: ["HR"],
    constellation: 3,
    no: 3,
    total: 200000,
    globalRank: 28,
    pp: 17900,
    country: "DE",
    skills: [
      { name: "铁壁架势", element: "earth", ap: 1 },
      { name: "贰式豪翔波", element: "dark", ap: 3 },
    ],
  },
  {
    id: "pool-4",
    name: "abrico uwu",
    rarity: "L",
    job: "support",
    level: 48,
    mods: [],
    constellation: 4,
    no: 4,
    total: 200000,
    globalRank: 88361,
    pp: 5467,
    country: "BO",
    skills: [
      { name: "泡菜火锅", element: "wood", ap: 2 },
      { name: "连击发生率", element: "thunder", ap: 0, passive: true },
    ],
  },
  {
    id: "pool-5",
    name: "Vaxei",
    rarity: "R",
    job: "warrior",
    level: 55,
    mods: ["DT"],
    constellation: 6,
    no: 5,
    total: 200000,
    globalRank: 42,
    pp: 16210,
    country: "US",
    skills: [
      { name: "轮攻之剑", element: "ice", ap: 2 },
      { name: "毗沙门天加护", element: "light", ap: 1 },
    ],
  },
  {
    id: "pool-6",
    name: "Mathi",
    rarity: "UC",
    job: "support",
    level: 48,
    mods: ["HD"],
    constellation: 2,
    no: 6,
    total: 200000,
    globalRank: 67,
    pp: 15430,
    country: "CL",
    skills: [
      { name: "舞女", element: "fire", ap: 1 },
      { name: "异常抗性", element: "wood", ap: 0, passive: true },
    ],
  },
  {
    id: "pool-7",
    name: "Maliszewski",
    rarity: "Prismatic",
    job: "mage",
    level: 61,
    mods: ["HD", "DT", "HR"],
    constellation: 6,
    no: 7,
    total: 200000,
    globalRank: 5,
    pp: 22100,
    country: "PL",
    foil: true,
    skills: [
      { name: "六色破坏光线", element: "light", ap: 5, mp: 4 },
      { name: "魔力球", element: "dark", ap: 2, mp: 1 },
    ],
  },
]

const INITIAL_BENCH: CardFaceData[] = [
  {
    id: "bench-1",
    name: "btmc",
    rarity: "E",
    job: "warrior",
    level: 50,
    mods: ["HR"],
    constellation: 3,
    no: 11,
    total: 200000,
    globalRank: 312,
    pp: 12100,
    country: "US",
    skills: [
      { name: "突击·零一", element: "physical", ap: 0 },
      { name: "烈焰斩", element: "fire", ap: 2 },
    ],
  },
  {
    id: "bench-2",
    name: "Cookiezi",
    rarity: "Prismatic",
    job: "mage",
    level: 70,
    mods: ["HD", "HR"],
    constellation: 6,
    no: 12,
    total: 200000,
    globalRank: 9,
    pp: 21500,
    country: "KR",
    foil: true,
    skills: [{ name: "六色破坏光线", element: "light", ap: 5, mp: 4 }],
  },
]

const INITIAL_SUPPORTS: SupportUnit[] = [
  { id: "sup-1", name: "使徒劳内亚", element: "light", job: "mage", roleText: "开局破盾支援" },
  { id: "sup-2", name: "使徒萨马赞", element: "fire", job: "warrior", roleText: "回合连携追击" },
  { id: "sup-3", name: "使徒塔尔戈", element: "ice", job: "support", roleText: "全队战意回复" },
]

function makeInitialBoss(): BossState {
  return {
    name: "魔人希尔基·利特尔",
    hp: 115_000,
    maxHp: 115_000,
    barrierHits: 2,
    awakenStack: 0,
    maxAwaken: 4,
    weaknesses: ["light", "ice", "fire"],
    traits: [
      { name: "重装甲 2", element: "earth", locked: true },
      { name: "沉睡无效体质", element: "dark", locked: true },
    ],
    intents: [INTENT_POOL[0], INTENT_POOL[2]],
  }
}

export function BattleSim() {
  const [phase, setPhase] = useState<BattlePhase>("prepare")
  const [turnOwner, setTurnOwner] = useState<TurnOwner>("player")
  const [turnBanner, setTurnBanner] = useState<"PLAYER TURN" | "ENEMY TURN" | null>(null)
  const [round, setRound] = useState(1)
  const [ap, setAp] = useState(5)
  const [combo, setCombo] = useState(0)
  const [overkillPct, setOverkillPct] = useState(0)

  const [boss, setBoss] = useState<BossState>(makeInitialBoss)
  const [partyHp, setPartyHp] = useState(29_190)
  const partyMaxHp = 29_190
  const [partyBuffs, setPartyBuffs] = useState<string[]>(["全队物理+10%", "开局士气"])
  const [slots, setSlots] = useState<ActiveBattleSlot[]>(() =>
    INITIAL_PARTY.map((card, i) => ({ card, cooldown: 0, boost: i === 0 || i === 4 })),
  )
  const [bench, setBench] = useState<BenchBattleCard[]>(() =>
    INITIAL_BENCH.map((card) => ({ card, cooldown: 0 })),
  )
  const [supports, setSupports] = useState<SupportUnit[]>(INITIAL_SUPPORTS)
  const [swapCooldown, setSwapCooldown] = useState(0)

  const [activeCutin, setActiveCutin] = useState<{ cardName: string; jobLabel: string; skillName: string } | null>(null)
  const [supportCutin, setSupportCutin] = useState<{ name: string; actionText: string } | null>(null)
  const [guardBanner, setGuardBanner] = useState<string | null>(null)
  const [damagePopup, setDamagePopup] = useState<DamagePopup | null>(null)
  const [bossSlashKey, setBossSlashKey] = useState(0)
  const [enemyLaserTargets, setEnemyLaserTargets] = useState<number[]>([])

  const [speedHigh, setSpeedHigh] = useState(true)
  const [logs, setLogs] = useState<string[]>(["准备战斗：点击中央【战斗开始】进入模拟对战！"])
  const [dialogueStep, setDialogueStep] = useState<number | null>(null)
  const [dialogueTriggered, setDialogueTriggered] = useState(false)
  const [victory, setVictory] = useState<VictorySummary | null>(null)

  const timersRef = useRef<number[]>([])
  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }
  const schedule = (fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms))
  }
  useEffect(() => clearTimers, [])

  const pushLog = (text: string) => setLogs((prev) => [text, ...prev].slice(0, 40))

  const rollBoosts = (list: ActiveBattleSlot[]) => {
    const readyIdx = list.map((s, i) => (s.cooldown === 0 ? i : -1)).filter((i) => i >= 0)
    const picked = new Set<number>()
    while (picked.size < Math.min(2, readyIdx.length)) {
      picked.add(readyIdx[Math.floor(Math.random() * readyIdx.length)])
    }
    return list.map((s, i) => ({ ...s, boost: picked.has(i) }))
  }

  const resetAndStart = () => {
    clearTimers()
    setPhase("battle")
    setTurnOwner("player")
    setRound(1)
    setAp(5)
    setCombo(0)
    setOverkillPct(0)
    setSwapCooldown(0)
    setDialogueStep(null)
    setDialogueTriggered(false)
    setVictory(null)
    setBoss(makeInitialBoss())
    setPartyHp(partyMaxHp)
    setSlots(INITIAL_PARTY.map((card, i) => ({ card, cooldown: 0, boost: i === 0 || i === 4 })))
    setBench(INITIAL_BENCH.map((card) => ({ card, cooldown: 0 })))
    setSupports(INITIAL_SUPPORTS)
    setTurnBanner("PLAYER TURN")
    pushLog("Round 1 开始！支援使徒准备发动开局支援！")

    // 演示开局支援自动破盾 1 层
    schedule(() => {
      setTurnBanner(null)
      setSupports((prev) => prev.map((s, idx) => (idx === 0 ? { ...s, triggered: true } : s)))
      setSupportCutin({ name: INITIAL_SUPPORTS[0].name, actionText: "的支援攻击！（削减结界 1 层）" })
      setBossSlashKey((k) => k + 1)
      setBoss((b) => ({ ...b, barrierHits: Math.max(0, b.barrierHits - 1) }))
      setDamagePopup({ id: Date.now(), value: 0, combo: 0, isWeak: false, blocked: true })
      pushLog("使徒劳内亚 发动支援攻击，BOSS 无敌结界削减为 1 层！")

      schedule(() => {
        setSupportCutin(null)
        setSupports((prev) => prev.map((s) => ({ ...s, triggered: false })))
      }, 900)
    }, 650)
  }

  const handleCastSkill = (slotIdx: number, skillName: string, element: Element, cost: number) => {
    if (phase !== "battle" || turnOwner !== "player" || dialogueStep !== null) return
    const slot = slots[slotIdx]
    if (!slot || slot.cooldown > 0 || cost > ap) return

    const meta = SKILL_META[skillName] ?? { mult: 1.5, cd: 3, range: "攻击", desc: "" }
    const nextCombo = combo + 1
    const isWeak = boss.weaknesses.includes(element)
    const blocked = boss.barrierHits > 0

    const comboMult = 1 + (nextCombo - 1) * 0.15
    const boostMult = slot.boost ? 1.5 : 1.0
    const weakMult = isWeak ? 1.5 : 1.0
    const rawDmg = blocked
      ? 0
      : Math.round(slot.card.level * 185 * meta.mult * comboMult * boostMult * weakMult * (0.95 + Math.random() * 0.1))

    setAp((v) => Math.max(0, v - cost))
    setCombo(nextCombo)
    setActiveCutin({
      cardName: slot.card.name,
      jobLabel: slot.card.job.toUpperCase(),
      skillName,
    })
    setBossSlashKey((k) => k + 1)
    setDamagePopup({ id: Date.now(), value: rawDmg, combo: nextCombo, isWeak, blocked })

    const nextHp = Math.max(0, boss.hp - rawDmg)
    const nextBarrier = blocked ? Math.max(0, boss.barrierHits - 1) : boss.barrierHits

    // 计算 Overkill 溢出百分比
    if (!blocked && boss.hp <= 0) {
      const addPct = Math.max(3, Math.round((rawDmg / boss.maxHp) * 100))
      setOverkillPct((p) => p + addPct)
    } else if (!blocked && nextHp === 0) {
      const overflow = Math.max(0, rawDmg - boss.hp)
      const initPct = Math.max(2, Math.round((overflow / boss.maxHp) * 100))
      setOverkillPct((p) => p + initPct)
    }

    setBoss((b) => ({ ...b, hp: nextHp, barrierHits: nextBarrier }))

    if (skillName === "泡菜火锅") {
      setPartyHp((v) => Math.min(partyMaxHp, v + 4200))
      setPartyBuffs((b) => (b.includes("火锅持续恢复") ? b : [...b, "火锅持续恢复"]))
    }

    setSlots((prev) => prev.map((s, i) => (i === slotIdx ? { ...s, cooldown: meta.cd, boost: false } : s)))

    if (blocked) {
      pushLog(`${slot.card.name} 击中【无敌结界】！造成 0 伤害${nextBarrier === 0 ? "（结界已击破！）" : ""}`)
    } else {
      pushLog(
        `${slot.card.name}「${skillName}」→ ${rawDmg.toLocaleString("en-US")} 伤害${isWeak ? "（弱点!）" : ""}（${nextCombo} COMBO）`,
      )
    }

    schedule(() => setActiveCutin(null), 950)

    if (!dialogueTriggered && nextHp > 0 && nextHp <= boss.maxHp * 0.55) {
      setDialogueTriggered(true)
      schedule(() => setDialogueStep(0), 650)
    }
  }

  const runEnemyTurn = (defended: boolean, curRound: number, curSlots: ActiveBattleSlot[]) => {
    setTurnOwner("enemy")
    setTurnBanner("ENEMY TURN")

    schedule(() => {
      setTurnBanner(null)
      const tankIdx = curSlots.findIndex((s) => s.card.job === "tank" && s.cooldown === 0)
      const guarded = tankIdx >= 0 && (defended || Math.random() < 0.7)
      const targets = [0, 2, 4]

      setEnemyLaserTargets(targets)
      if (guarded && tankIdx >= 0) {
        setGuardBanner(`${curSlots[tankIdx].card.name} 的援护防御！`)
      }

      const baseDmg = defended ? 950 : 2100
      let totalTaken = 0

      setSlots((prev) =>
        prev.map((s, i) => {
          if (!targets.includes(i)) return s
          const taken = guarded && i === tankIdx ? Math.round(baseDmg * 0.4) : baseDmg
          totalTaken += taken
          return { ...s, hitDamage: taken, guarding: guarded && i === tankIdx }
        }),
      )

      setPartyHp((v) => Math.max(0, v - totalTaken))
      setBoss((b) => ({
        ...b,
        awakenStack: b.awakenStack >= b.maxAwaken ? 1 : b.awakenStack + 1,
      }))
      pushLog(`魔人发动多目标激光打击！讨伐队受到 ${totalTaken.toLocaleString("en-US")} 伤害。`)

      schedule(() => {
        setEnemyLaserTargets([])
        setGuardBanner(null)

        const nextRound = curRound + 1
        setRound(nextRound)
        setCombo(0)
        setAp(Math.min(10, nextRound + 4))
        setSwapCooldown((c) => Math.max(0, c - 1))
        setBoss((b) => ({
          ...b,
          intents: [INTENT_POOL[nextRound % INTENT_POOL.length], INTENT_POOL[(nextRound + 1) % INTENT_POOL.length]],
        }))
        setSlots((prev) =>
          rollBoosts(
            prev.map((s) => ({
              ...s,
              cooldown: Math.max(0, s.cooldown - 1),
              hitDamage: undefined,
              guarding: false,
            })),
          ),
        )
        setBench((prev) => prev.map((b) => ({ ...b, cooldown: Math.max(0, b.cooldown - 1) })))
        setTurnOwner("player")
        setTurnBanner("PLAYER TURN")
        pushLog(`Round ${nextRound} 开始！全队冷却 -1，AP 充能至 ${Math.min(10, nextRound + 4)}。`)
        schedule(() => setTurnBanner(null), 800)
      }, 950)
    }, 700)
  }

  const handleFinishOverkill = () => {
    setPhase("victory")
    const baseExp = 2400
    const bonusRates = [
      { label: "胜利加成", pct: 20 },
      { label: "OVER KILL 奖励", pct: overkillPct },
    ]
    const totalMult = 1 + bonusRates.reduce((acc, b) => acc + b.pct, 0) / 100
    setVictory({
      baseExp,
      bonusRates,
      finalExp: Math.round(baseExp * totalMult),
      chestRatePct: 100 + overkillPct,
      rewards: [
        { id: "r1", kind: "material", title: "进阶材料 T3 ×4", subtitle: "战役战利品", isNew: true },
        { id: "r2", kind: "gold", title: "金币 ×450", subtitle: "关卡结算" },
        { id: "r3", kind: "card", title: "随机卡包 ×2", subtitle: "黄金卡包", isNew: true },
      ],
    })
  }

  const handleSwapCard = (activeSlotIdx: number, benchCardId: string) => {
    const outSlot = slots[activeSlotIdx]
    const inBench = bench.find((b) => b.card.id === benchCardId)
    if (!outSlot || !inBench) return

    setSlots((prev) =>
      prev.map((s, i) => (i === activeSlotIdx ? { card: inBench.card, cooldown: 0, boost: false } : s)),
    )
    setBench((prev) => [
      ...prev.filter((b) => b.card.id !== benchCardId),
      { card: outSlot.card, cooldown: outSlot.cooldown },
    ])
    setSwapCooldown(1)
    pushLog(`部队换人：【${outSlot.card.name}】退场 → 【${inBench.card.name}】替补登场！`)
  }

  const DIALOGUE_LINES = [
    { speaker: "魔人希尔基", title: "深渊魔人", text: "……区区人类的攻击，居然能削弱魔剑的护壁……！" },
    { speaker: "Mrekk", title: "讨伐队长", text: "趁它护盾破碎，把大招全砸上去！顺便刷满 OVER KILL！" },
  ]

  return (
    <BattleArenaView
      phase={phase}
      turnOwner={turnOwner}
      turnBanner={turnBanner}
      round={round}
      ap={ap}
      combo={combo}
      overkillPct={overkillPct}
      boss={boss}
      partyName="魔人讨伐队"
      partyHp={partyHp}
      partyMaxHp={partyMaxHp}
      partyBuffs={partyBuffs}
      slots={slots}
      bench={bench}
      supports={supports}
      swapCooldown={swapCooldown}
      skillMetaMap={SKILL_META}
      activeCutin={activeCutin}
      supportCutin={supportCutin}
      guardBanner={guardBanner}
      damagePopup={damagePopup}
      bossSlashKey={bossSlashKey}
      enemyLaserTargets={enemyLaserTargets}
      speedHigh={speedHigh}
      logs={logs}
      dialogue={dialogueStep !== null ? DIALOGUE_LINES[dialogueStep] : null}
      victory={victory}
      onStartBattle={resetAndStart}
      onCastSkill={handleCastSkill}
      onDefend={() => {
        if (phase === "battle" && turnOwner === "player" && ap >= 1) {
          setAp((v) => v - 1)
          pushLog("全队进入【防御架势】（-1 AP），结束回合。")
          runEnemyTurn(true, round, slots)
        }
      }}
      onEndRound={() => {
        if (phase === "prepare") resetAndStart()
        else if (turnOwner === "player") runEnemyTurn(false, round, slots)
      }}
      onFinishOverkill={handleFinishOverkill}
      onSwapCard={handleSwapCard}
      onToggleSpeed={() => setSpeedHigh((v) => !v)}
      onAdvanceDialogue={() =>
        setDialogueStep((s) => (s !== null && s + 1 < DIALOGUE_LINES.length ? s + 1 : null))
      }
      onSkipDialogue={() => setDialogueStep(null)}
      onRestartDemo={() => {
        clearTimers()
        setPhase("prepare")
        setBoss(makeInitialBoss())
        setVictory(null)
        setLogs(["已重置 Demo，点击中央【战斗开始】体验完整流程！"])
      }}
    />
  )
}