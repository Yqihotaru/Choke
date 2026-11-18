import { useState, type CSSProperties } from "react"

import { ElementGlyph, JobGlyph } from "../card/CardFace"
import { GameCardFace } from "../card/GameCardFace"
import { ELEMENT_COLOR, ELEMENT_LABEL, JOB_LABEL } from "../card/data"
import type { Element } from "../card/types"
import type { BattleArenaProps, BossIntent } from "./battle.types"
import "./rance-battle.css"

export function BattleArenaView({
  phase,
  turnOwner,
  turnBanner,
  round,
  ap,
  maxAp = 10,
  combo,
  overkillPct,
  boss,
  partyName,
  partyHp,
  partyMaxHp,
  partyBuffs,
  slots,
  bench,
  supports,
  swapCooldown,
  skillMetaMap = {},
  activeCutin,
  supportCutin,
  guardBanner,
  damagePopup,
  bossSlashKey,
  enemyLaserTargets,
  speedHigh,
  logs,
  dialogue,
  victory,
  onStartBattle,
  onCastSkill,
  onDefend,
  onEndRound,
  onFinishOverkill,
  onSwapCard,
  onToggleSpeed,
  onAdvanceDialogue,
  onSkipDialogue,
  onRestartDemo,
}: BattleArenaProps) {
  const [previewAp, setPreviewAp] = useState(0)
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null)
  const [hoveredSkill, setHoveredSkill] = useState<{
    slotIndex: number
    name: string
    element: Element
    ap: number
  } | null>(null)
  const [hoveredIntent, setHoveredIntent] = useState<BossIntent | null>(null)
  const [logOpen, setLogOpen] = useState(false)

  // 战中换人抽屉状态
  const [swapOpen, setSwapOpen] = useState(false)
  const [swapOutIdx, setSwapOutIdx] = useState<number>(0)

  // 战后 3 个宝箱翻开状态
  const [openedChests, setOpenedChests] = useState<Record<number, boolean>>({})

  const bossPct = Math.max(0, Math.min(100, (boss.hp / boss.maxHp) * 100))
  const partyPct = Math.max(0, Math.min(100, (partyHp / partyMaxHp) * 100))
  const isOverkill = phase === "battle" && boss.hp <= 0

  return (
    <div className="r10-viewport">
      <div className="r10-stage" data-phase={phase}>
        {/* ================= 1. 上半区：BOSS 战区 ================= */}
        <section className="r10-boss-zone">
          <div
            className="r10-boss-backdrop"
            key={bossSlashKey}
            data-slashed={bossSlashKey > 0 ? "true" : undefined}
            data-dead={isOverkill ? "true" : undefined}
          />

          {/* 斩击闪光 */}
          {bossSlashKey > 0 && <div className="r10-slash-fx" key={`slash-${bossSlashKey}`} aria-hidden />}

          {/* 敌方攻击红色激光靶线（精确指向被攻击的卡槽） */}
          {enemyLaserTargets.length > 0 && (
            <svg className="r10-laser-svg" viewBox="0 0 100 56.25" preserveAspectRatio="none" aria-hidden>
              {enemyLaserTargets.map((slotIdx) => {
                const targetX = 11.4 + (slotIdx + 0.5) * (77.2 / Math.max(1, slots.length))
                return (
                  <g key={slotIdx}>
                    <line x1="50" y1="16" x2={targetX} y2="39.5" className="r10-laser-glow" />
                    <line x1="50" y1="16" x2={targetX} y2="39.5" className="r10-laser-core" />
                  </g>
                )
              })}
            </svg>
          )}

          {/* 右上角快捷按钮 */}
          <div className="r10-top-tools">
            {onRestartDemo && (
              <button
                type="button"
                className="r10-tool-btn"
                onClick={() => {
                  setSwapOpen(false)
                  setOpenedChests({})
                  onRestartDemo()
                }}
              >
                <b>↻</b>
                <span>重置Demo</span>
              </button>
            )}
          </div>

          {phase === "prepare" ? (
            <>
              <div className="r10-tapes r10-tapes--left" aria-hidden>
                <span className="r10-tape">WARNING &nbsp; WARNING &nbsp; WARNING &nbsp; WARNING &nbsp; WARNING</span>
                <span className="r10-tape r10-tape--sub">WARNING &nbsp; WARNING &nbsp; WARNING &nbsp; WARNING &nbsp; WARNING</span>
              </div>
              <div className="r10-tapes r10-tapes--right" aria-hidden>
                <span className="r10-tape">WARNING &nbsp; WARNING &nbsp; WARNING &nbsp; WARNING &nbsp; WARNING</span>
                <span className="r10-tape r10-tape--sub">WARNING &nbsp; WARNING &nbsp; WARNING &nbsp; WARNING &nbsp; WARNING</span>
              </div>

              <div className="r10-vs-giant" aria-hidden>
                VS
              </div>
              <div className="r10-prep-title">{boss.name}</div>
              <div className="r10-prep-badge">准备战斗</div>

              <div className="r10-outcome-box">
                <div className="r10-outcome-head">战斗结果决定路线分支</div>
                <div className="r10-outcome-row">
                  <span>胜利</span>
                  <b>前进</b>
                </div>
                <div className="r10-outcome-row">
                  <span>败北</span>
                  <b>GAMEOVER</b>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* 左侧 BOSS 特性锁定条 + 结界层数 */}
              <div className="r10-traits">
                {boss.barrierHits > 0 && (
                  <div className="r10-trait r10-trait--barrier">
                    <span className="r10-trait-icon" style={{ "--el": "#ffd859" } as CSSProperties}>
                      <ElementGlyph element="light" />
                    </span>
                    <span className="r10-trait-name">无敌结界 ×{boss.barrierHits}</span>
                    <span className="r10-trait-lock">🔒</span>
                  </div>
                )}
                {boss.traits.map((t) => (
                  <div className="r10-trait" key={t.name}>
                    <span className="r10-trait-icon" style={{ "--el": ELEMENT_COLOR[t.element] } as CSSProperties}>
                      <ElementGlyph element={t.element} />
                    </span>
                    <span className="r10-trait-name">{t.name}</span>
                    {t.locked && <span className="r10-trait-lock">🔒</span>}
                  </div>
                ))}
                {boss.awakenStack > 0 && (
                  <div className="r10-trait r10-trait--stack">
                    <span className="r10-trait-icon" style={{ "--el": "#ff5b3b" } as CSSProperties}>
                      <ElementGlyph element="fire" />
                    </span>
                    <span className="r10-trait-name">
                      知性觉醒 ({boss.awakenStack}/{boss.maxAwaken})
                    </span>
                  </div>
                )}
              </div>

              {/* 右侧 3 格支援槽（对应视频 0:11 蓝条上方的支援使徒条） */}
              {supports.length > 0 && (
                <div className="r10-supports">
                  {supports.map((sup) => (
                    <div
                      key={sup.id}
                      className="r10-support-card"
                      data-active={sup.triggered ? "true" : undefined}
                      style={{ "--el": ELEMENT_COLOR[sup.element] } as CSSProperties}
                    >
                      <span className="r10-support-icon">
                        <JobGlyph job={sup.job} />
                      </span>
                      <div className="r10-support-info">
                        <b>{sup.name}</b>
                        <small>{sup.roleText}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* OVER KILL 橙色六边形爆表指示器（BOSS 归零后继续连击触发） */}
              {isOverkill && (
                <div className="r10-overkill-box">
                  <div className="r10-overkill-hex">
                    <i>OVER KILL</i>
                    <b>{overkillPct}%</b>
                  </div>
                  <button type="button" className="r10-overkill-claim" onClick={onFinishOverkill}>
                    结算战果 ▶
                  </button>
                </div>
              )}

              {/* 支援攻击 / 技能施放 / 援护横幅 */}
              {supportCutin && (
                <div className="r10-skill-banner r10-skill-banner--support">
                  <span className="r10-banner-tag">SUPPORT</span>
                  <b>{supportCutin.name}</b>
                  <span>{supportCutin.actionText}</span>
                </div>
              )}

              {activeCutin && (
                <div className="r10-skill-banner" key={activeCutin.skillName + combo}>
                  <span className="r10-banner-tag">{activeCutin.jobLabel}</span>
                  <b>{activeCutin.cardName}</b>
                  <span>的「{activeCutin.skillName}」！</span>
                </div>
              )}

              {guardBanner && <div className="r10-guard-banner">{guardBanner}</div>}

              {/* 中央伤害跳字 + COMBO 计数 */}
              {damagePopup && (
                <div className="r10-damage-stage" key={damagePopup.id}>
                  <div
                    className="r10-dmg-num"
                    data-weak={damagePopup.isWeak ? "true" : undefined}
                    data-blocked={damagePopup.blocked ? "true" : undefined}
                  >
                    {damagePopup.value.toLocaleString("en-US")}
                  </div>
                  {damagePopup.blocked && <div className="r10-weak-hit">BARRIER!</div>}
                  {!damagePopup.blocked && damagePopup.isWeak && <div className="r10-weak-hit">WEAK!</div>}
                </div>
              )}

              {combo > 0 && (
                <div className="r10-combo-counter" key={`combo-${combo}`}>
                  <b>{combo}</b>
                  <span>COMBO!</span>
                </div>
              )}

              {/* PLAYER TURN / ENEMY TURN 切换大字 */}
              {turnBanner && (
                <div className="r10-turn-sweep" data-owner={turnOwner}>
                  {turnBanner}
                </div>
              )}
            </>
          )}
        </section>

        {/* ================= 2. 中轴区：剪影 + 双血条 + 行动预告 + Round + AP ================= */}
        <section className="r10-hud-band">
          <div className="r10-hud-meta">
            <div className="r10-side-info r10-side-info--boss">
              <div className="r10-army-silhouette r10-army-silhouette--boss" aria-hidden />
              <div className="r10-side-name">{boss.name}</div>
              <div className="r10-hp-num">
                <i>Hp</i>
                <b>{boss.hp.toLocaleString("en-US")}</b>
              </div>
            </div>

            <div className="r10-center-meta">
              <div className="r10-weakness">
                <span>弱点属性 ▶▶</span>
                <div className="r10-weakness-icons">
                  {boss.weaknesses.map((w) => (
                    <span
                      key={w}
                      className="r10-weak-el"
                      title={ELEMENT_LABEL[w]}
                      style={{ "--el": ELEMENT_COLOR[w] } as CSSProperties}
                    >
                      <ElementGlyph element={w} />
                    </span>
                  ))}
                </div>
              </div>

              {phase === "battle" && (
                <div className="r10-intents">
                  {boss.intents.map((intent, idx) => (
                    <div
                      key={`${intent.id}-${idx}`}
                      className="r10-intent-box"
                      style={{ "--el": ELEMENT_COLOR[intent.element] } as CSSProperties}
                      onMouseEnter={() => setHoveredIntent(intent)}
                      onMouseLeave={() => setHoveredIntent(null)}
                    >
                      <ElementGlyph element={intent.element} />
                      <i>{idx + 1}</i>
                    </div>
                  ))}
                  {hoveredIntent && (
                    <div className="r10-tooltip r10-tooltip--intent">
                      <div className="r10-tooltip-title">{hoveredIntent.name}</div>
                      <div className="r10-tooltip-sub">{hoveredIntent.kind}</div>
                      <div className="r10-tooltip-desc">{hoveredIntent.desc}</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="r10-side-info r10-side-info--party">
              <div className="r10-army-silhouette r10-army-silhouette--party" aria-hidden />
              <div className="r10-side-name">{partyName}</div>
              <div className="r10-hp-num">
                <i>Hp</i>
                <b>{partyHp.toLocaleString("en-US")}</b>
              </div>
            </div>
          </div>

          <div className="r10-gauges">
            <div className="r10-gauge r10-gauge--boss">
              <div className="r10-gauge-track">
                <div className="r10-gauge-fill" style={{ width: `${bossPct}%` }} />
              </div>
            </div>

            <button
              type="button"
              className="r10-center-orb"
              onClick={phase === "prepare" ? onStartBattle : undefined}
            >
              {phase === "prepare" ? (
                <span className="r10-orb-start">战斗开始</span>
              ) : (
                <>
                  <i className="r10-orb-round">Round</i>
                  <b className="r10-orb-num">{round}</b>
                  <span className="r10-orb-vs">VS</span>
                </>
              )}
            </button>

            <div className="r10-gauge r10-gauge--party">
              <div className="r10-gauge-track">
                <div className="r10-gauge-fill" style={{ width: `${partyPct}%` }} />
              </div>
            </div>
          </div>

          <div className="r10-sub-hud">
            <div className="r10-status-strip r10-status-strip--boss">
              {boss.awakenStack > 0 && (
                <span className="r10-buff-pill r10-buff-pill--bad">魔人觉醒 ×{boss.awakenStack}</span>
              )}
            </div>

            <div className="r10-ap-bar">
              <span className="r10-ap-label">Ap</span>
              <div className="r10-ap-gems">
                {Array.from({ length: maxAp }, (_, idx) => {
                  const n = idx + 1
                  const active = n <= ap
                  const previewConsume = active && previewAp > 0 && n > ap - previewAp
                  return (
                    <span
                      key={n}
                      className="r10-ap-gem"
                      data-active={active ? "true" : undefined}
                      data-preview={previewConsume ? "true" : undefined}
                    >
                      {n}
                    </span>
                  )
                })}
              </div>
            </div>

            <div className="r10-status-strip r10-status-strip--party">
              {partyBuffs.map((b) => (
                <span className="r10-buff-pill" key={b}>
                  {b}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ================= 3. 下半区：7 卡指令台 ================= */}
        <section className="r10-deck">
          <aside className="r10-wing r10-wing--left">
            <button
              type="button"
              className="r10-btn-panel"
              disabled={phase !== "battle" || turnOwner !== "player" || swapCooldown > 0 || bench.length === 0}
              onClick={() => setSwapOpen((v) => !v)}
            >
              <span>{swapOpen ? "关闭换人" : "更换人员"}</span>
              <small>{swapCooldown > 0 ? `${swapCooldown} Round后` : `备战 ${bench.length} 张`}</small>
            </button>
            <div className="r10-wing-toggles">
              <button type="button" className="r10-btn-mini" onClick={onToggleSpeed}>
                <span>速度:{speedHigh ? "高速" : "常速"}</span>
              </button>
              <button type="button" className="r10-btn-mini" onClick={() => setLogOpen((v) => !v)}>
                <span>战报</span>
              </button>
            </div>
            <button type="button" className="r10-btn-menu" onClick={() => setLogOpen((v) => !v)}>
              MENU
            </button>
          </aside>

          <div className="r10-party-grid">
            {slots.map((slot, index) => {
              const { card, cooldown, boost, hitDamage, guarding } = slot
              const isHovered = hoveredSlot === index
              const onCd = cooldown > 0
              const activeSkills = card.skills.filter((s) => !s.passive)
              const tooltipMeta =
                hoveredSkill && hoveredSkill.slotIndex === index ? skillMetaMap[hoveredSkill.name] : null

              return (
                <div
                  key={card.id}
                  className="r10-card-slot"
                  data-boost={boost && !onCd ? "true" : undefined}
                  data-cd={onCd ? "true" : undefined}
                  data-guarding={guarding ? "true" : undefined}
                  data-hovered={isHovered ? "true" : undefined}
                  data-swap-target={swapOpen && swapOutIdx === index ? "true" : undefined}
                  onClick={() => swapOpen && setSwapOutIdx(index)}
                  onMouseEnter={() => setHoveredSlot(index)}
                  onMouseLeave={() => {
                    setHoveredSlot(null)
                    setHoveredSkill(null)
                    setPreviewAp(0)
                  }}
                >
                  {/* 悬浮技能详情 Tooltip */}
                  {!swapOpen && phase === "battle" && hoveredSkill && hoveredSkill.slotIndex === index && (
                    <div className="r10-tooltip r10-tooltip--skill">
                      <div className="r10-tooltip-title">{hoveredSkill.name}</div>
                      <div className="r10-tooltip-sub">
                        {tooltipMeta ? `${tooltipMeta.range} · ${tooltipMeta.mult}倍 · 冷却 ${tooltipMeta.cd} 回合` : `消耗 ${hoveredSkill.ap} AP`}
                      </div>
                      {tooltipMeta?.desc && <div className="r10-tooltip-desc">{tooltipMeta.desc}</div>}
                    </div>
                  )}

                  {boost && !onCd && <span className="r10-boost-tag">BOOST</span>}
                  {guarding && <span className="r10-guard-chip">援护防御!</span>}
                  {hitDamage != null && <span className="r10-card-hit">-{hitDamage}</span>}

                  <div className="r10-card-frame">
                    <GameCardFace card={card} eager />

                    {onCd && (
                      <div className="r10-cd-seal">
                        <span>冷却</span>
                        <b>{cooldown}</b>
                      </div>
                    )}

                    {!swapOpen &&
                      phase === "battle" &&
                      turnOwner === "player" &&
                      !onCd &&
                      isHovered &&
                      activeSkills.length > 0 && (
                        <div className="r10-card-overlay-skills">
                          {activeSkills.map((sk) => {
                            const affordable = ap >= sk.ap
                            return (
                              <button
                                key={sk.name}
                                type="button"
                                className="r10-overlay-skill-btn"
                                disabled={!affordable}
                                onMouseEnter={() => {
                                  setHoveredSkill({ slotIndex: index, name: sk.name, element: sk.element, ap: sk.ap })
                                  if (affordable) setPreviewAp(sk.ap)
                                }}
                                onMouseLeave={() => {
                                  setHoveredSkill(null)
                                  setPreviewAp(0)
                                }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onCastSkill(index, sk.name, sk.element, sk.ap)
                                }}
                              >
                                <i>{sk.ap}</i>
                                <span>{sk.name}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                  </div>
                </div>
              )
            })}
          </div>

          <aside className="r10-wing r10-wing--right">
            <button
              type="button"
              className="r10-btn-defend"
              disabled={phase !== "battle" || turnOwner !== "player" || ap < 1 || isOverkill}
              onMouseEnter={() => phase === "battle" && ap >= 1 && setPreviewAp(1)}
              onMouseLeave={() => setPreviewAp(0)}
              onClick={onDefend}
            >
              <b>防御</b>
              <span>1 Ap</span>
            </button>
            <button
              type="button"
              className="r10-btn-end"
              disabled={phase === "battle" && turnOwner !== "player"}
              onClick={isOverkill ? onFinishOverkill : onEndRound}
            >
              {phase === "prepare" ? "部队编制" : isOverkill ? "结束讨伐" : "结束该轮"}
            </button>
          </aside>
        </section>

        {/* ================= 4. 战中换人抽屉（对应视频 0:32–0:52） ================= */}
        {swapOpen && phase === "battle" && (
          <div className="r10-swap-drawer">
            <div className="r10-swap-head">
              <div>
                <b>部队换人</b>
                <span>
                  当前选中替换位置：#{swapOutIdx + 1} 【{slots[swapOutIdx]?.card.name}】 → 请在下方选择备战卡牌
                </span>
              </div>
              <button type="button" className="r10-swap-close" onClick={() => setSwapOpen(false)}>
                返回战斗 ✕
              </button>
            </div>
            <div className="r10-swap-grid">
              {bench.map((b) => (
                <button
                  key={b.card.id}
                  type="button"
                  className="r10-bench-item"
                  disabled={b.cooldown > 0}
                  onClick={() => {
                    onSwapCard(swapOutIdx, b.card.id)
                    setSwapOpen(false)
                  }}
                >
                  <div className="r10-bench-card">
                    <GameCardFace card={b.card} />
                    {b.cooldown > 0 && (
                      <div className="r10-cd-seal">
                        <span>冷却</span>
                        <b>{b.cooldown}</b>
                      </div>
                    )}
                  </div>
                  <span className="r10-bench-meta">
                    {JOB_LABEL[b.card.job]} · LV{b.card.level}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ================= 5. 最底栏与 LOG 抽屉 ================= */}
        <footer className="r10-footer">
          <span className="r10-ticker">{logs[0] ?? ""}</span>
          <button type="button" className="r10-log-toggle" onClick={() => setLogOpen((v) => !v)}>
            {logOpen ? "▼ LOG ▼" : "▲ LOG ▲"}
          </button>
        </footer>

        {logOpen && (
          <div className="r10-log-drawer">
            {logs.map((line, i) => (
              <div key={i} className="r10-log-line">
                {line}
              </div>
            ))}
          </div>
        )}

        {/* ================= 6. 战中剧情插播对话层 ================= */}
        {dialogue && (
          <div className="r10-dialogue-layer" onClick={onAdvanceDialogue}>
            <div className="r10-dialogue-box">
              <div className="r10-dialogue-head">
                <small>{dialogue.title}</small>
                <b>{dialogue.speaker}</b>
              </div>
              <p className="r10-dialogue-text">{dialogue.text}</p>
              <span className="r10-dialogue-next">点击继续 ▶</span>
            </div>
            <button
              type="button"
              className="r10-dialogue-skip"
              onClick={(e) => {
                e.stopPropagation()
                onSkipDialogue()
              }}
            >
              SKIP ⏭
            </button>
          </div>
        )}

        {/* ================= 7. 战后结算与开宝箱（对应视频 2:39–2:46） ================= */}
        {phase === "victory" && victory && (
          <div className="r10-victory-layer">
            <div className="r10-victory-title">WIN</div>

            <div className="r10-victory-grid">
              <div className="r10-victory-panel">
                <div className="r10-v-row r10-v-row--big">
                  <span>宝箱掉落概率</span>
                  <b>{victory.chestRatePct}%</b>
                </div>
                <div className="r10-v-sub">包含 OVER KILL +{overkillPct}% 额外加成</div>

                <div className="r10-chests-row">
                  {victory.rewards.map((item, idx) => {
                    const opened = Boolean(openedChests[idx])
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="r10-chest-slot"
                        data-opened={opened ? "true" : undefined}
                        onClick={() => setOpenedChests((prev) => ({ ...prev, [idx]: true }))}
                      >
                        {!opened ? (
                          <div className="r10-chest-closed">
                            <b>🎁</b>
                            <span>点击开启</span>
                          </div>
                        ) : (
                          <div className="r10-chest-reward">
                            {item.isNew && <i className="r10-new-pill">NEW!</i>}
                            <b>{item.title}</b>
                            <small>{item.subtitle}</small>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="r10-victory-panel">
                <div className="r10-v-row">
                  <span>基本 EXP</span>
                  <b>{victory.baseExp}</b>
                </div>
                {victory.bonusRates.map((r) => (
                  <div className="r10-v-row" key={r.label}>
                    <span>{r.label}</span>
                    <b>+{r.pct}%</b>
                  </div>
                ))}
                <div className="r10-v-row r10-v-row--big r10-v-row--exp">
                  <span>最终获得 EXP</span>
                  <b>{victory.finalExp.toLocaleString("en-US")}</b>
                </div>

                {onRestartDemo && (
                  <button
                    type="button"
                    className="r10-v-continue"
                    onClick={() => {
                      setOpenedChests({})
                      onRestartDemo()
                    }}
                  >
                    返回路线选择 / 再打一局 ▶
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}