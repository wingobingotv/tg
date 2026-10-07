import { useQuery } from "@tanstack/react-query"
import { useEffect, useId, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { formatMoney } from "../format"
import { currentLanguage } from "../i18n"
import {
  DEPOSIT_ERROR_COPY,
  DEPOSIT_GENERIC_ERROR,
  fetchMiniappMethods,
  fetchUsdRate,
  parseAmount,
  type DepositMethod,
  type DepositPhase,
} from "../payments/deposit"
import { haptic } from "../telegram"
import { Alert, Button } from "./ui"

export const MINIAPP_METHODS_KEY = ["deposit", "methods"] as const

/** Which deposit methods run in the app. Admins switch them without a deploy, so this is refetched often. */
export function useMiniappMethods() {
  return useQuery({ queryKey: MINIAPP_METHODS_KEY, staleTime: 15_000, queryFn: fetchMiniappMethods })
}

/** 1 USD in the display currency, or null when no rate is available. */
export function useUsdRate(currency: string) {
  return useQuery({ queryKey: ["fx", "USD", currency], staleTime: 5 * 60_000, queryFn: () => fetchUsdRate(currency) })
}

export const METHOD_COPY: Record<DepositMethod, { title: string; subtitle: string }> = {
  card: { title: "Visa / Mastercard", subtitle: "Pay by card, or with a local method in your country." },
  crypto: { title: "Crypto", subtitle: "USDT, TRX and other coins. Added once the network confirms it." },
  voucher: { title: "Utopia voucher", subtitle: "Top up with a UUSD voucher code." },
  giftCode: { title: "Gift code", subtitle: "Add bonus funds with a WingoBingo gift code." },
}

const METHOD_ICONS: Record<DepositMethod, ReactNode> = {
  card: <path d="M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm-1 4h20M6 15h4" />,
  crypto: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-2 5h3.5a2 2 0 0 1 0 4H10m0 0h4a2 2 0 0 1 0 4h-4m0-8v8m1-9.5V8m0 8v1.5" />,
  voucher: <path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4zm10 0v2m0 2v2m0 2v2" />,
  giftCode: <path d="M4 11h16v9H4zM3 7h18v4H3zm9 0v13M12 7c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1" />,
}

export function MethodIcon({ method }: { method: DepositMethod }) {
  return (
    <svg className="method-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      {METHOD_ICONS[method]}
    </svg>
  )
}

export function DepositErrorNotice({ errorKey }: { errorKey: string }) {
  const { t } = useTranslation()
  return <Alert tone="error">{t(DEPOSIT_ERROR_COPY[errorKey] ?? DEPOSIT_GENERIC_ERROR)}</Alert>
}

/** Amount in the display currency, with quick picks and the minimum. */
export function AmountField({
  value,
  onChange,
  currency,
  minimum,
  quick,
  hint,
}: {
  value: string
  onChange: (next: string) => void
  currency: string
  minimum: number | null
  quick: number[]
  hint?: ReactNode
}) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const id = useId()
  const amount = parseAmount(value)
  const low = amount != null && minimum != null && amount < minimum
  const money = (n: number) => formatMoney(n, currency, lang)

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {t("Amount ({{currency}})", { currency })}
      </label>
      <input
        id={id}
        className="field-input amount-input"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        dir="ltr"
        value={value}
        placeholder={minimum != null ? String(minimum) : "0"}
        aria-invalid={low || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {quick.length ? (
        <div className="amount-quick" role="group" aria-label={t("Quick amounts")}>
          {quick.map((q) => (
            <button
              key={q}
              type="button"
              className={`chip${amount === q ? " chip-active" : ""}`}
              aria-pressed={amount === q}
              onClick={() => onChange(String(q))}
            >
              <span dir="ltr">{money(q)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {low ? (
        <span className="field-error" role="alert">
          {t("At least {{amount}} is required", { amount: money(minimum) })}
        </span>
      ) : minimum != null ? (
        <span className="field-hint">{t("Minimum: {{amount}}", { amount: money(minimum) })}</span>
      ) : null}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall back below: some Telegram WebViews block the async clipboard.
  }
  try {
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.style.position = "fixed"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand("copy")
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** A value the player must reproduce exactly (address, amount), with a copy button. */
export function CopyValue({ label, value, display }: { label: string; value: string; display?: string }) {
  const { t } = useTranslation()
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")

  useEffect(() => {
    if (state === "idle") return
    const timer = window.setTimeout(() => setState("idle"), 2000)
    return () => window.clearTimeout(timer)
  }, [state])

  const copy = async () => {
    const ok = await copyText(value)
    setState(ok ? "copied" : "failed")
    haptic(ok ? "success" : "error")
  }

  return (
    <div className="copy-value">
      <span className="copy-label">{label}</span>
      <div className="copy-row">
        <code className="copy-text" dir="ltr">
          {display ?? value}
        </code>
        <button type="button" className="copy-btn" onClick={() => void copy()}>
          {state === "copied" ? t("Copied") : state === "failed" ? t("Copy failed") : t("Copy")}
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? t("Copied") : ""}
      </span>
    </div>
  )
}

/** Where a deposit ended up, with the next step. Only the server's status decides the phase. */
export function DepositOutcome({
  phase,
  paymentId,
  title,
  message,
  children,
  onCheck,
  checking = false,
  retryLabel,
  onRetry,
  onDone,
}: {
  phase: DepositPhase
  paymentId: string
  title: string
  message: string
  children?: ReactNode
  onCheck?: () => void
  checking?: boolean
  retryLabel?: string
  onRetry?: () => void
  onDone?: () => void
}) {
  const { t } = useTranslation()
  return (
    <section className={`card outcome outcome-${phase}`} aria-live="polite">
      <span className="outcome-icon" aria-hidden="true" />
      <h2 className="card-title">{title}</h2>
      <p className="muted">{message}</p>
      {children}
      {phase === "failed" ? (
        <p className="muted small">{t("If money left your account, contact support and quote payment number {{id}}.", { id: paymentId })}</p>
      ) : null}
      <div className="btn-row">
        {phase === "waiting" && onCheck ? (
          <Button variant="secondary" busy={checking} onClick={onCheck}>
            {t("Check status")}
          </Button>
        ) : null}
        {phase === "paid" && onDone ? <Button onClick={onDone}>{t("Back to games")}</Button> : null}
        {phase !== "waiting" && onRetry && retryLabel ? (
          <Button variant={phase === "paid" ? "secondary" : "primary"} onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null}
      </div>
    </section>
  )
}

/** Current time, ticking every second while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

/** 1:05:09 / 05:09 — a clock, so always left to right. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, "0")
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
