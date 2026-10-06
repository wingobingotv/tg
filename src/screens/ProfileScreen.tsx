import { useState } from "react"
import { useTranslation } from "react-i18next"
import { post, type ResultMessage } from "../api"
import type { ReopenReason } from "../auth/authFlow"
import { Alert, Button, Spinner } from "../components/ui"
import { config, LANGUAGES, type Language } from "../config"
import { useProfile, useTelegramStatus } from "../data"
import { changeLanguage, currentLanguage } from "../i18n"
import { confirmAction, openExternal } from "../telegram"

const LANGUAGE_NAMES: Record<Language, string> = { en: "English", ar: "العربية", fa: "فارسی", fr: "Français" }

export function ProfileScreen({ onSessionEnd }: { onSessionEnd: (reason: ReopenReason) => void }) {
  const { t } = useTranslation()
  const profile = useProfile()
  const status = useTelegramStatus()
  const [busy, setBusy] = useState<"unlink" | "signout" | null>(null)
  const [error, setError] = useState("")
  const lang = currentLanguage()

  const unlink = async () => {
    if (!(await confirmAction(t("Disconnect Telegram from your WingoBingo account?")))) return
    setBusy("unlink")
    setError("")
    try {
      const res = await post<ResultMessage>("/auth/telegram/unlink")
      if (res.success === true) onSessionEnd("unlinked")
      else setError(t("Something went wrong. Please try again."))
    } catch {
      setError(t("Something went wrong. Please try again."))
    } finally {
      setBusy(null)
    }
  }

  const signOut = async () => {
    setBusy("signout")
    try {
      await post<ResultMessage>("/user/logout")
    } catch {
      // The local session is dropped either way.
    }
    setBusy(null)
    onSessionEnd("signed_out")
  }

  return (
    <div className="stack">
      <section className="card" aria-labelledby="account-title">
        <h2 id="account-title" className="card-title">
          {t("Account")}
        </h2>
        {profile.isPending ? <Spinner /> : null}
        {profile.isError ? <Alert tone="error">{t("Could not load your account.")}</Alert> : null}
        {profile.data ? (
          <dl className="details">
            <dt>{t("Name")}</dt>
            <dd>{profile.data.name || "—"}</dd>
            <dt>{t("Email")}</dt>
            <dd dir="ltr">{profile.data.email || "—"}</dd>
            <dt>{t("Username")}</dt>
            <dd dir="ltr">{profile.data.username || "—"}</dd>
          </dl>
        ) : null}
        <Button variant="secondary" onClick={() => openExternal(`${config?.siteUrl ?? ""}/${lang}`)}>
          {t("Open the full website")}
        </Button>
      </section>

      <section className="card" aria-labelledby="telegram-title">
        <h2 id="telegram-title" className="card-title">
          {t("Telegram")}
        </h2>
        {status.isPending ? <Spinner /> : null}
        {status.data?.identity ? (
          <p className="muted">
            {t("Connected as {{name}}", {
              name: status.data.identity.username ? `@${status.data.identity.username}` : status.data.identity.firstName || "",
            })}
          </p>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button variant="danger" busy={busy === "unlink"} disabled={busy !== null} onClick={() => void unlink()}>
          {t("Disconnect Telegram")}
        </Button>
      </section>

      <section className="card" aria-labelledby="language-title">
        <h2 id="language-title" className="card-title">
          {t("Language")}
        </h2>
        <div className="languages" role="radiogroup" aria-labelledby="language-title">
          {LANGUAGES.map((code) => (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={code === lang}
              className={`chip${code === lang ? " chip-active" : ""}`}
              lang={code}
              onClick={() => changeLanguage(code)}
            >
              {LANGUAGE_NAMES[code]}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <p className="muted small">
          {t("Next time you open the app from the bot you are signed in again. To stop that, disconnect Telegram.")}
        </p>
        <Button variant="secondary" busy={busy === "signout"} disabled={busy !== null} onClick={() => void signOut()}>
          {t("Sign out")}
        </Button>
      </section>
    </div>
  )
}
