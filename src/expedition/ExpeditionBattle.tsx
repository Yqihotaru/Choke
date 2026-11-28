import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { ELEMENT_LABEL, battlePower } from "@/card/data"
import { GameCardFace } from "@/card/GameCardFace"
import { ClassicStage, ModernStage, readBattleUiMode, saveBattleUiMode, type BattleUiMode } from "@/battle/stages"
import type { BattleHostHooks } from "@/battle/host"
import { ApiError } from "@/desk/session/api"
import { MAX_ACTIONS_PER_UPLOAD, replayBattle, withAction, type BattleAction } from "@choke/shared/battle/actions"
import type { BattleInputCard } from "@choke/shared/battle/engine"
import type { BattleState } from "@choke/shared/battle/types"
import type { ExpeditionView } from "@choke/shared/expedition/view"

import { fetchCurrentExpedition, retryBattle, submitLineup, uploadBattleActions } from "./api"
import { CardExpStrip } from "./CardExpStrip"
import { errorText } from "./common"
import { titleOf } from "./layout"

const elementName = (element: string) => (ELEMENT_LABEL as Record<string, string>)[element] ?? element

/** 这些错误说明本地操作和服务端已经分叉，直接按服务端进度恢复 */
const RESYNC_CODES = new Set(["out_of_sync", "invalid_action", "too_many_actions", "no_battle"])

function inputsOf(view: ExpeditionView, ids: number[]): BattleInputCard[] {
  const byId = new Map(view.pool.map((entry) => [entry.userCardId, entry.face]))
  return ids.flatMap((uid) => {
    const face = byId.get(uid)
    return face ? [{ uid, cardId: face.id, face }] : []
  })
}

/** 用服务端认可的全部操作重放出当前局面：刷新页面、断线重连都靠它恢复 */
function replayFrom(view: ExpeditionView): BattleState {
  const battle = view.battle!
  return replayBattle(
    {
      encounter: battle.encounter,
      cards: inputsOf(view, battle.lineup),
      bench: inputsOf(view, battle.bench),
      seed: battle.seed,
      apMax: battle.apMax,
      hpRatio: battle.hpRatioStart,
    },
    battle.actions,
  ).state
}

/** 战前：从出征卡池里挑本场上阵的卡（顺序就是槽位顺序），其余自动成为替补 */
export function LineupPicker({
  userId,
  view,
  onView,
  onBack,
}: {
  userId: string
  view: ExpeditionView
  onView: (view: ExpeditionView) => void
  onBack: () => void
}) {
  const battle = view.battle!
  const slots = view.allocation.slots
  const rows = useMemo(
    () =>
      view.pool
        .map((entry) => ({ id: entry.userCardId, face: entry.face, power: battlePower(entry.face) }))
        .sort((a, b) => b.power - a.power),
    [view.pool],
  )
  const [picked, setPicked] = useState<number[]>(() => rows.slice(0, slots).map((r) => r.id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const node = view.map.nodes[view.position]
  const enemy = battle.encounter.enemy
  const pct = Math.round(view.hpRatio * 100)
  const left = slots - picked.length

  const toggle = (id: number) =>
    setPicked((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id)
      return current.length >= slots ? current : [...current, id]
    })

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      onView(await submitLineup(userId, picked))
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="ex-btn ex-btn--sm" onClick={onBack} style={{ marginBottom: 10 }}>
        ‹ 回地图
      </button>
      <h1 className="ex-title">{node ? titleOf(node) : "战斗"}</h1>
      <p className="ex-sub">
        从 {view.pool.length} 张卡里选 {slots} 张上场，剩下的在战斗里当替补。
      </p>

      <div className="ex-prep">
        <section>
          <div className="ex-toolbar">
            <button type="button" className="ex-btn ex-btn--sm" onClick={() => setPicked(rows.slice(0, slots).map((r) => r.id))}>
              自动选最强
            </button>
            <button type="button" className="ex-btn ex-btn--sm" disabled={picked.length === 0} onClick={() => setPicked([])}>
              清空
            </button>
            <span className="ex-chip">
              已选 {picked.length} / {slots}
            </span>
          </div>
          <div className="ex-cards">
            {rows.map((row) => {
              const on = picked.includes(row.id)
              return (
                <button
                  key={row.id}
                  type="button"
                  className="ex-tile"
                  aria-pressed={on}
                  aria-label={row.face.name}
                  disabled={!on && picked.length >= slots}
                  onClick={() => toggle(row.id)}
                >
                  <GameCardFace card={row.face} />
                  {on && <span className="ex-tile__order">{picked.indexOf(row.id) + 1}</span>}
                </button>
              )
            })}
          </div>
        </section>

        <aside className="ex-prep__side">
          <div className="ex-box">
            <h4>对手</h4>
            <div className="ex-row">
              <b>{enemy.name}</b>
              <span>{enemy.title}</span>
            </div>
            <div className="ex-row">
              <span>属性</span>
              <b>{elementName(enemy.element)}</b>
            </div>
            <div className="ex-row">
              <span>弱点</span>
              <b>{enemy.weaknesses.map(elementName).join("、") || "无"}</b>
            </div>
            {battle.encounter.summary && <p className="ex-sub" style={{ margin: "6px 0 0" }}>{battle.encounter.summary}</p>}
          </div>
          <div className="ex-box">
            <h4>本场</h4>
            <div className="ex-row">
              <span>队伍血量</span>
              <b>{pct}%</b>
            </div>
            <div className="ex-row">
              <span>威胁</span>
              <b>{view.difficulty.tier} 档</b>
            </div>
            <div className="ex-row">
              <span>AP 上限</span>
              <b>{battle.apMax}</b>
            </div>
            {error && <div className="ex-note ex-note--error">{error}</div>}
            <button type="button" className="ex-btn ex-btn--primary" style={{ justifySelf: "stretch", marginTop: 6 }} disabled={busy || left > 0} onClick={go}>
              {left > 0 ? `还要再选 ${left} 张` : "出战"}
            </button>
          </div>
        </aside>
      </div>
    </>
  )
}

