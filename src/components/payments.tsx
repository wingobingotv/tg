import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { config } from "../config"
import { formatMoney } from "../format"
import { currentLanguage } from "../i18n"
import { fetchStarsOptions, fetchWebsiteHandoff, STARS_ERROR_COPY, STARS_GENERIC_ERROR, type StarsResult } from "../payments/stars"
import { openExternal } from "../telegram"
import { Alert, Button } from "./ui"

export const STARS_OPTIONS_KEY = ["stars", "options"] as const

/** What the server allows right now. Refetched on every visit: admins change it without a deploy. */
export function useStarsOptions(enabled = true) {
  return useQuery({ queryKey: STARS_OPTIONS_KEY, enabled, staleTime: 15_000, queryFn: fetchStarsOptions })
}

/** Copy for every way a Stars payment can end, as the server reported it. */
export const STARS_RESULT_COPY = {
  credited: "Payment received. {{amount}} was added to your wallet.",
  tickets: "Payment received. Your tickets are confirmed.",
  tickets_in_wallet: "Payment received, but the tickets couldn't be bought. {{amount}} was added to your wallet instead.",
  refunded: "This payment was refunded.",
  closed: "The payment didn't go through. You weren't charged.",
  still_waiting: "Your payment is being confirmed. Your wallet updates as soon as Telegram confirms it.",
  cancelled: "Payment cancelled. You weren't charged.",
} as const

export function StarsResultNotice({ result }: { result: StarsResult }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  if (result.kind === "refused") {
    return <Alert tone="error">{t(STARS_ERROR_COPY[result.errorKey] ?? STARS_GENERIC_ERROR)}</Alert>
  }
  if (result.kind === "cancelled") return <Alert tone="info">{t(STARS_RESULT_COPY.cancelled)}</Alert>
  if (result.kind === "still_waiting") return <Alert tone="info">{t(STARS_RESULT_COPY.still_waiting)}</Alert>
  const amount = formatMoney(result.payment.creditedUsd ?? result.payment.baseUsd ?? 0, "USD", lang)
  const tone = result.outcome === "closed" ? "error" : "info"
  return <Alert tone={tone}>{t(STARS_RESULT_COPY[result.outcome], { amount })}</Alert>
}

/**
 * "Other payment methods": the website's deposit page, signed in through a
 * one-time link. Hidden when the server turns the link off. If the options
 * cannot be loaded, the plain website link is kept as before.
 */
export function OtherPaymentMethods({ intent, gameId }: { intent: "deposit" | "ticket"; gameId?: string }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const options = useStarsOptions()
  const [busy, setBusy] = useState(false)
  const plainUrl = `${config?.siteUrl ?? ""}/${lang}/more/deposit`

  if (options.isPending) return null
  if (options.data && !options.data.externalLinkEnabled) return null

  const open = async () => {
    if (busy) return
    if (!options.data) {
      openExternal(plainUrl)
      return
    }
    setBusy(true)
    const url = await fetchWebsiteHandoff(intent, lang, gameId)
    setBusy(false)
    openExternal(url ?? plainUrl)
  }

  return (
    <section className="stack pay-other" aria-labelledby={`other-methods-${intent}`}>
      <h3 id={`other-methods-${intent}`} className="pay-other-title">
        {t("Other payment methods")}
      </h3>
      <p className="muted small">
        {t("More payment options are on the WingoBingo website. You'll be signed in automatically.")}
      </p>
      <Button variant="secondary" busy={busy} onClick={() => void open()}>
        {t("Other payment methods")}
      </Button>
    </section>
  )
}
