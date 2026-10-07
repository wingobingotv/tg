import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { CopyValue, DepositErrorNotice, DepositOutcome, formatClock, useNow } from "../components/deposit"
import { Alert, Button, Spinner } from "../components/ui"
import { formatMoney } from "../format"
import { currentLanguage } from "../i18n"
import { useNav } from "../navigation"
import { depositErrorKey, fetchDepositStatus, type DepositMethod, type DepositPhase, type DepositStatus } from "../payments/deposit"
import { haptic, openExternal } from "../telegram"
import { trackDebug } from "../telemetry"

/** Card and crypto payments are confirmed by the gateway on its own schedule; the app asks the server. */
const PAYMENT_POLL_MS = 15_000

const RETRY_METHOD: Record<DepositStatus["type"], DepositMethod | null> = {
  mastercard: "card",
  crypto: "crypto",
  utopia: "voucher",
  other: null,
}

function CryptoInstructions({ status, onCheck, checking }: { status: DepositStatus; onCheck: () => void; checking: boolean }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const nav = useNav()
  const c = status.crypto
  const now = useNow(c?.expiresAt != null)
  if (!c) return null
  const left = c.expiresAt != null ? c.expiresAt - now : null
  const expired = left != null && left <= 0

  return (
    <section className="card crypto-pay" aria-labelledby="crypto-pay-title">
      <div className="crypto-head">
        <h2 id="crypto-pay-title" className="card-title">
          {t("Waiting for your transfer")}
        </h2>
        {left != null ? (
          <span className={`status-chip${expired ? " status-done" : " status-open"}`}>
            {expired ? (
              t("Expired")
            ) : (
              <>
                {t("Time remaining")} <span dir="ltr">{formatClock(left)}</span>
              </>
            )}
          </span>
        ) : null}
      </div>

      {c.address ? (
        <>
          <div className="crypto-qr">
            {c.qr ? (
              <img src={c.qr} width={200} height={200} alt={t("QR code for the wallet address")} />
            ) : (
              <span className="muted small">{t("QR unavailable")}</span>
            )}
          </div>
          <p className="muted small crypto-scan">{t("Scan with your wallet app")}</p>

          {c.payAmount != null ? (
            <CopyValue label={t("Send exactly")} value={String(c.payAmount)} display={`${c.payAmount} ${c.token}`} />
          ) : null}
          {status.amount != null ? (
            <p className="muted small">
              {t("Approx. value")}: <span dir="ltr">{formatMoney(status.amount, status.currency, lang)}</span>
            </p>
          ) : null}
          <CopyValue label={t("Wallet address")} value={c.address} />
          <div className="chip-row" aria-hidden="true">
            <span className="chip chip-static" dir="ltr">
              {c.token}
            </span>
            <span className="chip chip-static" dir="ltr">
              {c.network}
            </span>
          </div>
          <Alert tone="error">
            {t("Send only {{token}} on the {{network}} network. Assets sent on the wrong network cannot be recovered.", {
              token: c.token,
              network: c.network,
            })}
          </Alert>
        </>
      ) : (
        <p className="muted">{t("Preparing your payment address…")}</p>
      )}

      {expired ? (
        <>
          <Alert tone="info">
            {t("This address has expired. If you already sent the money, contact support with the payment number below. Otherwise, start a new payment.")}
          </Alert>
          <Button onClick={() => nav.replace({ name: "deposit", method: "crypto" })}>{t("Start a new payment")}</Button>
        </>
      ) : (
        <p className="muted small">
          {t("We check for your transfer automatically. You can leave this screen — your wallet updates once the network confirms it.")}
        </p>
      )}
      <Button variant="secondary" busy={checking} onClick={onCheck}>
        {t("Check status")}
      </Button>
      <p className="muted small">
        {t("Payment number")}: <span dir="ltr">#{status.id}</span>
      </p>
    </section>
  )
}

