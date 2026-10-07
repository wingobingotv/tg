import { useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { DepositErrorNotice } from "../../components/deposit"
import { Button, Field } from "../../components/ui"
import { formatMoney } from "../../format"
import { currentLanguage } from "../../i18n"
import { useNav } from "../../navigation"
import { depositErrorKey, redeemGiftCode, type GiftResult } from "../../payments/deposit"
import { haptic } from "../../telegram"

/** Credit gift codes add bonus funds here; discount codes are explained and sent to the ticket checkout. */
export function GiftCodeDeposit() {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const nav = useNav()
  const queryClient = useQueryClient()
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [result, setResult] = useState<GiftResult | null>(null)
  const inFlight = useRef(false)

  const redeem = async () => {
    if (inFlight.current) return
    const value = code.trim()
    setErrorKey(null)
    setMissing(!value)
    if (!value) return
    inFlight.current = true
    setBusy(true)
    try {
      const out = await redeemGiftCode(value)
      setResult(out)
      setCode("")
      if (out.kind === "credit") {
        haptic("success")
        void queryClient.invalidateQueries({ queryKey: ["wallet"] })
      }
    } catch (err) {
      setErrorKey(depositErrorKey(err, "giftCode"))
      haptic("error")
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  if (result?.kind === "credit") {
    const money = (n: number) => formatMoney(n, result.currency, lang)
    return (
      <section className="card outcome outcome-paid" aria-live="polite">
        <span className="outcome-icon" aria-hidden="true" />
        <h2 className="card-title">{t("Gift Code Redeemed")}</h2>
        <dl className="details">
          <dt>{t("Credited amount")}</dt>
          <dd dir="ltr">{money(result.creditedAmount)}</dd>
          <dt>{t("New bonus balance")}</dt>
          <dd dir="ltr">{money(result.newBonusBalance)}</dd>
          {result.wageringRequired != null && result.wageringRequired > 0 ? (
            <>
              <dt>{t("Bonus still to be used")}</dt>
              <dd dir="ltr">{money(result.wageringRequired)}</dd>
            </>
          ) : null}
        </dl>
        <p className="muted small">
          {t("Use your bonus on Wingo or Bingo tickets. Once this amount has been spent on tickets, any winnings can be withdrawn.")}
        </p>
        <div className="btn-row">
          <Button onClick={() => nav.open({ name: "home" })}>{t("Back to games")}</Button>
          <Button variant="secondary" onClick={() => setResult(null)}>
            {t("Redeem another code")}
          </Button>
        </div>
      </section>
    )
  }

  if (result?.kind === "discount") {
    return (
      <section className="card outcome" aria-live="polite">
        <h2 className="card-title">{t("This code is a discount code, not a bonus credit.")}</h2>
        <p className="muted small">
          {t("Apply it at checkout when you buy Wingo tickets: open a game and tap “Have a discount or gift code?”.")}
        </p>
        <p className="voucher-format" dir="ltr">
          {result.code}
        </p>
        <div className="btn-row">
          <Button onClick={() => nav.open({ name: "home" })}>{t("Back to games")}</Button>
          <Button variant="secondary" onClick={() => setResult(null)}>
            {t("Redeem another code")}
          </Button>
        </div>
      </section>
    )
  }

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void redeem()
      }}
    >
      <section className="card">
        <Field
          label={t("Gift code")}
          value={code}
          dir="ltr"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={missing || undefined}
          onChange={(e) => {
            setCode(e.target.value)
            setMissing(false)
          }}
          hint={missing ? <span className="field-error">{t("Please enter a gift code")}</span> : undefined}
        />
        <p className="muted small">{t("Enter your WingoBingo gift code to add bonus funds to your wallet.")}</p>
      </section>

      {errorKey ? <DepositErrorNotice errorKey={errorKey} /> : null}

      <Button type="submit" busy={busy}>
        {t("Redeem")}
      </Button>
    </form>
  )
}
