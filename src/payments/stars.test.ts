import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: { path: string; body: Record<string, unknown> }[] = []
let handler: (path: string, body: Record<string, unknown>) => unknown = () => ({})

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api")
  return {
    ...actual,
    post: vi.fn(async (path: string, body: Record<string, unknown> = {}) => {
      calls.push({ path, body })
      const out = handler(path, body)
      if (out instanceof Error) throw out
      return out
    }),
  }
})
vi.mock("../telemetry", () => ({ trackDebug: () => undefined }))

const { ApiError } = await import("../api")
const { parseStarsOptions, parseStarPayment, paymentOutcome, payWithStars, starsErrorKey, waitForPayment, fetchWebsiteHandoff } =
  await import("./stars")

const payment = (over: Record<string, unknown> = {}) => ({
  id: "7",
  purpose: "deposit",
  status: "invoice_created",
  stars: 1099,
  baseUsd: 10,
  creditedUsd: null,
  tournamentId: null,
  fulfillment: null,
  failureReason: null,
  ...over,
})

const fastPoll = { wait: async () => undefined, timeoutMs: 50, now: (() => {
  let t = 0
  return () => (t += 10)
})() }

beforeEach(() => {
  calls.length = 0
  handler = () => ({})
})

describe("parseStarsOptions", () => {
  it("keeps only valid server amounts and defaults everything to off", () => {
    expect(parseStarsOptions(null)).toEqual({
      starsEnabled: false,
      externalLinkEnabled: false,
      deposit: { enabled: false, minUsd: 0, maxUsd: 0, amounts: [] },
      ticket: { enabled: false },
    })
    const o = parseStarsOptions({
      starsEnabled: true,
      externalLinkEnabled: true,
      deposit: { enabled: true, minUsd: 1, maxUsd: 500, amounts: [{ usd: 10, stars: 1099 }, { usd: 5, stars: 1.5 }, { usd: -1, stars: 3 }, null] },
      ticket: { enabled: true },
    })
    expect(o.deposit.amounts).toEqual([{ usd: 10, stars: 1099 }])
    expect(o.ticket.enabled).toBe(true)
  })
})

describe("paymentOutcome", () => {
  const p = (over: Record<string, unknown>) => parseStarPayment(payment(over))!
  it("is only final once the server credited the wallet", () => {
    expect(paymentOutcome(p({ status: "invoice_created" }))).toBe("waiting")
    expect(paymentOutcome(p({ status: "pending" }))).toBe("waiting")
    expect(paymentOutcome(p({ status: "paid" }))).toBe("waiting")
    expect(paymentOutcome(p({ status: "credited", creditedUsd: 10 }))).toBe("credited")
    expect(paymentOutcome(p({ status: "failed" }))).toBe("closed")
    expect(paymentOutcome(p({ status: "cancelled" }))).toBe("closed")
    expect(paymentOutcome(p({ status: "refunded" }))).toBe("refunded")
  })
  it("waits for the ticket purchase after crediting", () => {
    expect(paymentOutcome(p({ purpose: "ticket", status: "credited" }))).toBe("waiting")
    expect(paymentOutcome(p({ purpose: "ticket", status: "credited", fulfillment: "processing" }))).toBe("waiting")
    expect(paymentOutcome(p({ purpose: "ticket", status: "credited", fulfillment: "done" }))).toBe("tickets")
    expect(paymentOutcome(p({ purpose: "ticket", status: "credited", fulfillment: "failed" }))).toBe("tickets_in_wallet")
  })
  it("rejects unknown shapes", () => {
    expect(parseStarPayment({ id: 7, status: "credited" })).toBeNull()
    expect(parseStarPayment({ id: "7", status: "paid_by_client" })).toBeNull()
  })
})

describe("starsErrorKey", () => {
  it("maps the server's reason, else a generic message", () => {
    expect(starsErrorKey(new ApiError(409, "http_error", { code: 409, msg: "ticketing_closed" }))).toBe("ticketing_closed")
    expect(starsErrorKey(new ApiError(500, "http_error", { msg: "something_new" }))).toBe("generic")
    expect(starsErrorKey(new Error("x"))).toBe("generic")
  })
})

