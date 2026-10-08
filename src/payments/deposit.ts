import { apiErrorDetail, getDisplayCurrency, post } from "../api"
import { trackDebug } from "../telemetry"

/**
 * Wallet top-ups other than Stars, on the same Player API endpoints the
 * website's deposit page uses. Only the server's payment status says whether
 * money arrived; the client never decides a payment is paid.
 */

export type DepositMethod = "card" | "crypto" | "voucher" | "giftCode"

export const DEPOSIT_METHODS: readonly DepositMethod[] = ["card", "crypto", "voucher", "giftCode"]

export type MiniappMethods = Record<DepositMethod, boolean>

type Envelope<T> = { data?: T }
type Obj = Record<string, unknown>

const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {})
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "")
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** A method is offered only when the server says so; anything unreadable is off. */
export function parseMiniappMethods(raw: unknown): MiniappMethods {
  const r = obj(raw)
  return { card: r.card === true, crypto: r.crypto === true, voucher: r.voucher === true, giftCode: r.giftCode === true }
}

export async function fetchMiniappMethods(): Promise<MiniappMethods> {
  const res = await post<Envelope<unknown>>("/telegram/miniapp/payment-methods")
  return parseMiniappMethods(res.data)
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"

/** What the player typed, as a number: Persian/Arabic digits, group separators and either decimal mark. */
export function parseAmount(text: string): number | null {
  let s = text.trim()
  for (let d = 0; d < 10; d++) {
    s = s.split(PERSIAN_DIGITS[d] ?? "").join(String(d)).split(ARABIC_DIGITS[d] ?? "").join(String(d))
  }
  s = s.replace(/[\s,٬\u00a0\u202f']/g, "").replace("٫", ".")
  if (!/^\d+(\.\d{1,8})?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Rounds up to two significant digits (12 → 12, 1 049 000 → 1 100 000) for the quick amounts. */
export function niceAmount(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  if (n < 100) return Math.ceil(n)
  const step = 10 ** (Math.floor(Math.log10(n)) - 1)
  return Math.ceil(n / step) * step
}

/** Quick amounts in the display currency, from US dollar steps. */
export function quickAmounts(usdToDisplay: number, minimum: number): number[] {
  const out = new Set<number>()
  for (const usd of [10, 25, 50, 100]) {
    const v = niceAmount(usd * usdToDisplay)
    if (v >= minimum) out.add(v)
  }
  return [...out].slice(0, 4)
}

/** A USD minimum in the display currency, rounded up so the server never sees it as too low. */
export function minimumIn(usd: number, usdToDisplay: number): number {
  return Math.ceil(usd * usdToDisplay * 100 - 1e-6) / 100
}

/** 1 USD in `currency`; null when the rate is not available (never guessed). */
export async function fetchUsdRate(currency: string): Promise<number | null> {
  if (currency === "USD") return 1
  return fetchRate("USD", currency)
}

async function fetchRate(from: string, to: string): Promise<number | null> {
  try {
    const res = await post<Envelope<{ coefficient?: unknown }>>("/convertCurrency", { from, to })
    const rate = num(res.data?.coefficient)
    return rate && rate > 0 ? rate : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Card: Visa / Mastercard and the local methods of the player's country
// ---------------------------------------------------------------------------

/** Card and bank minimum in USD until the region's own loads (the website's MINIMUM_USD). */
export const CARD_MINIMUM_USD = 1

export type CardFieldOption = { value: string; labelKey: string }

export type CardField = {
  key: string
  labelKey: string
  type: "text" | "tel" | "email" | "date" | "select"
  required: boolean
  placeholderKey: string | null
  scope: "customer" | "payload"
  options: CardFieldOption[]
}

export type CardMethodOption = {
  methodKey: string
  labelKey: string
  descriptionKey: string
  fields: CardField[]
}

export type CardOptions = {
  /** Local methods for this country are on (pick one before paying). */
  active: boolean
  country: string | null
  countryLabel: string | null
  methods: CardMethodOption[]
  /** False when card payment is not offered in the player's region. */
  cardAvailable: boolean
  /** Set when the card is charged in a local currency (IRR). */
  chargeCurrency: string | null
  /** Card and bank minimum in USD for the player's region (admin-set); null keeps CARD_MINIMUM_USD. */
  minimumUsd: number | null
}

const FIELD_TYPES = new Set(["text", "tel", "email", "date", "select"])
const FIELD_KEY_RE = /^[a-z_]{1,40}$/

function parseField(raw: unknown): CardField | null {
  const f = obj(raw)
  const key = str(f.key)
  if (!FIELD_KEY_RE.test(key)) return null
  const type = FIELD_TYPES.has(str(f.type)) ? (str(f.type) as CardField["type"]) : "text"
  return {
    key,
    labelKey: str(f.labelKey) || key,
    type,
    required: f.required === true,
    placeholderKey: str(f.placeholderKey) || null,
    scope: f.scope === "payload" ? "payload" : "customer",
    options: (Array.isArray(f.options) ? f.options : [])
      .map((o) => ({ value: str(obj(o).value), labelKey: str(obj(o).labelKey) || str(obj(o).value) }))
      .filter((o) => o.value !== ""),
  }
}

export function parseCardOptions(raw: unknown): CardOptions {
  const r = obj(raw)
  const minimumUsd = num(r.cardMinimumUsd)
  const methods = (Array.isArray(r.methods) ? r.methods : [])
    .map((m) => obj(m))
    .filter((m) => str(m.methodKey) !== "")
    .sort((a, b) => (num(a.sortOrder) ?? 0) - (num(b.sortOrder) ?? 0))
    .map((m) => ({
      methodKey: str(m.methodKey),
      labelKey: str(m.labelKey) || str(m.methodKey),
      descriptionKey: str(m.descriptionKey),
      fields: (Array.isArray(m.fields) ? m.fields : []).map(parseField).filter((f): f is CardField => f !== null),
    }))
  return {
    active: r.active === true && methods.length > 0,
    country: str(r.country) || null,
    countryLabel: str(r.countryLabel) || null,
    methods,
    cardAvailable: r.cardAvailable !== false,
    chargeCurrency: str(r.cardChargeCurrency) || null,
    minimumUsd: minimumUsd != null && minimumUsd > 0 ? minimumUsd : null,
  }
}

export async function fetchCardOptions(): Promise<CardOptions> {
  const res = await post<Envelope<unknown>>("/getRiverpeDepositOptions")
  return parseCardOptions(res.data)
}

export type SavedDetails = { provider: string; methodKey: string; fields: Record<string, string> }

export async function fetchSavedDetails(): Promise<SavedDetails[]> {
  const res = await post<Envelope<{ items?: unknown[] }>>("/getSavedPaymentDetails")
  return (res.data?.items ?? [])
    .map((i) => obj(i))
    .map((i) => ({
      provider: str(i.provider),
      methodKey: str(i.methodKey),
      fields: Object.fromEntries(Object.entries(obj(i.fields)).map(([k, v]) => [k, str(v)])),
    }))
    .filter((i) => i.provider !== "" && i.methodKey !== "")
}

export async function removeSavedDetails(provider: string, methodKey: string): Promise<void> {
  await post("/deleteSavedPaymentDetails", { provider, methodKey })
}

export type StartedPayment = { paymentId: string; paymentLink: string | null }

const ID_RE = /^\d{1,20}$/

function startedFrom(raw: unknown): StartedPayment | null {
  const r = obj(raw)
  const paymentId = str(r.localTransactionId)
  if (!ID_RE.test(paymentId)) return null
  const link = str(r.paymentLink)
  return { paymentId, paymentLink: link.startsWith("https://") ? link : null }
}

/** The amount is in the display currency (`metadata.currency`); the server converts and records it in USD. */
export async function startCardPayment(input: {
  amount: number
  methodKey: string | null
  customer: Record<string, string>
  payload: Record<string, string>
}): Promise<StartedPayment> {
  const metadata: Obj = { ...input.payload }
  if (input.methodKey) metadata.riverpePaymentMethod = input.methodKey
  if (Object.keys(input.customer).length) metadata.customer = input.customer
  const res = await post<Envelope<unknown>>("/initPayment", { type: "mastercard", amount: String(input.amount), metadata })
  const started = startedFrom(res.data)
  if (!started?.paymentLink) throw new DepositRefused("card_gateway_unavailable")
  trackDebug("payment.flow", "info", "card payment page opened", { method: input.methodKey ?? "card" }, started.paymentId)
  return started
}

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------

export type CryptoNetwork = { label: string; ticker: string }
export type CryptoCoin = { symbol: string; name: string; faName: string; networks: CryptoNetwork[] }

const TICKER_RE = /^[A-Z0-9]{2,16}$/

export function parseCryptoCoins(raw: unknown): CryptoCoin[] {
  return (Array.isArray(raw) ? raw : [])
    .map((c) => obj(c))
    .map((c) => ({
      symbol: str(c.symbol).toUpperCase(),
      name: str(c.name) || str(c.symbol),
      faName: str(c.faName) || str(c.name) || str(c.symbol),
      networks: (Array.isArray(c.payload) ? c.payload : [])
        .map((p) => ({ label: str(obj(p).label), ticker: str(obj(p).value).toUpperCase() }))
        .filter((p) => TICKER_RE.test(p.ticker)),
    }))
    .filter((c) => c.symbol !== "" && c.networks.length > 0)
}

export async function fetchCryptoCoins(): Promise<CryptoCoin[]> {
  const res = await post<Envelope<unknown>>("/getCryptocurrencies")
  return parseCryptoCoins(res.data)
}

/** USDTTRC20 → USDT, USDCSOL → USDC; other tickers are their own asset. */
export function baseAsset(ticker: string): string {
  const t = ticker.toUpperCase()
  if (t.startsWith("USDT")) return "USDT"
  if (t.startsWith("USDC")) return "USDC"
  return t
}

export type CryptoMinimum = { minCrypto: number; minUsd: number | null; asset: string }

/** The gateway's minimum for a network, and its value in USD when a rate is known. */
export async function fetchCryptoMinimum(ticker: string): Promise<CryptoMinimum> {
  const res = await post<Envelope<unknown>>("/getCryptoMinAllowedAmount", { currency: ticker })
  const minCrypto = num(res.data) ?? 0
  const asset = baseAsset(ticker)
  let rate = await fetchRate(ticker, "USD")
  if (!rate && asset !== ticker) rate = await fetchRate(asset, "USD")
  if (!rate && (asset === "USDT" || asset === "USDC")) rate = 1
  const minUsd = minCrypto > 0 && rate ? Math.ceil(minCrypto * rate * 100) / 100 : null
  return { minCrypto, minUsd, asset }
}

export async function startCryptoPayment(input: { amount: number; ticker: string }): Promise<StartedPayment> {
  const res = await post<Envelope<unknown>>("/initPayment", {
    type: "crypto",
    amount: String(input.amount),
    metadata: { coin: input.ticker },
  })
  const started = startedFrom(res.data)
  if (!started) throw new DepositRefused("generic")
  trackDebug("payment.flow", "info", "crypto payment address issued", { coin: input.ticker }, started.paymentId)
  return started
}

/** Short crypto amounts: more decimals for small values. */
export function formatCrypto(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—"
  if (n >= 100) return n.toFixed(2)
  if (n >= 1) return n.toFixed(4).replace(/\.?0+$/, "")
  return n.toFixed(6).replace(/\.?0+$/, "")
}

/** Network label for the player: the picker's label when known, else from the chain or ticker. */
export function networkLabel(network: string, ticker: string, hint = ""): string {
  if (hint.trim()) return hint.trim()
  const n = network.trim().toLowerCase()
  const byNetwork: Record<string, string> = {
    trx: "TRC-20 (Tron)",
    tron: "TRC-20 (Tron)",
    eth: "ERC-20 (Ethereum)",
    ethereum: "ERC-20 (Ethereum)",
    matic: "Polygon",
    polygon: "Polygon",
    bsc: "BEP-20 (BSC)",
    sol: "Solana",
    solana: "Solana",
  }
  if (byNetwork[n]) return byNetwork[n]
  const t = ticker.toUpperCase()
  if (t.includes("TRC20") || t === "TRX") return "TRC-20 (Tron)"
  if (t.includes("ERC20")) return "ERC-20 (Ethereum)"
  if (t.includes("MATIC")) return "Polygon"
  if (t.includes("SOL")) return "Solana"
  return network.trim() || ticker || "—"
}

// ---------------------------------------------------------------------------
// Payment status (card and crypto): POST /getPayment, scoped to the player
// ---------------------------------------------------------------------------

/** What the player needs to know: still open, money arrived, or it ended without money. */
export type DepositPhase = "waiting" | "paid" | "failed"

const PAID = new Set(["success", "done", "confirm"])
const FAILED = new Set(["failed", "blocked", "reject"])

export function phaseOf(status: string): DepositPhase {
  const s = status.toLowerCase()
  if (PAID.has(s)) return "paid"
  if (FAILED.has(s)) return "failed"
  return "waiting"
}

export type CryptoInstructions = {
  address: string
  qr: string | null
  payAmount: number | null
  token: string
  network: string
  expiresAt: number | null
}

export type DepositStatus = {
  id: string
  type: "crypto" | "mastercard" | "utopia" | "other"
  status: string
  phase: DepositPhase
  /** What the player asked for, in the currency they typed it in. */
  amount: number | null
  currency: string
  createdAt: number | null
  /** Card: the provider's page, to open it again while the payment is open. */
  paymentLink: string | null
  crypto: CryptoInstructions | null
}

function epochMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v
  if (typeof v === "string" && v.trim()) {
    if (/^\d+$/.test(v.trim())) return epochMs(Number(v))
    const t = Date.parse(v)
    return Number.isFinite(t) ? t : null
  }
  return null
}

const QR_RE = /^(https:\/\/|data:image\/(png|jpeg|gif|svg\+xml|webp);base64,)/

export function parseDepositStatus(raw: unknown): DepositStatus | null {
  const r = obj(raw)
  const local = obj(r.localTransaction)
  const id = str(local.id)
  if (!ID_RE.test(id)) return null
  const meta = obj(local.metadata)
  const ext = obj(r.externalData)
  const typeRaw = str(r.paymentType) || str(meta.type)
  const type: DepositStatus["type"] =
    typeRaw === "crypto" || typeRaw === "mastercard" || typeRaw === "utopia" ? typeRaw : "other"
  const status = str(local.status) || "pending"

  const hasOriginal = num(meta.originalAmount) != null
  const amount = hasOriginal ? num(meta.originalAmount) : num(meta.amountUSD) ?? num(local.amount)
  const currency = hasOriginal ? str(meta.originalCurrency) || "USD" : "USD"

  let crypto: CryptoInstructions | null = null
  if (type === "crypto") {
    const ticker = str(ext.payCurrency) || str(meta.coin)
    const qr = str(ext.qr) || str(meta.qrCode)
    crypto = {
      address: str(ext.payAddress) || str(meta.paymentAddress),
      qr: QR_RE.test(qr) ? qr : null,
      payAmount: num(ext.payAmount),
      token: baseAsset(ticker) || "—",
      network: networkLabel(str(ext.network) || str(meta.network), ticker),
      expiresAt: epochMs(ext.expirationEstimateDate) ?? epochMs(meta.expiresAt),
    }
  }

  const link = str(meta.paymentLink)
  return {
    id,
    type,
    status,
    phase: phaseOf(status),
    amount,
    currency,
    createdAt: epochMs(local.createdAt),
    paymentLink: type === "mastercard" && link.startsWith("https://") ? link : null,
    crypto,
  }
}

export async function fetchDepositStatus(id: string): Promise<DepositStatus | null> {
  const res = await post<Envelope<unknown>>("/getPayment", { id })
  return parseDepositStatus(res.data)
}

// ---------------------------------------------------------------------------
// Utopia voucher
// ---------------------------------------------------------------------------

/** Utopia validates the code; the app only trims it and drops spaces pasted in. */
export function normalizeVoucher(text: string): string {
  return text.replace(/\s+/g, "")
}

export type VoucherResult = { paymentId: string; phase: DepositPhase; valueUsd: number | null }

export async function activateVoucher(code: string): Promise<VoucherResult> {
  const res = await post<Envelope<unknown>>("/utopia/activate", { code })
  const d = obj(res.data)
  const paymentId = str(d.paymentId)
  if (!ID_RE.test(paymentId)) throw new DepositRefused("voucher_rejected")
  const phase = phaseOf(str(d.paymentStatus) || (d.status === "confirm" ? "success" : str(d.status)))
  trackDebug("payment.flow", "info", `voucher activated: ${phase}`, {}, paymentId)
  return { paymentId, phase, valueUsd: num(d.valueUSD) }
}

export async function fetchVoucherStatus(paymentId: string): Promise<VoucherResult> {
  const res = await post<Envelope<unknown>>("/utopia/status", { paymentId })
  const d = obj(res.data)
  return {
    paymentId,
    phase: phaseOf(str(d.status)),
    valueUsd: num(d.amountUSD) ?? num(d.amount),
  }
}

// ---------------------------------------------------------------------------
// Gift code (credit codes; discount codes apply at ticket checkout)
// ---------------------------------------------------------------------------

export type GiftResult =
  | {
      kind: "credit"
      creditedAmount: number
      newBonusBalance: number
      currency: string
      wageringRequired: number | null
    }
  | { kind: "discount"; code: string }

export async function redeemGiftCode(code: string): Promise<GiftResult> {
  try {
    const res = await post<Envelope<unknown>>("/gift-codes/redeem", { code })
    const d = obj(res.data)
    const wagering = obj(d.wagering)
    return {
      kind: "credit",
      creditedAmount: num(d.creditedAmount) ?? 0,
      newBonusBalance: num(d.newBonusBalance) ?? 0,
      currency: str(d.currency) || getDisplayCurrency(),
      wageringRequired: d.wagering ? num(wagering.requiredAmount) : null,
    }
  } catch (err) {
    const { code: status, msg } = apiErrorDetail(err)
    if (status === 400 && /checkout/i.test(msg)) return { kind: "discount", code }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Errors → copy
// ---------------------------------------------------------------------------

export class DepositRefused extends Error {
  readonly key: string
  constructor(key: string) {
    super(key)
    this.key = key
  }
}

export const DEPOSIT_GENERIC_ERROR = "The payment couldn't be started. Please try again."

export const DEPOSIT_ERROR_COPY: Record<string, string> = {
  miniapp_method_disabled: "This payment method isn't available in the app right now. Please choose another one.",
  card_unavailable_region:
    "Visa/Mastercard payments aren't available in your country right now. Please choose another deposit method.",
  card_gateway_unavailable:
    "The payment service didn't respond. Please try again in a few minutes or choose another deposit method.",
  amount_below_minimum: "This amount is below the minimum deposit. Enter a higher amount to continue.",
  riverpe_kyc_rejected:
    "Check that the payer's name, phone number, date of birth, NIN and BVN exactly match the bank's records, then try again.",
  rate_unavailable: "We couldn't load today's exchange rate. Please try again in a moment.",
  network: "Connection problem. Check your internet and try again.",
  too_many_requests: "Too many attempts. Please wait a minute and try again.",
  voucher_rejected: "We couldn't activate this voucher. Check the code for typos and try again.",
  gift_not_found: "We couldn't find this gift code. Check it and try again.",
  gift_not_yours: "This gift code belongs to another account.",
  gift_used: "You've already used this gift code.",
  gift_expired: "This gift code has expired.",
  gift_not_active: "This gift code isn't active yet.",
  gift_unavailable: "This gift code is no longer available.",
  gift_invalid: "This gift code can't be redeemed here.",
  generic: DEPOSIT_GENERIC_ERROR,
}

/** Stable copy key for a refused deposit call. Provider wording is never shown as is. */
export function depositErrorKey(err: unknown, method: DepositMethod): string {
  if (err instanceof DepositRefused) return DEPOSIT_ERROR_COPY[err.key] ? err.key : "generic"
  const { status, code, msg } = apiErrorDetail(err)
  if (status === 0) return "network"
  if (status === 429 || msg === "too_many_requests") return "too_many_requests"
  if (DEPOSIT_ERROR_COPY[msg]) return msg
  if (method === "voucher") return "voucher_rejected"
  if (method === "giftCode") {
    const m = msg.toLowerCase()
    if (m.includes("expired")) return "gift_expired"
    if (m.includes("not yet active")) return "gift_not_active"
    if (m.includes("already used")) return "gift_used"
    if (code === 403 || m.includes("not assigned")) return "gift_not_yours"
    if (code === 404) return "gift_not_found"
    if (code === 409) return "gift_unavailable"
    if (code === 400) return "gift_invalid"
  }
  return "generic"
}
