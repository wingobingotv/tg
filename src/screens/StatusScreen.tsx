import { useTranslation } from "react-i18next"
import { REOPEN_COPY, type AuthState } from "../auth/authFlow"
import { Button, Logo, Spinner } from "../components/ui"
import { config } from "../config"
import { getWebApp, openExternal } from "../telegram"

type StatusKind = Exclude<AuthState["kind"], "ready" | "link_required">

export function StatusScreen({ state, onRetry }: { state: AuthState & { kind: StatusKind }; onRetry: () => void }) {
  const { t } = useTranslation()

  if (state.kind === "booting") {
    return (
      <main className="status-screen" aria-busy="true">
        <Logo size={56} />
        <Spinner />
        <p className="muted">{t("Signing you in…")}</p>
      </main>
    )
  }

  const close = () => getWebApp()?.close()

  return (
    <main className="status-screen">
      <Logo size={56} />
      {state.kind === "outside_telegram" ? (
        <>
          <h1>{t("Open WingoBingo in Telegram")}</h1>
          <p className="muted">{t("This page works only inside the Telegram app.")}</p>
          {config?.botUsername ? (
            <Button onClick={() => openExternal(`https://t.me/${config?.botUsername}`)}>{t("Open in Telegram")}</Button>
          ) : null}
          {config ? (
            <Button variant="secondary" onClick={() => openExternal(config?.siteUrl ?? "")}>
              {t("Go to the website")}
            </Button>
          ) : null}
        </>
      ) : null}

      {state.kind === "unavailable" ? (
        <>
          <h1>{t("Temporarily unavailable")}</h1>
          <p className="muted">{t("Telegram sign-in is not available right now. Please try again later.")}</p>
          <Button onClick={onRetry}>{t("Try again")}</Button>
        </>
      ) : null}

      {state.kind === "network_error" ? (
        <>
          <h1>{t("No connection")}</h1>
          <p className="muted">{t("Connection problem. Check your internet and try again.")}</p>
          <Button onClick={onRetry}>{t("Try again")}</Button>
        </>
      ) : null}

      {state.kind === "reopen_required" ? (
        <>
          <h1>{t("Please reopen the app")}</h1>
          <p className="muted">{t(REOPEN_COPY[state.reason])}</p>
          <Button onClick={close}>{t("Close")}</Button>
        </>
      ) : null}

      {state.kind === "banned" ? (
        <>
          <h1>{t("Account suspended")}</h1>
          <p className="muted">{t("This account is suspended. Contact support for help.")}</p>
          <Button variant="secondary" onClick={close}>
            {t("Close")}
          </Button>
        </>
      ) : null}
    </main>
  )
}
