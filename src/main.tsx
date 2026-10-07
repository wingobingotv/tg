import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { ApiError } from "./api"
import { config } from "./config"
import { initDesign } from "./design"
import { initI18n } from "./i18n"
import { getWebApp, initWebApp, telegramLanguageHint } from "./telegram"
import { trackDebug } from "./telemetry"
import "./fonts.css"
import "./styles.css"
import "./styles-b.css"

const app = getWebApp()
if (app) initWebApp(app)
initI18n(telegramLanguageHint(app), config?.defaultLang ?? "en")
initDesign()

window.addEventListener("error", (e) => {
  trackDebug("ui.error", "error", String(e.message || "window error"), { source: String(e.filename || "") })
})
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason instanceof Error ? e.reason.message : "unhandled rejection"
  trackDebug("ui.error", "error", reason)
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A 401 already ends the session; retrying it only repeats the error.
      retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    },
  },
})

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}
