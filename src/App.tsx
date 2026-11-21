import { lazy, Suspense } from "react"

import { BackToDesk } from "@/components/BackToDesk"
import { DeskPage } from "@/desk/DeskPage"

const BattlePage = lazy(() =>
  import("@/battle/BattlePage").then((m) => ({ default: m.BattlePage }))
)

const CardEditor = lazy(() =>
  import("@/lab/CardEditor").then((m) => ({ default: m.CardEditor }))
)
const CardLab = lazy(() =>
  import("@/lab/CardLab").then((m) => ({ default: m.CardLab }))
)
const PoolLab = lazy(() =>
  import("@/pool/PoolLab").then((m) => ({ default: m.PoolLab }))
)
const LoginPage = lazy(() =>
  import("@/desk/LoginPage").then((m) => ({ default: m.LoginPage }))
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
  if (path.endsWith("login")) {
    return (
      <Suspense fallback={FALLBACK}>
        <LoginPage />
      </Suspense>
    )
  }
  if (path.endsWith("battle")) {
    return (
      <>
        <Suspense fallback={FALLBACK}>
          <BattlePage />
        </Suspense>
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
