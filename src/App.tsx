import { lazy, Suspense } from "react"

import { BackToDesk } from "@/components/BackToDesk"
import { BattlePage } from "@/battle/BattlePage"
import { DeskPage } from "@/desk/DeskPage"

const CardEditor = lazy(() =>
  import("@/card/CardEditor").then((m) => ({ default: m.CardEditor }))
)
const CardLab = lazy(() =>
  import("@/card/CardLab").then((m) => ({ default: m.CardLab }))
)
const PoolLab = lazy(() =>
  import("@/pool/PoolLab").then((m) => ({ default: m.PoolLab }))
)

const FALLBACK = (
  <div
    style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "#18171c",
      color: "#edeae5",
      fontFamily: "Outfit, sans-serif",
    }}
  >
    加载中…
  </div>
)

export function App() {
  const path = window.location.pathname.replace(/\/+$/, "")
  if (path.endsWith("battle")) {
    return (
      <>
        <BattlePage />
        <BackToDesk />
      </>
    )
  }
  if (path.endsWith("intro")) {
    // 旧的引导页已经换成桌上的邀请函
    window.history.replaceState(null, "", "/")
    return <DeskPage />
  }
  if (path.endsWith("gacha")) {
    window.history.replaceState(null, "", "/?panel=packs")
    return <DeskPage />
  }
  if (path.endsWith("card-editor")) {
    return (
      <>
        <Suspense fallback={FALLBACK}>
          <CardEditor />
        </Suspense>
        <BackToDesk />
      </>
    )
  }
  if (path.endsWith("pool-lab")) {
    return (
      <>
        <Suspense fallback={FALLBACK}>
          <PoolLab />
        </Suspense>
        <BackToDesk />
      </>
    )
  }
  if (path.endsWith("card-lab")) {
    return (
      <>
        <Suspense fallback={FALLBACK}>
          <CardLab />
        </Suspense>
        <BackToDesk />
      </>
    )
  }
  return <DeskPage />
}

export default App
