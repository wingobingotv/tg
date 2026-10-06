import { apiErrorDetail, post } from "../api"
import { openInvoice, type InvoiceStatus } from "../telegram"
import { trackDebug } from "../telemetry"

/**
 * Telegram Stars on the Player API (`/telegram/stars/*`). Prices come from the
 * server and are shown as given; the invoice is priced again on the server,
 * and only the server's payment status says whether money arrived.
 */

export type StarsAmount = { usd: number; stars: number }

export type StarsOptions = {
  starsEnabled: boolean
  externalLinkEnabled: boolean
  deposit: { enabled: boolean; minUsd: number; maxUsd: number; amounts: StarsAmount[] }
  ticket: { enabled: boolean }
}

export type StarPaymentStatus =
  | "created"
  | "invoice_created"
  | "pending"
  | "paid"
  | "credited"
  | "failed"
  | "cancelled"
  | "refunded"

export type StarPayment = {
  id: string
  purpose: "deposit" | "ticket"
  status: StarPaymentStatus
  stars: number
  baseUsd: number | null
  creditedUsd: number | null
  tournamentId: number | null
  fulfillment: "processing" | "done" | "failed" | null
  failureReason: string | null
}

export type StarsOrder =
  | { purpose: "deposit"; amountUsd: number }
  | { purpose: "ticket"; tournamentId: string; tickets: { numbers: number[]; chanceNumber: number | null }[] }

type Envelope<T> = { data?: T }

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback)

export function parseStarsOptions(raw: unknown): StarsOptions {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const deposit = (r.deposit && typeof r.deposit === "object" ? r.deposit : {}) as Record<string, unknown>
  const ticket = (r.ticket && typeof r.ticket === "object" ? r.ticket : {}) as Record<string, unknown>
  const amounts = Array.isArray(deposit.amounts) ? deposit.amounts : []
  return {
    starsEnabled: r.starsEnabled === true,
    externalLinkEnabled: r.externalLinkEnabled === true,
    deposit: {
      enabled: deposit.enabled === true,
      minUsd: num(deposit.minUsd),
      maxUsd: num(deposit.maxUsd),
      amounts: amounts
        .map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>) : {}))
        .filter((a) => num(a.usd) > 0 && Number.isInteger(a.stars) && num(a.stars) > 0)
        .map((a) => ({ usd: num(a.usd), stars: num(a.stars) })),
    },
    ticket: { enabled: ticket.enabled === true },
  }
}

const STATUSES: readonly StarPaymentStatus[] = [
  "created",
  "invoice_created",
  "pending",
  "paid",
  "credited",
  "failed",
  "cancelled",
  "refunded",
]

export function parseStarPayment(raw: unknown): StarPayment | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  if (typeof r.id !== "string" || !STATUSES.includes(r.status as StarPaymentStatus)) return null
  const fulfillment = r.fulfillment === "processing" || r.fulfillment === "done" || r.fulfillment === "failed" ? r.fulfillment : null
  return {
    id: r.id,
    purpose: r.purpose === "ticket" ? "ticket" : "deposit",
    status: r.status as StarPaymentStatus,
    stars: num(r.stars),
    baseUsd: typeof r.baseUsd === "number" ? r.baseUsd : null,
    creditedUsd: typeof r.creditedUsd === "number" ? r.creditedUsd : null,
    tournamentId: typeof r.tournamentId === "number" ? r.tournamentId : null,
    fulfillment,
    failureReason: typeof r.failureReason === "string" ? r.failureReason : null,
  }
}

export async function fetchStarsOptions(): Promise<StarsOptions> {
  const res = await post<Envelope<unknown>>("/telegram/stars/options")
  return parseStarsOptions(res.data)
}

export async function fetchStarsQuote(order: StarsOrder): Promise<number | null> {
  const res = await post<Envelope<{ stars?: unknown }>>("/telegram/stars/quote", order)
  const stars = res.data?.stars
  return typeof stars === "number" && Number.isInteger(stars) && stars > 0 ? stars : null
}

/**
 * Where a payment stands, as far as the player is concerned.
 * - `credited`: the money is in the wallet (top-up).
 * - `tickets`: paid and the tickets were bought.
 * - `tickets_in_wallet`: paid, but the tickets could not be bought; the money is in the wallet.
 * - `refunded` / `closed`: nothing was charged in the end, or it was given back.
 * - `waiting`: Telegram or the server has not finished yet.
 */
export type StarsOutcome = "credited" | "tickets" | "tickets_in_wallet" | "refunded" | "closed" | "waiting"

export function paymentOutcome(p: StarPayment): StarsOutcome {
  if (p.status === "refunded") return "refunded"
  if (p.status === "failed" || p.status === "cancelled") return "closed"
  if (p.status !== "credited") return "waiting"
  if (p.purpose !== "ticket") return "credited"
  if (p.fulfillment === "done") return "tickets"
  if (p.fulfillment === "failed") return "tickets_in_wallet"
  return "waiting"
}

export const STARS_GENERIC_ERROR = "The payment couldn't be started. Please try again."

