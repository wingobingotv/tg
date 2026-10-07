import { useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { LinkScreen } from "./auth/LinkScreen"
import { RecaptchaProvider } from "./auth/recaptcha"
import { useTelegramAuth } from "./auth/useTelegramAuth"
import { Logo, Spinner } from "./components/ui"
import { useWallet } from "./data"
import { useDesign } from "./design"
import { formatMoney } from "./format"
import { currentLanguage } from "./i18n"
import { isTab, NavProvider, routeFromStartParam, sameRoute, type Navigator, type Route, type TabName } from "./navigation"
import { AddFundsScreen } from "./screens/AddFundsScreen"
import { DepositScreen } from "./screens/DepositScreen"
import { HomeScreen } from "./screens/HomeScreen"
import { PaymentScreen } from "./screens/PaymentScreen"
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

/** Design B tab icons (24×24 line icons, stroked in currentColor). */
const TAB_ICONS: Record<TabName, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  winners: <path d="M8 4h8v4a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 12v4M9 20h6M10 16h4v4h-4z" />,
  profile: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0" />,
}

function TabIcon({ name }: { name: TabName }) {
  return (
    <svg className="tab-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      {TAB_ICONS[name]}
    </svg>
  )
}

/** Design B: the balance is always in sight, one tap from Add funds. */
function TopbarWallet({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation()
  const wallet = useWallet(true)
  const lang = currentLanguage()
  return (
    <button type="button" className="topbar-wallet" onClick={onOpen} aria-label={t("Add funds")}>
      <span className="topbar-balance" dir="ltr">
        {wallet.data ? formatMoney(wallet.data.balance, wallet.data.currency, lang) : "…"}
      </span>
      <span className="topbar-plus" aria-hidden="true">
        +
      </span>
    </button>
  )
}

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
    case "add-funds":
      return <AddFundsScreen />
    case "deposit":
      return <DepositScreen key={route.method} method={route.method} />
    case "payment":
      return <PaymentScreen key={route.paymentId} paymentId={route.paymentId} />
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
  const design = useDesign()
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
      replace: (next) => {
        setHistory((h) => {
          const below = h.stack.slice(0, -1).filter((r) => !sameRoute(r, next))
          return { ...h, stack: [...below, next].slice(-MAX_STACK) }
        })
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
          {design === "b" ? <TopbarWallet onOpen={() => nav.open({ name: "add-funds" })} /> : null}
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
              {design === "b" ? <TabIcon name={name} /> : null}
              {t(label)}
            </button>
          ))}
        </nav>
      </div>
    </NavProvider>
  )
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