/** One deposit's progress: opened after starting a payment, or from the `pay_<id>` link a card page returns to. */
export function PaymentScreen({ paymentId }: { paymentId: string }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const nav = useNav()
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: ["deposit", "payment", paymentId],
    queryFn: () => fetchDepositStatus(paymentId),
    retry: 1,
    refetchInterval: (q) => (q.state.data && q.state.data.phase !== "waiting" ? false : PAYMENT_POLL_MS),
  })
  const s = status.data ?? null
  const phase = s?.phase
  const seen = useRef<DepositPhase | null>(null)

  useEffect(() => {
    if (!phase || seen.current === phase) return
    const first = seen.current === null
    seen.current = phase
    if (phase === "waiting") return
    trackDebug("payment.flow", phase === "paid" ? "info" : "warn", `deposit ${phase}`, { type: s?.type }, paymentId)
    void queryClient.invalidateQueries({ queryKey: ["wallet"] })
    if (!first || phase === "paid") haptic(phase === "paid" ? "success" : "error")
  }, [phase, paymentId, queryClient, s?.type])

  if (status.isPending) return <Spinner />

  if (!s) {
    return (
      <div className="stack">
        <h1 className="section-title">{t("Payment status")}</h1>
        {status.isError && depositErrorKey(status.error, "card") === "network" ? (
          <DepositErrorNotice errorKey="network" />
        ) : (
          <Alert tone="error">{t("We couldn't find this payment. If you just paid, wait a moment and check again.")}</Alert>
        )}
        <div className="btn-row">
          <Button variant="secondary" busy={status.isFetching} onClick={() => void status.refetch()}>
            {t("Check again")}
          </Button>
          <Button onClick={() => nav.replace({ name: "add-funds" })}>{t("Add funds")}</Button>
        </div>
      </div>
    )
  }

  const retryMethod = RETRY_METHOD[s.type]
  const amount = s.amount != null ? formatMoney(s.amount, s.currency, lang) : null
  const check = () => void status.refetch()
  const done = () => nav.open({ name: "home" })
  const again = () => nav.replace(retryMethod ? { name: "deposit", method: retryMethod } : { name: "add-funds" })

  return (
    <div className="stack">
      <h1 className="section-title">{t("Payment status")}</h1>
      {s.phase === "waiting" && s.type === "crypto" ? (
        <CryptoInstructions status={s} onCheck={check} checking={status.isFetching} />
      ) : s.phase === "waiting" && s.type === "mastercard" ? (
        <DepositOutcome
          phase="waiting"
          paymentId={s.id}
          title={t("Finish your payment on the card page")}
          message={t("Your wallet updates as soon as the payment is confirmed. This screen refreshes by itself.")}
          onCheck={check}
          checking={status.isFetching}
          retryLabel={t("Try again")}
          onDone={done}
        >
          {amount ? (
            <p className="outcome-amount" dir="ltr">
              {amount}
            </p>
          ) : null}
          {s.paymentLink ? (
            <Button onClick={() => s.paymentLink && openExternal(s.paymentLink)}>{t("Open the payment page again")}</Button>
          ) : null}
        </DepositOutcome>
      ) : (
        <DepositOutcome
          phase={s.phase}
          paymentId={s.id}
          title={
            s.phase === "paid" ? t("Payment received") : s.phase === "failed" ? t("Payment not completed") : t("Payment pending")
          }
          message={
            s.phase === "paid"
              ? amount
                ? t("Payment received. {{amount}} was added to your wallet.", { amount })
                : t("Payment received. Your wallet is updated.")
              : s.phase === "failed"
                ? t("This payment didn't go through, so nothing was added to your wallet.")
                : t("Your payment is being confirmed. Your wallet updates as soon as it's confirmed.")
          }
          onCheck={check}
          checking={status.isFetching}
          retryLabel={s.phase === "paid" ? t("Add more funds") : t("Try again")}
          onRetry={s.phase === "paid" ? () => nav.replace({ name: "add-funds" }) : again}
          onDone={done}
        />
      )}
    </div>
  )
}
