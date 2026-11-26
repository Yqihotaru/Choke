import type { ReactNode } from "react"

/**
 * 战斗舞台被别的流程（比如远征）嵌进去时，由宿主接管的几件事。
 * 舞台本身不知道宿主是谁：不传就是原来的独立战斗页（回桌面、再来一场）。
 */
export interface BattleHostHooks {
  /** 左上角"桌面"按钮的文字和点击行为 */
  exitLabel: string
  onExit: () => void
  /** 顶栏的"重开"按钮；远征里战斗存档在服务端，不能重开。缺省显示 */
  canRestart?: boolean
  /** 结算层里的按钮，整体替换掉"再来一场 / 返回桌面" */
  resultActions?: ReactNode
  /** 结算层标题下面多说一句（比如远征里的星数、缺什么） */
  resultNote?: ReactNode
}
