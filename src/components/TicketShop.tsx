import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { apiErrorDetail, getDisplayCurrency, post } from "../api"
import { useWallet, wingoGameKey, wingoTicketsKey } from "../data"
import { formatCount, formatMoney } from "../format"
import {
  cartProblem,
  comboKey,
  isComplete,
  luckyRange,
  mainRange,
  PURCHASE_ERROR_COPY,
  purchaseErrorKind,
  quote,
  setLucky,
  toggleMain,
  uniqueRandomDraft,
  type Draft,
  type OwnedTicket,
  type TicketRules,
  type WingoGame,
} from "../games/wingo"
import { currentLanguage } from "../i18n"
import { fetchStarsQuote, payWithStars, type StarsOrder, type StarsResult } from "../payments/stars"
import { haptic } from "../telegram"
import { trackDebug } from "../telemetry"
import { OtherPaymentMethods, StarsResultNotice, useStarsOptions } from "./payments"
import { Alert, Button, Field } from "./ui"

const EMPTY: Draft = { numbers: [], lucky: null }

type Applied = { code: string; discount: number; payable: number; forAmount: number }

type Preview = { valid?: boolean; mode?: string; discount?: unknown; payable?: unknown }

function GiftCode({
  gameId,
  amount,
  applied,
  onApplied,
  onCredited,
}: {
  gameId: string
  amount: number
  applied: Applied | null
  onApplied: (a: Applied | null) => void
  onCredited: () => void
}) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null)

  if (applied) {
    return (
      <div className="gift-applied">
        <span>
          {t("Code applied: {{code}}", { code: applied.code })}
          {applied.discount > 0 ? (
            <>
              {" · "}
              {t("You save {{amount}}", { amount: formatMoney(applied.discount, getDisplayCurrency(), lang) })}
            </>
          ) : null}
        </span>
        <Button variant="link" onClick={() => onApplied(null)}>
          {t("Remove")}
        </Button>
      </div>
    )
  }

  if (!open) {
    return (
      <Button variant="link" onClick={() => setOpen(true)}>
        {t("Have a discount or gift code?")}
      </Button>
    )
  }

  const apply = async () => {
    const trimmed = code.trim()
    if (!trimmed || busy) {
      setMessage({ tone: "error", text: t("Please enter a gift or discount code") })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const res = await post<{ data?: Preview }>("/gift-codes/preview", { code: trimmed, price: amount, game: "lotto", tournamentId: gameId })
      const p = res.data ?? {}
      if (p.mode === "credit") {
        await post("/gift-codes/redeem", { code: trimmed })
        setCode("")
        setOpen(false)
        setMessage(null)
        haptic("success")
        onCredited()
        return
      }
      if (p.valid === true && p.mode === "discount") {
        const discount = typeof p.discount === "number" ? p.discount : 0
        const payable = typeof p.payable === "number" ? p.payable : amount
        onApplied({ code: trimmed, discount, payable, forAmount: amount })
        setCode("")
        setOpen(false)
        haptic("success")
        return
      }
      setMessage({ tone: "error", text: t("This code can't be applied to your order") })
    } catch {
      setMessage({ tone: "error", text: t("This code can't be applied to your order") })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <Field label={t("Gift or discount code")} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" dir="ltr" />
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <Button variant="secondary" busy={busy} onClick={() => void apply()}>
        {t("Apply")}
      </Button>
    </div>
  )
}

