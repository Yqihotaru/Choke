import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { JOB_LABEL } from "@/card/data"
import { RARITY_COLOR } from "@/desk/lib/rarity"
import type { ExpeditionView } from "@choke/shared/expedition/view"

import { moveExpedition, submitEvent, submitStory } from "./api"
import { errorText } from "./common"
import { KIND_LABEL, kindOf, layoutMap, titleOf } from "./layout"
import { MapStage } from "./MapStage"
import { EventPanel, StoryPanel } from "./Panels"

export interface RunMenu {
  busy: boolean
  /** 菜单操作（结算、放弃、保存退出）失败时的提示 */
  error: string | null
  onSuspend: () => void
  onSettle: () => void
  onAbandon: () => void
}

/** 出征中的地图页：舞台在上（电脑在左），选择面板在下（电脑在右），队伍条在最底下 */
export function RunView({
  userId,
  view,
  onView,
  menu,
  onEnterBattle,
}: {
  userId: string
  view: ExpeditionView
  onView: (view: ExpeditionView) => void
  menu: RunMenu
  /** 站在没打完的战斗格上时，「进入战斗」按钮做什么；不传就是还没接上 */
  onEnterBattle?: () => void
}) {
  const layout = useMemo(() => layoutMap(view.map), [view.map])
  const here = layout.nodes[view.position]
  const [sel, setSel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prevPosition, setPrevPosition] = useState(view.position)
  const [toast, setToast] = useState<string | null>(null)
  const [mini, setMini] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const toastTimer = useRef<number>(0)

  if (prevPosition !== view.position) {
    setPrevPosition(view.position)
    setSel(null)
    setError(null)
  }
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const say = (text: string) => {
    setToast(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1800)
  }

  const act = async (job: () => Promise<ExpeditionView>, after?: (next: ExpeditionView) => void) => {
    setBusy(true)
    setError(null)
    try {
      const next = await job()
      onView(next)
      after?.(next)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const choices = view.nodeDone ? view.availableNext.filter((id) => layout.nodes[id]) : []
  const branching = choices.length > 1
  const target = branching ? sel : (choices[0] ?? null)

  const go = () => {
    if (!target) return
    const before = view.difficulty.tier
    void act(
      () => moveExpedition(userId, target),
      (next) => {
        const node = next.map.nodes[next.position]
        if (next.difficulty.tier > before) say(`威胁升到 ${next.difficulty.tier} 档`)
        else if (node) say(`抵达：${titleOf(node)}`)
      },
    )
  }

  const diff = view.difficulty
  const node = here?.node
  const step = here ? Math.round(here.col) + 1 : 1
  const steps = Math.round(layout.maxCol) + 1
  const pct = Math.round(view.hpRatio * 100)
  const hpClass = pct < 45 ? "low" : pct < 70 ? "mid" : ""

  const card = (id: string, on: boolean) => {
    const n = layout.nodes[id]!.node
    const kind = kindOf(n)
    const tone = (n.threat ?? 0) > 0 ? "red" : kind === "rest" ? "green" : "plain"
    const tag = tone === "red" ? "危险路线" : tone === "green" ? "安全路线" : "前方"
    return (
      <button
        key={id}
        type="button"
        className={`ex-card ex-card--${tone}`}
        data-on={on}
        disabled={!branching}
        onClick={() => setSel(id)}
      >
        <span className="ex-card__mark" />
        <span className="ex-card__head">
          <span className="ex-card__tag">{tag}</span>
          <span className="ex-card__title">{titleOf(n)}</span>
        </span>
        <span className="ex-card__hint">
          {KIND_LABEL[kind]}
          {n.hint ? ` · ${n.hint}` : ""}
        </span>
      </button>
    )
  }

  let panel: ReactNode
  if (view.story) {
    panel = <StoryPanel key={view.story.nodeId} story={view.story} busy={busy} onDone={(c) => void act(() => submitStory(userId, c))} />
  } else if (view.event) {
    panel = <EventPanel key={view.event.nodeId} event={view.event} busy={busy} onPick={(c) => void act(() => submitEvent(userId, c))} />
  } else if (!view.nodeDone && view.battle) {
    panel = (
      <>
        <div className="ex-ph">
          <b>{node ? titleOf(node) : "战斗"}</b>
          <span>{view.battle.status === "lost" ? "战败，可重试" : "等待开战"}</span>
        </div>
        {node?.hint && <p className="ex-event__text">{node.hint}</p>}
        <button type="button" className="ex-go" disabled={!onEnterBattle || busy} onClick={onEnterBattle}>
          {onEnterBattle ? (view.battle.lineup.length > 0 ? "继续战斗" : "进入战斗") : "战斗界面接入中"}
        </button>
      </>
    )
  } else if (view.atEnd) {
    panel = (
      <>
        <div className="ex-ph">
          <b>已抵达终点</b>
          <span>可以结算了</span>
        </div>
        <div className="ex-card ex-card--plain" data-static>
          <span className="ex-card__title">{node ? titleOf(node) : "终点"}</span>
          <span className="ex-card__hint">走到这里就通关了，结算会发放全部已攒的奖励。</span>
        </div>
        <button type="button" className="ex-go" disabled={menu.busy} onClick={menu.onSettle}>
          通关结算
        </button>
      </>
    )
  } else if (choices.length === 0) {
    panel = (
      <>
        <div className="ex-ph">
          <b>前路不通</b>
        </div>
        <div className="ex-note">这里往前的路需要先拿到某个标记，现在没有能走的下一步。可以到此结算，或者保存退出。</div>
      </>
    )
  } else {
    const prompt = node?.type === "branch" && node.prompt ? node.prompt : null
    const next = target ? layout.nodes[target]!.node : null
    const add = next?.threat ?? 0
    panel = (
      <>
        <div className="ex-ph">
          <b>{branching ? "分叉决策选择" : "前方一步"}</b>
          <span>{branching ? `${choices.length} 条可用路径` : "下一站"}</span>
        </div>
        {prompt && <p className="ex-event__text">{prompt}</p>}
        {choices.map((id) => card(id, branching && sel === id))}
        <button type="button" className="ex-go" disabled={busy || !target} onClick={go}>
          {branching ? (sel ? "确认路线" : "请先选一条路线") : "前往下一站"}
          {add > 0 && <small>威胁 +{add}</small>}
          {add < 0 && <small>威胁 {add}</small>}
        </button>
      </>
    )
  }

  return (
    <div className="ex-run">
      <div className="ex-run__app">
        <header className="ex-run__top">
          <div className="ex-run__title">
            <b>{view.map.name}</b>
            <span>
              第 {step} / {steps} 步 · ★ {view.stars}/{view.maxStars}
            </span>
          </div>
          <span className="ex-chip ex-chip--thr" title="威胁值越高，敌人越硬、掉落越多">
            威胁 <i>{diff.tier} 档</i>
            <small>{diff.nextTierAt === null ? "最高" : `${diff.threat}/${diff.nextTierAt}`}</small>
          </span>
          <div className="ex-run__tools">
            <button type="button" className="ex-tbtn ex-tbtn--mini" data-on={mini} onClick={() => setMini((v) => !v)}>
              路线
            </button>
            <div className="ex-menu">
              <button type="button" className="ex-tbtn" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
                菜单 ▾
              </button>
              {menuOpen && (
                <div className="ex-menu__list" role="menu">
                  <button type="button" role="menuitem" disabled={menu.busy} onClick={menu.onSuspend}>
                    保存并退出
                  </button>
                  <button type="button" role="menuitem" disabled={menu.busy} onClick={menu.onSettle}>
                    {view.atEnd ? "通关结算" : "到此结算"}
                  </button>
                  <button type="button" role="menuitem" className="is-danger" disabled={menu.busy} onClick={menu.onAbandon}>
                    放弃
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="ex-run__body">
          <div className="ex-run__stagewrap">
            <MapStage layout={layout} position={view.position} pickable={choices} selected={sel} onSelect={setSel} showMini={mini} />
            <div className={`ex-toast${toast ? " is-show" : ""}`} role="status">
              {toast}
            </div>
          </div>
          <div className="ex-run__panel">
            {panel}
            {(error ?? menu.error) && <div className="ex-note ex-note--error">{error ?? menu.error}</div>}
          </div>
          <div className="ex-run__squad">
            <div className="ex-squad__head">
              <span>出征队伍（{view.pool.length}）</span>
              <span>队伍血量 {pct}%</span>
            </div>
            <div className="ex-squad__slots" style={{ "--n": Math.min(8, view.pool.length) } as React.CSSProperties}>
              {view.pool.map(({ userCardId, face }) => (
                <div className="ex-slot" key={userCardId} title={`${face.name} · Lv${face.level} · ${JOB_LABEL[face.job] ?? face.job}`}>
                  <div className="ex-slot__av" style={{ background: RARITY_COLOR[face.rarity] }}>
                    {[...face.name][0]}
                  </div>
                  <div className="ex-slot__name">{face.name}</div>
                  <div className="ex-slot__rar">{face.rarity}</div>
                  <div className="ex-slot__hp">
                    <i className={hpClass} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
