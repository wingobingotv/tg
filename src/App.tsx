import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { LinkScreen } from "./auth/LinkScreen"
import { useTelegramAuth } from "./auth/useTelegramAuth"
import { Logo } from "./components/ui"
import { HomeScreen } from "./screens/HomeScreen"
import { ProfileScreen } from "./screens/ProfileScreen"
import { StatusScreen } from "./screens/StatusScreen"
import { getWebApp } from "./telegram"

type Tab = "home" | "profile"

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

function Shell({ onSessionEnd }: { onSessionEnd: Parameters<typeof ProfileScreen>[0]["onSessionEnd"] }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>("home")
  const goHome = useCallback(() => setTab("home"), [])
  useBackButton(tab !== "home", goHome)
  useRefreshOnReturn()

  return (
    <div className="shell">
      <header className="topbar">
        <Logo size={32} />
        <span className="brand">WingoBingo</span>
      </header>
      <main className="content">{tab === "home" ? <HomeScreen /> : <ProfileScreen onSessionEnd={onSessionEnd} />}</main>
      <nav className="tabbar" aria-label={t("Main menu")}>
        <button type="button" className={`tab${tab === "home" ? " tab-active" : ""}`} aria-current={tab === "home" ? "page" : undefined} onClick={() => setTab("home")}>
          {t("Home")}
        </button>
        <button
          type="button"
          className={`tab${tab === "profile" ? " tab-active" : ""}`}
          aria-current={tab === "profile" ? "page" : undefined}
          onClick={() => setTab("profile")}
        >
          {t("Profile")}
        </button>
      </nav>
    </div>
  )
}

export function App() {
  const { state, retry, completeLink, endSession } = useTelegramAuth()

  if (state.kind === "ready") return <Shell onSessionEnd={endSession} />
  if (state.kind === "link_required") return <LinkScreen state={state} onLinked={completeLink} />
  return <StatusScreen state={state} onRetry={retry} />
}