function Picker({
  draft,
  index,
  rules,
  onChange,
  onQuickPick,
}: {
  draft: Draft
  index: number
  rules: TicketRules
  onChange: (d: Draft) => void
  onQuickPick: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="picker">
      <div className="picker-head">
        <strong>{t("Ticket {{n}}", { n: index + 1 })}</strong>
        <span className="picker-actions">
          <Button variant="link" onClick={onQuickPick}>
            {t("Quick Pick")}
          </Button>
          <Button variant="link" onClick={() => onChange(EMPTY)}>
            {t("Clear")}
          </Button>
        </span>
      </div>
      <p className="muted small">
        {t("Pick {{n}} numbers ({{min}}–{{max}})", { n: rules.mainCount, min: rules.mainMin, max: rules.mainMax })}{" "}
        <span dir="ltr">
          {draft.numbers.length}/{rules.mainCount}
        </span>
      </p>
      <div className="grid grid-main" dir="ltr" role="group" aria-label={t("Main numbers")}>
        {mainRange(rules).map((n) => {
          const on = draft.numbers.includes(n)
          const full = !on && draft.numbers.length >= rules.mainCount
          return (
            <button
              key={n}
              type="button"
              className={`num${on ? " num-on" : ""}`}
              aria-pressed={on}
              disabled={full}
              onClick={() => onChange(toggleMain(draft, n, rules))}
            >
              {n}
            </button>
          )
        })}
      </div>
      <p className="muted small">{t("Pick 1 lucky number ({{min}}–{{max}})", { min: rules.luckyMin, max: rules.luckyMax })}</p>
      <div className="grid grid-lucky" dir="ltr" role="group" aria-label={t("Lucky number")}>
        {luckyRange(rules).map((n) => {
          const on = draft.lucky === n
          return (
            <button
              key={n}
              type="button"
              className={`num num-lucky${on ? " num-on" : ""}`}
              aria-pressed={on}
              onClick={() => onChange(setLucky(draft, n, rules))}
            >
              {n}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function TicketShop({
  game,
  rules,
  owned,
  onPurchased,
}: {
  game: WingoGame
  rules: TicketRules
  owned: OwnedTicket[]
  onPurchased: () => void
}) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const currency = getDisplayCurrency()
  const queryClient = useQueryClient()
  const wallet = useWallet(true)
  const [drafts, setDrafts] = useState<Draft[]>([EMPTY])
  const [active, setActive] = useState(0)
  const [applied, setApplied] = useState<Applied | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; insufficient: boolean } | null>(null)
  const [notice, setNotice] = useState("")
  const [starsBusy, setStarsBusy] = useState(false)
  const [starsResult, setStarsResult] = useState<StarsResult | null>(null)
  const inFlight = useRef(false)
  const starsOptions = useStarsOptions()

  const capacity = rules.maxTicketsPerPurchase - owned.length
  const count = drafts.length
  const q = quote(count, game.ticketPrice, game.freeTicketsRemaining)
  const discount = applied && applied.forAmount === q.payable ? applied : null
  const payable = discount ? Math.max(discount.payable, 0) : q.payable
  const spendable = wallet.data ? wallet.data.balance + wallet.data.bonusBalance : null
  const problem = cartProblem(drafts, owned, rules)
  const money = (n: number) => formatMoney(n, currency, lang)

  const starsOrder: StarsOrder = {
    purpose: "ticket",
    tournamentId: game.gameId,
    tickets: drafts.map((d) => ({ numbers: d.numbers, chanceNumber: d.lucky })),
  }
  const starsOffered = starsOptions.data?.ticket.enabled === true && capacity > 0 && q.payable > 0
  const starsUsable = starsOffered && !discount && !problem
  const starsQuote = useQuery({
    queryKey: ["stars", "quote", game.gameId, JSON.stringify(starsOrder.tickets), q.payable],
    enabled: starsUsable,
    staleTime: 15_000,
    retry: false,
    queryFn: () => fetchStarsQuote(starsOrder),
  })
  const stars = starsUsable ? (starsQuote.data ?? null) : null

  if (capacity <= 0) return <Alert tone="info">{t("You already have the maximum tickets for this draw")}</Alert>

  const takenExcept = (skip: number) =>
    new Set([
      ...owned.map((o) => comboKey(o.numbers, o.lucky)),
      ...drafts.flatMap((d, i) => (i !== skip && d.lucky != null && isComplete(d, rules) ? [comboKey(d.numbers, d.lucky)] : [])),
    ])

  const resize = (next: number) => {
    const n = Math.min(Math.max(next, 1), capacity)
    setDrafts((ds) => (n > ds.length ? [...ds, ...Array.from({ length: n - ds.length }, () => EMPTY)] : ds.slice(0, n)))
    setActive((a) => Math.min(a, n - 1))
    setError(null)
    setNotice("")
    setStarsResult(null)
  }

  const update = (i: number, d: Draft) => {
    setDrafts((ds) => ds.map((x, j) => (j === i ? d : x)))
    setError(null)
    setNotice("")
    setStarsResult(null)
  }

  const quickPickAll = () => {
    const taken = new Set(owned.map((o) => comboKey(o.numbers, o.lucky)))
    const next = drafts.map((d) => {
      if (isComplete(d, rules) && d.lucky != null && !taken.has(comboKey(d.numbers, d.lucky))) {
        taken.add(comboKey(d.numbers, d.lucky))
        return d
      }
      const pick = uniqueRandomDraft(rules, taken)
      if (pick.lucky != null) taken.add(comboKey(pick.numbers, pick.lucky))
      return pick
    })
    setDrafts(next)
    setError(null)
    setNotice("")
    setStarsResult(null)
  }

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: wingoGameKey(game.gameId) })
    void queryClient.invalidateQueries({ queryKey: wingoTicketsKey(game.gameId) })
    void queryClient.invalidateQueries({ queryKey: ["wallet"] })
  }

  const buy = async () => {
    if (inFlight.current) return
    if (problem) {
      setError({ text: t(problem), insufficient: false })
      haptic("warning")
      return
    }
    if (spendable != null && payable > spendable) {
      setError({ text: t(PURCHASE_ERROR_COPY.insufficient), insufficient: true })
      haptic("warning")
      return
    }
    inFlight.current = true
    setBusy(true)
    setError(null)
    setNotice("")
    setStarsResult(null)
    try {
      await post("/wingo/setTickets", {
        tournamentId: game.gameId,
        tickets: drafts.map((d) => ({ numbers: d.numbers, chanceNumber: d.lucky })),
        ...(discount ? { giftCode: discount.code } : {}),
      })
      haptic("success")
      setDrafts([EMPTY])
      setActive(0)
      setApplied(null)
      onPurchased()
      refresh()
    } catch (err) {
      const detail = apiErrorDetail(err)
      const kind = purchaseErrorKind(detail)
      trackDebug("payment.flow", "warn", "wingo setTickets failed", { gameId: game.gameId, status: detail.status, code: detail.code })
      setError({ text: t(PURCHASE_ERROR_COPY[kind]), insufficient: kind === "insufficient" })
      haptic("error")
      if (kind === "owned" || kind === "free_used" || kind === "closed" || kind === "gone") refresh()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  /** The cart is priced in Stars on the server; the tickets are bought once the payment is credited. */
  const payStars = async () => {
    if (inFlight.current) return
    if (problem) {
      setError({ text: t(problem), insufficient: false })
      haptic("warning")
      return
    }
    inFlight.current = true
    setStarsBusy(true)
    setError(null)
    setNotice("")
    setStarsResult(null)
    try {
      const result = await payWithStars(starsOrder, lang)
      setStarsResult(result)
      if (result.kind === "settled" && result.outcome === "tickets") {
        haptic("success")
        setDrafts([EMPTY])
        setActive(0)
        setApplied(null)
        onPurchased()
      } else if (result.kind === "refused" || (result.kind === "settled" && result.outcome === "tickets_in_wallet")) {
        haptic("error")
      }
      refresh()
    } finally {
      inFlight.current = false
      setStarsBusy(false)
    }
  }

  const activeDraft = drafts[active] ?? EMPTY

  return (
    <section className="card" aria-labelledby="buy-title">
      <h2 id="buy-title" className="card-title">
        {t("Buy tickets")}
      </h2>

      <div className="qty">
        <span className="muted">{t("Tickets")}</span>
        <div className="stepper" dir="ltr">
          <button type="button" className="step" onClick={() => resize(count - 1)} disabled={count <= 1} aria-label={t("Fewer tickets")}>
            −
          </button>
          <span className="step-value">{count}</span>
          <button type="button" className="step" onClick={() => resize(count + 1)} disabled={count >= capacity} aria-label={t("More tickets")}>
            +
          </button>
        </div>
      </div>
      <p className="muted small">{t("You can buy up to {{count}} more tickets for this draw.", { count: capacity })}</p>

      {count > 1 ? (
        <div className="ticket-tabs" role="tablist" dir="ltr">
          {drafts.map((d, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={`chip${i === active ? " chip-active" : ""}${isComplete(d, rules) ? " chip-done" : ""}`}
              onClick={() => setActive(i)}
            >
              {i + 1}
              {isComplete(d, rules) ? " ✓" : ""}
            </button>
          ))}
        </div>
      ) : null}

      <Picker
        draft={activeDraft}
        index={active}
        rules={rules}
        onChange={(d) => update(active, d)}
        onQuickPick={() => update(active, uniqueRandomDraft(rules, takenExcept(active)))}
      />

      <Button variant="secondary" onClick={quickPickAll}>
        {count > 1 ? t("Quick Pick all tickets") : t("Quick Pick")}
      </Button>

      <dl className="details summary">
        <dt>{t("Tickets")}</dt>
        <dd dir="ltr">{count}</dd>
        <dt>{t("Ticket price")}</dt>
        <dd dir="ltr">{money(game.ticketPrice)}</dd>
        {q.freeCount > 0 ? (
          <>
            <dt>{t("Free")}</dt>
            <dd dir="ltr">−{money(q.gross - q.payable)}</dd>
          </>
        ) : null}
        {discount && discount.discount > 0 ? (
          <>
            <dt>{t("Discount")}</dt>
            <dd dir="ltr">−{money(discount.discount)}</dd>
          </>
        ) : null}
        <dt className="summary-total">{t("Total")}</dt>
        <dd className="summary-total" dir="ltr">
          {money(payable)}
        </dd>
        {spendable != null ? (
          <>
            <dt>{t("Available to spend")}</dt>
            <dd dir="ltr">{money(spendable)}</dd>
          </>
        ) : null}
      </dl>

      {q.payable > 0 ? (
        <GiftCode
          gameId={game.gameId}
          amount={q.payable}
          applied={discount}
          onApplied={setApplied}
          onCredited={() => {
            void queryClient.invalidateQueries({ queryKey: ["wallet"] })
            setNotice(t("Gift code redeemed. Your balance is updated."))
          }}
        />
      ) : null}

      {error ? (
        <div className="stack">
          <Alert tone="error">
            {error.insufficient ? <strong>{t("Insufficient balance")}. </strong> : null}
            {error.text}
          </Alert>
        </div>
      ) : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {starsResult ? <StarsResultNotice result={starsResult} /> : null}

      <Button
        variant={starsUsable && error?.insufficient ? "secondary" : "primary"}
        busy={busy}
        disabled={Boolean(problem) || starsBusy}
        onClick={() => void buy()}
      >
        {payable > 0 ? t("Pay {{amount}} with wallet balance", { amount: money(payable) }) : t("Get my tickets for free")}
      </Button>
      {problem && !error ? <p className="muted small">{t(problem)}</p> : null}

      {starsOffered ? (
        <section className="pay-stars" aria-labelledby="pay-stars-title">
          <p id="pay-stars-title" className="pay-stars-title">
            {t("Pay with Telegram Stars")}
          </p>
          {discount ? (
            <p className="muted small">{t("Discount codes apply to wallet payments only.")}</p>
          ) : (
            <>
              {stars ? <p className="stars-price">{t("⭐ {{stars}} Stars", { stars: formatCount(stars, lang) })}</p> : null}
              <Button
                variant={error?.insufficient ? "primary" : "secondary"}
                busy={starsBusy}
                disabled={Boolean(problem) || busy}
                onClick={() => void payStars()}
              >
                {stars ? t("Pay {{stars}} Stars", { stars: formatCount(stars, lang) }) : t("Pay with Telegram Stars")}
              </Button>
            </>
          )}
        </section>
      ) : null}

      {error?.insufficient ? <OtherPaymentMethods intent="ticket" gameId={game.gameId} /> : null}
    </section>
  )
}
