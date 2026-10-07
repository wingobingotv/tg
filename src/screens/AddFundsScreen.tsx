import { useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { OtherPaymentMethods, StarsResultNotice, STARS_OPTIONS_KEY, useStarsOptions } from "../components/payments"
import { Alert, Button, Spinner } from "../components/ui"
import { useWallet } from "../data"
import { formatCount, formatMoney } from "../format"
import { currentLanguage } from "../i18n"
import { payWithStars, type StarsResult } from "../payments/stars"
import { haptic } from "../telegram"

/** Wallet top-up: Telegram Stars in the app, everything else on the website. */
export function AddFundsScreen() {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const queryClient = useQueryClient()
  const wallet = useWallet(true)
  const options = useStarsOptions()
  const [picked, setPicked] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<StarsResult | null>(null)
  const inFlight = useRef(false)

  const deposit = options.data?.deposit
  const amounts = deposit?.enabled ? deposit.amounts : []
  const choice = amounts.find((a) => a.usd === picked) ?? null

  const pay = async () => {
    if (!choice || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setResult(null)
    try {
      const outcome = await payWithStars({ purpose: "deposit", amountUsd: choice.usd }, lang)
      setResult(outcome)
      if (outcome.kind === "settled" && outcome.outcome === "credited") {
        haptic("success")
        setPicked(null)
      } else if (outcome.kind === "refused") {
        haptic("error")
        void queryClient.invalidateQueries({ queryKey: STARS_OPTIONS_KEY })
      }
      void queryClient.invalidateQueries({ queryKey: ["wallet"] })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <h1 className="section-title">{t("Add funds")}</h1>
      {wallet.data ? (
        <p className="muted">
          {t("Wallet")}: <strong dir="ltr">{formatMoney(wallet.data.balance, wallet.data.currency, lang)}</strong>
        </p>
      ) : null}

      {options.isPending ? <Spinner /> : null}

      {amounts.length > 0 ? (
        <section className="card" aria-labelledby="stars-title">
          <h2 id="stars-title" className="card-title">
            {t("Pay with Telegram Stars")}
          </h2>
          <p className="muted small">{t("Pick an amount. It's added to your wallet as soon as Telegram confirms the payment.")}</p>
          <div className="stars-amounts" role="radiogroup" aria-label={t("Amount")}>
            {amounts.map((a) => (
              <button
                key={a.usd}
                type="button"
                role="radio"
                aria-checked={picked === a.usd}
                className={`stars-amount${picked === a.usd ? " stars-amount-on" : ""}`}
                onClick={() => {
                  setPicked(a.usd)
                  setResult(null)
                }}
              >
                <strong dir="ltr">{formatMoney(a.usd, "USD", lang)}</strong>
                <span className="stars-price">{t("⭐ {{stars}} Stars", { stars: formatCount(a.stars, lang) })}</span>
              </button>
            ))}
          </div>
          {result ? <StarsResultNotice result={result} /> : null}
          <Button busy={busy} disabled={!choice} onClick={() => void pay()}>
            {choice ? t("Pay {{stars}} Stars", { stars: formatCount(choice.stars, lang) }) : t("Choose an amount")}
          </Button>
        </section>
      ) : !options.isPending ? (
        <Alert tone="info">{t("Paying with Telegram Stars isn't available right now.")}</Alert>
      ) : null}

      <OtherPaymentMethods intent="deposit" />
    </div>
  )
}