interface FightProps {
  userId: string
  userName: string
  view: ExpeditionView
  onView: (view: ExpeditionView) => void
  /** 回到地图；战斗中途离开也行，进度已经自动存了 */
  onExit: () => void
  onSettle: () => void
  onAbandon: () => void
}

/**
 * 战斗中：本地用同一套引擎跑，每做一步操作就排队上传，服务端复算后以它的为准。
 * 战斗舞台不认识远征，只通过 host 交出「返回地图 / 打赢继续 / 战败三选一」这几个按钮。
 */
export function Fight({ userId, userName, view, onView, onExit, onSettle, onAbandon }: FightProps) {
  const battleView = view.battle!
  const [state, setState] = useState<BattleState>(() => replayFrom(view))
  const stateRef = useRef(state)
  const confirmed = useRef(battleView.actions.length)
  const queue = useRef<BattleAction[]>([])
  const inflight = useRef<Promise<void> | null>(null)
  const onViewRef = useRef(onView)
  useEffect(() => {
    onViewRef.current = onView
  }, [onView])

  const [pending, setPending] = useState(0)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [uiMode, setUiMode] = useState<BattleUiMode>(() => readBattleUiMode())
  const [initialPool] = useState(() => view.pool)
  const [initialCardExp] = useState(() => view.pending.cardExp ?? 0)
  const [initialExpPool] = useState(() => view.pending.expPool ?? 0)

  /** 和服务端对不上时：丢掉本地没确认的操作，按服务端的进度重放 */
  const resyncing = useRef(false)
  const resync = useCallback(async () => {
    resyncing.current = true
    try {
      const fresh = await fetchCurrentExpedition(userId)
      if (!fresh?.battle) throw new Error("服务端已经没有这场战斗了，请返回地图重新进入")
      confirmed.current = fresh.battle.actions.length
      queue.current = []
      const next = replayFrom(fresh)
      stateRef.current = next
      setState(next)
      setPending(0)
      setSyncError(null)
      setActionError("操作和服务端进度对不上，已按服务端的进度恢复")
      onViewRef.current(fresh)
    } finally {
      resyncing.current = false
    }
  }, [userId])

  const pump = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current
    const run = async () => {
      while (queue.current.length > 0) {
        const batch = queue.current.slice(0, MAX_ACTIONS_PER_UPLOAD)
        try {
          const next = await uploadBattleActions(userId, { base: confirmed.current, actions: batch })
          confirmed.current += batch.length
          queue.current.splice(0, batch.length)
          setPending(queue.current.length)
          setSyncError(null)
          onViewRef.current(next)
        } catch (reason) {
          const code = reason instanceof ApiError ? reason.code : undefined
          if (code && RESYNC_CODES.has(code)) {
            await resync().catch((again) => setSyncError(errorText(again)))
          } else {
            setSyncError(errorText(reason))
          }
          return
        }
      }
    }
    const job = run().finally(() => {
      inflight.current = null
    })
    inflight.current = job
    return job
  }, [userId, resync])

  const act = (action: BattleAction) => {
    if (resyncing.current) {
      setActionError("正在同步服务器进度，稍等一下再出招")
      return
    }
    if (syncError) {
      setActionError("有操作还没保存到服务器，先点上方横幅的「重试上传」")
      return
    }
    const { state: next, error } = withAction(stateRef.current, action)
    if (!error) {
      stateRef.current = next
      setState(next)
      queue.current.push(action)
      setPending(queue.current.length)
      void pump()
    }
    setActionError(error)
  }

  const leave = async () => {
    await pump()
    if (queue.current.length > 0 && !window.confirm("有几步操作还没存到服务端，现在离开会丢掉它们。确定离开吗？")) return
    onExit()
  }

  const guard = async (job: () => Promise<void>) => {
    setWorking(true)
    try {
      await job()
    } catch (reason) {
      setSyncError(errorText(reason))
    } finally {
      setWorking(false)
    }
  }

  const serverStatus = battleView.status
  const synced = pending === 0 && !syncError
  const won = state.phase === "won"
  const gainedCardExp = Math.max(0, (view.pending.cardExp ?? 0) - initialCardExp)
  const gainedExpPool = Math.max(0, (view.pending.expPool ?? 0) - initialExpPool)

  const host: BattleHostHooks = {
    exitLabel: "返回地图",
    onExit: () => void leave(),
    canRestart: false,
    syncNote:
      syncError && pending > 0 ? (
        <>
          <b>操作未保存</b>
          <span>
            {syncError}（还有 {pending} 步没传到服务器）
          </span>
          <button type="button" onClick={() => void pump()} data-sfx="none">
            重试上传
          </button>
        </>
      ) : undefined,
    resultNote: won ? (
      serverStatus === "won" && synced ? (
        <div>
          <div>
            本场 ★ {battleView.stars ?? 0}，战果已记录
            {gainedCardExp > 0 ? ` · 卡牌 EXP +${gainedCardExp}` : ""}
            {gainedExpPool > 0 ? ` · 经验池 +${gainedExpPool}` : ""}
          </div>
          {gainedCardExp > 0 && <CardExpStrip cards={initialPool} gainedExp={gainedCardExp} />}
        </div>
      ) : (
        <>{syncError ?? "正在记录战果……"}</>
      )
    ) : (
      <>{syncError ?? (serverStatus === "lost" ? "战败了。同种子重来不会惩罚，队伍血量回到进入本场前。" : "正在记录战果……")}</>
    ),
    resultActions: won ? (
      <>
        {syncError && (
          <button type="button" onClick={() => void pump()} data-sfx="none">
            重试上传
          </button>
        )}
        <button type="button" disabled={serverStatus !== "won" || !synced} onClick={onExit} data-sfx="none">
          继续前进
        </button>
      </>
    ) : (
      <>
        {syncError && (
          <button type="button" onClick={() => void pump()} data-sfx="none">
            重试上传
          </button>
        )}
        <button
          type="button"
          disabled={working || serverStatus !== "lost" || !synced}
          onClick={() => void guard(async () => onView(await retryBattle(userId)))}
          data-sfx="none"
        >
          同种子重试
        </button>
        <button type="button" disabled={working || serverStatus !== "lost" || !synced} onClick={onSettle} data-sfx="none">
          到此结算
        </button>
        <button type="button" disabled={working} onClick={onAbandon} data-sfx="none">
          放弃出征
        </button>
      </>
    ),
  }

  const switchUi = () => {
    const next: BattleUiMode = uiMode === "classic" ? "modern" : "classic"
    saveBattleUiMode(next)
    setUiMode(next)
  }

  const Stage = uiMode === "modern" ? ModernStage : ClassicStage
  const noop = () => undefined

  return (
    <Suspense
      fallback={
        <div className="ex" data-theme="dark">
          <div className="ex-center">加载战斗舞台……</div>
        </div>
      }
    >
      <Stage
        battle={state}
        playerName={userName}
        deck={inputsOf(view, battleView.lineup).map((input) => input.face)}
        encounter={battleView.encounter}
        encounters={[]}
        tutorial={false}
        actionError={actionError}
        onSelectStage={noop}
        onStart={noop}
        onPlay={(card, skill) => act({ type: "skill", card, skill })}
        onDefend={(tier) => act({ type: "defend", tier })}
        onSwap={(slot, benchUid) => act({ type: "swap", slot, benchUid })}
        onEndTurn={() => act({ type: "endTurn" })}
        onRestart={noop}
        onSwitchUi={switchUi}
        host={host}
      />
    </Suspense>
  )
}
