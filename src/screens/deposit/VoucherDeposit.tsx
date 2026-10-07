import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { DepositErrorNotice, DepositOutcome } from "../../components/deposit"
import { Button, Field } from "../../components/ui"
import { formatMoney } from "../../format"
import { currentLanguage } from "../../i18n"
import { useNav } from "../../navigation"
import {
  activateVoucher,
  depositErrorKey,
  fetchVoucherStatus,
  normalizeVoucher,
  type VoucherResult,
} from "../../payments/deposit"
import { haptic, openExternal } from "../../telegram"

const VOUCHER_SHOP = "https://paywm.net"
const VOUCHER_POLL_MS = 10_000

/** Utopia (UUSD) voucher: the code is activated on the server and credited once Utopia confirms it. */
export function VoucherDeposit() {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const nav = useNav()
  const queryClient = useQueryClient()
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [started, setStarted] = useState<VoucherResult | null>(null)
  const inFlight = useRef(false)

  const status = useQuery({
    queryKey: ["deposit", "voucher", started?.paymentId ?? ""],
    enabled: started?.phase === "waiting",
    queryFn: () => fetchVoucherStatus(started?.paymentId ?? ""),
    refetchInterval: (q) => (q.state.data && q.state.data.phase !== "waiting" ? false : VOUCHER_POLL_MS),
  })
  const result = status.data && status.data.phase !== "waiting" ? status.data : started
  const phase = result?.phase

  useEffect(() => {
    if (phase === "paid") {
      haptic("success")
      void queryClient.invalidateQueries({ queryKey: ["wallet"] })
    } else if (phase === "failed") {
      haptic("error")
    }
  }, [phase, queryClient])

  const activate = async () => {
    if (inFlight.current) return
    const value = normalizeVoucher(code)
    setErrorKey(null)
    setMissing(!value)
    if (!value) return
    inFlight.current = true
    setBusy(true)
    try {
      setStarted(await activateVoucher(value))
      setCode("")
    } catch (err) {
      setErrorKey(depositErrorKey(err, "voucher"))
      haptic("error")
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  if (result) {
    const amount = result.valueUsd != null ? formatMoney(result.valueUsd, "USD", lang) : null
    return (
      <DepositOutcome
        phase={result.phase}
        paymentId={result.paymentId}
        title={
          result.phase === "paid"
            ? t("Voucher activated")
            : result.phase === "failed"
              ? t("Voucher rejected")
              : t("Confirming your voucher")
        }
        message={
          result.phase === "paid"
            ? amount
              ? t("Payment received. {{amount}} was added to your wallet.", { amount })
              : t("Payment received. Your wallet is updated.")
            : result.phase === "failed"
              ? t("Utopia rejected this voucher, so nothing was added. Check the code, or contact Utopia support if you think this is a mistake.")
              : t("Utopia is confirming your voucher. Your wallet updates as soon as it's confirmed — you can leave this screen.")
        }
        onCheck={result.phase === "waiting" ? () => void status.refetch() : undefined}
        checking={status.isFetching}
        retryLabel={t("Use another voucher")}
        onRetry={() => setStarted(null)}
        onDone={() => nav.open({ name: "home" })}
      />
    )
  }

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void activate()
      }}
    >
      <section className="card">
        <Field
          label={t("Voucher Code")}
          value={code}
          dir="ltr"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="USD-XXXX-XXXX-XXXX-XXXX-XXXX"
          aria-invalid={missing || undefined}
          onChange={(e) => {
            setCode(e.target.value)
            setMissing(false)
          }}
          hint={missing ? <span className="field-error">{t("Voucher code required")}</span> : undefined}
        />
        <p className="muted small">{t("Voucher code must be in the following format:")}</p>
        <p className="voucher-format" dir="ltr">
          USD-XXXX-XXXX-XXXX-XXXX-XXXX
        </p>
      </section>

      <section className="card" aria-labelledby="voucher-buy-title">
        <h3 id="voucher-buy-title" className="card-title">
          {t("Don't have a voucher?")}
        </h3>
        <p className="muted small">
          {t("This voucher type is UUSD. To purchase this voucher, please visit the following website:")}
        </p>
        <Button type="button" variant="link" onClick={() => openExternal(VOUCHER_SHOP)}>
          <span dir="ltr">paywm.net</span>
        </Button>
        <p className="muted small">{t("Then, search for UUSD in the tokens section.")}</p>
      </section>

      {errorKey ? <DepositErrorNotice errorKey={errorKey} /> : null}

      <Button type="submit" busy={busy}>
        {t("Activate voucher")}
      </Button>
    </form>
  )
}
