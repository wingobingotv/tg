import { useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { LinkScreen } from "./auth/LinkScreen"
import { RecaptchaProvider } from "./auth/recaptcha"
import { useTelegramAuth } from "./auth/useTelegramAuth"
import { Logo, Spinner } from "./components/ui"
import { isTab, NavProvider, routeFromStartParam, type Navigator, type Route, type TabName } from "./navigation"
import { HomeScreen } from "./screens/HomeScreen"
import { ProfileScreen } from "./screens/ProfileScreen"
import { StatusScreen } from "./screens/StatusScreen"
import { WinnerDetailScreen } from "./screens/WinnerDetailScreen"
import { WinnersScreen } from "./screens/WinnersScreen"
import { WingoGameScreen } from "./screens/WingoGameScreen"
import { getWebApp } from "./telegram"

/** LiveKit is only downloaded when a player opens a show. */
const LiveScreen = lazy(() => import("./screens/LiveScreen").then((m) => ({ default: m.LiveScreen })))

const TABS: { name: TabName; label: string }[] = [
  { name: "home", label: "Home" },
  { name: "winners", label: "Winners" },
  { name: "profile", label: "Profile" },
]

function useBackButton(visible: boolean, onBack: () => void) {
  useEffect(() => {
    const button = getWebApp()?.BackButton
    if (!button) return
    if (!visible) {
      button.hide()
      return
    }
    button.onClick(onBack)
    button.show()
    return () => {
      button.offClick(onBack)
      button.hide()
    }
  }, [visible, onBack])
}

/** Refresh balances and games when the player comes back to the Mini App. */
function useRefreshOnReturn() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const app = getWebApp()
    if (!app) return
    const refresh = () => void queryClient.invalidateQueries()
    app.onEvent("activated", refresh)
    return () => app.offEvent("activated", refresh)
  }, [queryClient])
}

const MAX_STACK = 8

function Screen({ route, onSessionEnd }: { route: Route; onSessionEnd: Parameters<typeof ProfileScreen>[0]["onSessionEnd"] }) {
  switch (route.name) {
    case "profile":
      return <ProfileScreen onSessionEnd={onSessionEnd} />
    case "winners":
      return <WinnersScreen />
    case "winner":
      return <WinnerDetailScreen key={route.gameId} gameId={route.gameId} />
    case "wingo":
      return <WingoGameScreen key={route.gameId} gameId={route.gameId} />
    case "live":
      return (
        <Suspense fallback={<Spinner />}>
          <LiveScreen key={route.gameId} gameId={route.gameId} />
        </Suspense>
      )
    default:
      return <HomeScreen />
  }
}

function Shell({
  onSessionEnd,
  startRoute,
}: {
  onSessionEnd: Parameters<typeof ProfileScreen>[0]["onSessionEnd"]
  startRoute: Route | null
}) {
  const { t } = useTranslation()
  const [{ tab, stack }, setHistory] = useState<{ tab: TabName; stack: Route[] }>(() =>
    startRoute && isTab(startRoute)
      ? { tab: startRoute.name, stack: [] }
      : { tab: "home", stack: startRoute ? [startRoute] : [] },
  )
  const route: Route = stack[stack.length - 1] ?? { name: tab }

  const back = useCallback(() => {
    setHistory((h) => (h.stack.length > 0 ? { ...h, stack: h.stack.slice(0, -1) } : { tab: "home", stack: [] }))
  }, [])
  const pickTab = useCallback((next: TabName) => setHistory({ tab: next, stack: [] }), [])
  const nav = useMemo<Navigator>(
    () => ({
      open: (next) => {
        if (isTab(next)) {
          pickTab(next.name)
        } else {
          setHistory((h) => ({ ...h, stack: [...h.stack.filter((r) => !sameRoute(r, next)), next].slice(-MAX_STACK) }))
        }
        window.scrollTo(0, 0)
      },
      back,
    }),
    [back, pickTab],
  )
  useBackButton(stack.length > 0 || tab !== "home", back)
  useRefreshOnReturn()

  return (
    <NavProvider value={nav}>
      <div className="shell">
        <header className="topbar">
          <Logo size={32} />
          <span className="brand">WingoBingo</span>
        </header>
        <main className="content">
          <Screen route={route} onSessionEnd={onSessionEnd} />
        </main>
        <nav className="tabbar" aria-label={t("Main menu")}>
          {TABS.map(({ name, label }) => (
            <button
              key={name}
              type="button"
              className={`tab${route.name === name ? " tab-active" : ""}`}
              aria-current={route.name === name ? "page" : undefined}
              onClick={() => pickTab(name)}
            >
              {t(label)}
            </button>
          ))}
        </nav>
      </div>
    </NavProvider>
  )
}

function sameRoute(a: Route, b: Route): boolean {
  return a.name === b.name && ("gameId" in a ? a.gameId : "") === ("gameId" in b ? b.gameId : "")
}

export function App() {
  const { state, retry, completeLink, endSession } = useTelegramAuth()

  if (state.kind === "ready") {
    const startRoute = routeFromStartParam(state.startParam ?? getWebApp()?.initDataUnsafe?.start_param)
    return <Shell onSessionEnd={endSession} startRoute={startRoute} />
  }
  if (state.kind === "link_required") {
    return (
      <RecaptchaProvider>
        <LinkScreen state={state} onLinked={completeLink} />
      </RecaptchaProvider>
    )
  }
  return <StatusScreen state={state} onRetry={retry} />
}