describe("payWithStars", () => {
  const order = { purpose: "deposit" as const, amountUsd: 10 }

  it("sends no price: the server prices the invoice", async () => {
    handler = (path) =>
      path === "/telegram/stars/invoice"
        ? { data: { id: "7", invoiceLink: "https://t.me/$abc", stars: 1099 } }
        : { data: payment({ status: "credited", creditedUsd: 10 }) }
    await payWithStars(order, "fa", { open: async () => "paid", poll: fastPoll })
    const invoice = calls.find((c) => c.path === "/telegram/stars/invoice")!
    expect(invoice.body).toMatchObject({ purpose: "deposit", amountUsd: 10, lang: "fa" })
    expect(invoice.body).not.toHaveProperty("stars")
  })

  it("does not trust Telegram's 'paid': success only when the server says credited", async () => {
    handler = (path) =>
      path === "/telegram/stars/invoice"
        ? { data: { id: "7", invoiceLink: "https://t.me/$abc", stars: 1099 } }
        : { data: payment({ status: "pending" }) }
    const result = await payWithStars(order, "en", { open: async () => "paid", poll: fastPoll })
    expect(result.kind).toBe("still_waiting")
    expect(calls.some((c) => c.path === "/telegram/stars/status")).toBe(true)
  })

  it("reports the credit once the server confirms it, asking Telegram on later polls", async () => {
    let polls = 0
    handler = (path) => {
      if (path === "/telegram/stars/invoice") return { data: { id: "7", invoiceLink: "https://t.me/$abc", stars: 1099 } }
      polls += 1
      return { data: payment(polls < 3 ? { status: "paid" } : { status: "credited", creditedUsd: 10 }) }
    }
    const result = await payWithStars(order, "en", { open: async () => "paid", poll: { ...fastPoll, timeoutMs: 10_000 } })
    expect(result).toMatchObject({ kind: "settled", outcome: "credited" })
    const statusCalls = calls.filter((c) => c.path === "/telegram/stars/status")
    expect(statusCalls[0]!.body.check).toBe(false)
    expect(statusCalls[1]!.body.check).toBe(true)
  })

  it("closes the invoice on the server when the sheet is cancelled", async () => {
    handler = (path) =>
      path === "/telegram/stars/invoice"
        ? { data: { id: "7", invoiceLink: "https://t.me/$abc", stars: 1099 } }
        : { data: payment({ status: "cancelled" }) }
    const result = await payWithStars(order, "en", { open: async () => "cancelled", poll: fastPoll })
    expect(result.kind).toBe("cancelled")
    expect(calls.find((c) => c.path === "/telegram/stars/cancel")?.body).toMatchObject({ id: "7", outcome: "cancelled" })
  })

  it("follows a payment the server already received even if the sheet said failed", async () => {
    handler = (path) => {
      if (path === "/telegram/stars/invoice") return { data: { id: "7", invoiceLink: "https://t.me/$abc", stars: 1099 } }
      if (path === "/telegram/stars/cancel") return { data: payment({ status: "paid" }) }
      return { data: payment({ status: "credited", creditedUsd: 10 }) }
    }
    const result = await payWithStars(order, "en", { open: async () => "failed", poll: fastPoll })
    expect(result).toMatchObject({ kind: "settled", outcome: "credited" })
  })

  it("shows the server's refusal and never opens Telegram", async () => {
    handler = () => new ApiError(409, "http_error", { code: 409, msg: "unavailable" })
    const open = vi.fn(async () => "paid" as const)
    const result = await payWithStars(order, "en", { open, poll: fastPoll })
    expect(result).toEqual({ kind: "refused", errorKey: "unavailable" })
    expect(open).not.toHaveBeenCalled()
  })

  it("refuses an invoice link that is not Telegram's", async () => {
    handler = () => ({ data: { id: "7", invoiceLink: "https://evil.example/pay", stars: 1 } })
    const open = vi.fn(async () => "paid" as const)
    expect(await payWithStars(order, "en", { open, poll: fastPoll })).toEqual({ kind: "refused", errorKey: "generic" })
    expect(open).not.toHaveBeenCalled()
  })

  it("buys tickets: done only after the server bought them", async () => {
    handler = (path) =>
      path === "/telegram/stars/invoice"
        ? { data: { id: "8", invoiceLink: "https://t.me/$t", stars: 500 } }
        : { data: payment({ id: "8", purpose: "ticket", status: "credited", fulfillment: "done", creditedUsd: 4 }) }
    const result = await payWithStars(
      { purpose: "ticket", tournamentId: "42", tickets: [{ numbers: [1, 2, 3, 4, 5], chanceNumber: 3 }] },
      "en",
      { open: async () => "paid", poll: fastPoll },
    )
    expect(result).toMatchObject({ kind: "settled", outcome: "tickets" })
  })
})

describe("waitForPayment", () => {
  it("keeps asking through dropped requests until the deadline", async () => {
    handler = () => new ApiError(0, "network")
    expect(await waitForPayment("7", fastPoll)).toBeNull()
    expect(calls.length).toBeGreaterThan(1)
  })
})

describe("fetchWebsiteHandoff", () => {
  it("returns the server's https link, or null so the caller falls back", async () => {
    handler = () => ({ data: { url: "https://wingobingo.tv/api/telegram/handoff?token=x" } })
    expect(await fetchWebsiteHandoff("deposit", "fr")).toBe("https://wingobingo.tv/api/telegram/handoff?token=x")
    expect(calls[0]!.body).toMatchObject({ intent: "deposit", lang: "fr" })
    handler = () => new ApiError(409, "http_error", { msg: "unavailable" })
    expect(await fetchWebsiteHandoff("ticket", "en", "42")).toBeNull()
    handler = () => ({ data: { url: "javascript:alert(1)" } })
    expect(await fetchWebsiteHandoff("deposit", "en")).toBeNull()
  })
})