/** Stable refusal reasons from the Player API → copy. */
export const STARS_ERROR_COPY: Record<string, string> = {
  unavailable: "Paying with Telegram Stars isn't available right now.",
  telegram_unavailable: "Telegram didn't respond. Please try again in a moment.",
  telegram_session_required: "Please reopen WingoBingo from Telegram to pay with Stars.",
  amount_out_of_range: "This amount can't be paid with Stars.",
  amount_too_large: "This amount is too large to pay with Stars. Please choose a smaller one.",
  invalid_amount: "This amount can't be paid with Stars.",
  too_many_open_payments: "You have several unfinished payments. Please wait a few minutes and try again.",
  ticketing_closed: "Ticket sales for this draw are closed.",
  private_game: "Stars can't be used for this game. Please pay with your wallet balance.",
  ticket_owned: "You already have one of these tickets. Please change your numbers.",
  invalid_tickets: "Please check your numbers and try again.",
  nothing_to_pay: "These tickets are free — there's nothing to pay.",
  generic: STARS_GENERIC_ERROR,
}

export function starsErrorKey(err: unknown): string {
  const { msg } = apiErrorDetail(err)
  return STARS_ERROR_COPY[msg] ? msg : "generic"
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type PollOptions = { timeoutMs?: number; wait?: (ms: number) => Promise<unknown>; now?: () => number }

/**
 * Asks the server until the payment is settled. `check` lets the server look
 * the payment up with Telegram when the confirmation has not reached it yet.
 */
export async function waitForPayment(id: string, opts: PollOptions = {}): Promise<StarPayment | null> {
  const wait = opts.wait ?? sleep
  const now = opts.now ?? Date.now
  const deadline = now() + (opts.timeoutMs ?? 60_000)
  let last: StarPayment | null = null
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await post<Envelope<unknown>>("/telegram/stars/status", { id, check: attempt > 0 })
      last = parseStarPayment(res.data) ?? last
    } catch {
      // Keep asking until the deadline; a dropped request changes nothing on the server.
    }
    if (last && paymentOutcome(last) !== "waiting") return last
    if (now() >= deadline) return last
    await wait(attempt < 6 ? 1500 : 3000)
  }
}

export type StarsResult =
  | { kind: "settled"; payment: StarPayment; outcome: Exclude<StarsOutcome, "waiting"> }
  | { kind: "still_waiting"; payment: StarPayment | null }
  | { kind: "cancelled" }
  | { kind: "refused"; errorKey: string }

/**
 * One Stars payment: the server prices it and creates the invoice, Telegram
 * takes the payment, and the result is whatever the server then reports.
 * Telegram's own "paid" callback only decides whether to keep waiting.
 */
export async function payWithStars(
  order: StarsOrder,
  lang: string,
  deps: { open?: (url: string) => Promise<InvoiceStatus>; poll?: PollOptions } = {},
): Promise<StarsResult> {
  const open = deps.open ?? openInvoice
  let invoice: { id?: unknown; invoiceLink?: unknown; stars?: unknown } | undefined
  try {
    const res = await post<Envelope<typeof invoice>>("/telegram/stars/invoice", { ...order, lang })
    invoice = res.data
  } catch (err) {
    const errorKey = starsErrorKey(err)
    trackDebug("payment.flow", "warn", "stars invoice refused", { purpose: order.purpose, reason: errorKey })
    return { kind: "refused", errorKey }
  }
  const id = typeof invoice?.id === "string" ? invoice.id : null
  const link = typeof invoice?.invoiceLink === "string" && invoice.invoiceLink.startsWith("https://t.me/") ? invoice.invoiceLink : null
  if (!id || !link) return { kind: "refused", errorKey: "generic" }

  trackDebug("payment.flow", "info", "stars invoice opened", { purpose: order.purpose, stars: num(invoice?.stars) }, id)
  const sheet = await open(link)
  trackDebug("payment.flow", "info", `stars invoice closed: ${sheet}`, { purpose: order.purpose }, id)

  if (sheet === "cancelled" || sheet === "failed") {
    let after: StarPayment | null = null
    try {
      const res = await post<Envelope<unknown>>("/telegram/stars/cancel", { id, outcome: sheet })
      after = parseStarPayment(res.data)
    } catch {
      // The server closes unpaid invoices on its own; a late payment still wins there.
    }
    const outcome = after ? paymentOutcome(after) : "closed"
    if (after && outcome !== "waiting" && outcome !== "closed") return { kind: "settled", payment: after, outcome }
    // A confirmation that reached the server first (paid, crediting) is followed below.
    if (!after || (after.status !== "paid" && after.status !== "credited")) return { kind: "cancelled" }
  }

  const payment = await waitForPayment(id, deps.poll)
  if (!payment || paymentOutcome(payment) === "waiting") {
    trackDebug("payment.flow", "warn", "stars payment not settled yet", { purpose: order.purpose, status: payment?.status ?? null }, id)
    return { kind: "still_waiting", payment }
  }
  const outcome = paymentOutcome(payment) as Exclude<StarsOutcome, "waiting">
  trackDebug("payment.flow", outcome === "closed" ? "warn" : "info", `stars payment ${outcome}`, { purpose: order.purpose }, id)
  return { kind: "settled", payment, outcome }
}

/**
 * A one-time, two-minute link that opens the website signed in as this
 * player. The token is only in that link; it is never stored here.
 */
export async function fetchWebsiteHandoff(intent: "deposit" | "ticket", lang: string, gameId?: string): Promise<string | null> {
  try {
    const res = await post<Envelope<{ url?: unknown }>>("/telegram/stars/handoff", { intent, lang, ...(gameId ? { gameId } : {}) })
    const url = res.data?.url
    return typeof url === "string" && url.startsWith("https://") ? url : null
  } catch (err) {
    trackDebug("payment.flow", "warn", "website handoff refused", { intent, reason: apiErrorDetail(err).msg || "error" })
    return null
  }
}
