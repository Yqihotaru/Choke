export interface HpFlash {
  id: number
  side: "enemy" | "party"
  /** 掉血前、掉血后的血量百分比 */
  from: number
  to: number
}

interface Props {
  side: "enemy" | "party"
  pct: number
  flashes: HpFlash[]
}

const TICKS = [25, 50, 75]

/**
 * 直条血条。实条立刻缩到位，浅色残影停一拍再追上去：这一下掉了多少，看残影的长度就知道；
 * 刚掉的那一截另外闪一下白。
 */
export function HpBar({ side, pct, flashes }: Props) {
  return (
    <div className="choke-hpbar" data-side={side} data-low={pct > 0 && pct <= 25 ? "true" : undefined}>
      <i className="choke-hpbar__ghost" style={{ width: `${pct}%` }} />
      <i className="choke-hpbar__fill" style={{ width: `${pct}%` }} />
      {flashes.map(
        (f) =>
          f.side === side && (
            <i
              key={f.id}
              className="choke-hpbar__loss"
              style={{ left: `${f.to}%`, width: `${Math.max(0.6, f.from - f.to)}%` }}
            />
          ),
      )}
      {TICKS.map((p) => (
        <i key={p} className="choke-hpbar__tick" style={{ left: `${p}%` }} />
      ))}
    </div>
  )
}
