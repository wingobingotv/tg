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
const d = await import("./deposit")

const refused = (code: number, msg: string) => new ApiError(code, msg, { status: "ERR", code, msg })

beforeEach(() => {
  calls.length = 0
  handler = () => ({})
})

describe("parseMiniappMethods", () => {
  it("offers only what the server switched on", () => {
    expect(d.parseMiniappMethods({ card: true, crypto: false, voucher: true })).toEqual({
      card: true,
      crypto: false,
      voucher: true,
      giftCode: false,
    })
    expect(d.parseMiniappMethods(null)).toEqual({ card: false, crypto: false, voucher: false, giftCode: false })
    expect(d.parseMiniappMethods({ card: "true", crypto: 1 })).toEqual({
      card: false,
      crypto: false,
      voucher: false,
      giftCode: false,
    })
  })
})

describe("amounts", () => {
  it("reads Persian and Arabic digits, separators and decimal marks", () => {
    expect(d.parseAmount("۱۲٬۵۰۰")).toBe(12500)
    expect(d.parseAmount("٢٥٫٥")).toBe(25.5)
    expect(d.parseAmount(" 1,000.50 ")).toBe(1000.5)
    expect(d.parseAmount("1 000")).toBe(1000)
    expect(d.parseAmount("")).toBeNull()
    expect(d.parseAmount("0")).toBeNull()
    expect(d.parseAmount("-5")).toBeNull()
    expect(d.parseAmount("12abc")).toBeNull()
  })

  it("rounds quick amounts up to two significant digits and keeps them above the minimum", () => {
    expect(d.niceAmount(12.3)).toBe(13)
    expect(d.niceAmount(1_049_000)).toBe(1_100_000)
    expect(d.quickAmounts(1, 5)).toEqual([10, 25, 50, 100])
    expect(d.quickAmounts(1, 30)).toEqual([50, 100])
    expect(d.quickAmounts(104_900, 524_500)).toEqual([1_100_000, 2_700_000, 5_300_000, 11_000_000])
  })

  it("rounds a USD minimum up in the display currency", () => {
    expect(d.minimumIn(5, 1)).toBe(5)
    expect(d.minimumIn(5, 0.9213)).toBe(4.61)
    expect(d.minimumIn(5, 104_900)).toBe(524_500)
  })

  it("never guesses an exchange rate", async () => {
    expect(await d.fetchUsdRate("USD")).toBe(1)
    handler = () => refused(500, "boom")
    expect(await d.fetchUsdRate("EUR")).toBeNull()
    handler = () => ({ data: { coefficient: 0.92 } })
    expect(await d.fetchUsdRate("EUR")).toBe(0.92)
    expect(calls.at(-1)).toEqual({ path: "/convertCurrency", body: { from: "USD", to: "EUR" } })
  })
})

describe("card", () => {
  it("parses the country's methods and drops malformed fields", () => {
    const o = d.parseCardOptions({
      active: true,
      country: "NG",
      countryLabel: "Nigeria",
      cardAvailable: true,
      methods: [
        { methodKey: "b", labelKey: "Bank transfer", sortOrder: 2, fields: [] },
        {
          methodKey: "a",
          labelKey: "Card",
          sortOrder: 1,
          fields: [
            { key: "first_name", labelKey: "First name", type: "text", required: true },
            { key: "id_type", type: "select", scope: "payload", options: [{ value: "NIN", labelKey: "NIN" }, { value: "" }] },
            { key: "Bad-Key", type: "text" },
          ],
        },
      ],
    })
    expect(o.active).toBe(true)
    expect(o.methods.map((m) => m.methodKey)).toEqual(["a", "b"])
    expect(o.methods[0]?.fields.map((f) => f.key)).toEqual(["first_name", "id_type"])
    expect(o.methods[0]?.fields[1]).toMatchObject({ scope: "payload", type: "select", options: [{ value: "NIN", labelKey: "NIN" }] })
  })

  it("is inactive without methods and unavailable only when the server says so", () => {
    expect(d.parseCardOptions({ active: true, methods: [] }).active).toBe(false)
    expect(d.parseCardOptions({}).cardAvailable).toBe(true)
    expect(d.parseCardOptions({ cardAvailable: false, cardChargeCurrency: "IRR" })).toMatchObject({
      cardAvailable: false,
      chargeCurrency: "IRR",
    })
  })

  it("takes the region's card minimum from the server, else none", () => {
    expect(d.parseCardOptions({ cardChargeCurrency: "IRR", cardMinimumUsd: 1 }).minimumUsd).toBe(1)
    expect(d.parseCardOptions({}).minimumUsd).toBeNull()
    expect(d.parseCardOptions({ cardMinimumUsd: 0 }).minimumUsd).toBeNull()
    expect(d.parseCardOptions({ cardMinimumUsd: "abc" }).minimumUsd).toBeNull()
  })

  it("starts a card payment with the payer details and returns the provider page", async () => {
    handler = () => ({ data: { paymentLink: "https://pay.example/x", localTransactionId: 42 } })
    const out = await d.startCardPayment({
      amount: 25,
      methodKey: "card_ng",
      customer: { first_name: "Ada" },
      payload: { id_type: "NIN" },
    })
    expect(out).toEqual({ paymentId: "42", paymentLink: "https://pay.example/x" })
    expect(calls[0]).toEqual({
      path: "/initPayment",
      body: {
        type: "mastercard",
        amount: "25",
        metadata: { id_type: "NIN", riverpePaymentMethod: "card_ng", customer: { first_name: "Ada" } },
      },
    })
  })

  it("refuses a payment page that is missing or not https", async () => {
    handler = () => ({ data: { paymentLink: "http://pay.example/x", localTransactionId: 42 } })
    await expect(d.startCardPayment({ amount: 5, methodKey: null, customer: {}, payload: {} })).rejects.toMatchObject({
      key: "card_gateway_unavailable",
    })
  })
})

describe("crypto", () => {
  it("parses coins with at least one network", () => {
    const coins = d.parseCryptoCoins([
      { symbol: "usdt", name: "Tether", payload: [{ label: "TRC20", value: "usdttrc20" }, { label: "x", value: "bad ticker" }] },
      { symbol: "XYZ", payload: [] },
    ])
    expect(coins).toEqual([{ symbol: "USDT", name: "Tether", faName: "Tether", networks: [{ label: "TRC20", ticker: "USDTTRC20" }] }])
  })

  it("converts the minimum to USD, falling back to the base asset and to 1:1 for stablecoins", async () => {
    handler = (path) => (path === "/getCryptoMinAllowedAmount" ? { data: 9.5 } : refused(500, "no rate"))
    expect(await d.fetchCryptoMinimum("USDTTRC20")).toEqual({ minCrypto: 9.5, minUsd: 9.5, asset: "USDT" })

    handler = (path, body) => {
      if (path === "/getCryptoMinAllowedAmount") return { data: "20" }
      return body.from === "TRX" ? { data: { coefficient: 0.1234 } } : refused(500, "no rate")
    }
    expect(await d.fetchCryptoMinimum("TRX")).toEqual({ minCrypto: 20, minUsd: 2.47, asset: "TRX" })

    handler = (path) => (path === "/getCryptoMinAllowedAmount" ? { data: 0.001 } : refused(500, "no rate"))
    expect((await d.fetchCryptoMinimum("BTC")).minUsd).toBeNull()
  })

  it("labels networks and shortens amounts", () => {
    expect(d.networkLabel("trx", "USDTTRC20")).toBe("TRC-20 (Tron)")
    expect(d.networkLabel("", "USDTERC20")).toBe("ERC-20 (Ethereum)")
    expect(d.networkLabel("", "USDTTRC20", "Tron")).toBe("Tron")
    expect(d.formatCrypto(12.5)).toBe("12.5")
    expect(d.formatCrypto(0.00012345)).toBe("0.000123")
    expect(d.formatCrypto(0)).toBe("—")
  })
})

describe("payment status", () => {
  it("maps local statuses to what the player sees", () => {
    for (const s of ["success", "done", "confirm"]) expect(d.phaseOf(s)).toBe("paid")
    for (const s of ["failed", "blocked", "reject"]) expect(d.phaseOf(s)).toBe("failed")
    for (const s of ["created", "pending", "inited", "processing", "anything"]) expect(d.phaseOf(s)).toBe("waiting")
  })

  it("reads crypto instructions from the gateway first, then the stored metadata", () => {
    const s = d.parseDepositStatus({
      paymentType: "crypto",
      localTransaction: {
        id: 9,
        status: "pending",
        amount: 10,
        createdAt: "2026-10-07T10:00:00Z",
        metadata: { coin: "USDTTRC20", paymentAddress: "Tmeta", originalAmount: 900, originalCurrency: "EUR", expiresAt: 1_780_000_000 },
      },
      externalData: { payAddress: "Tgw", payAmount: "10.4", payCurrency: "usdttrc20", network: "trx", qr: "javascript:alert(1)" },
    })
    expect(s).toMatchObject({ id: "9", type: "crypto", phase: "waiting", amount: 900, currency: "EUR" })
    expect(s?.crypto).toEqual({
      address: "Tgw",
      qr: null,
      payAmount: 10.4,
      token: "USDT",
      network: "TRC-20 (Tron)",
      expiresAt: 1_780_000_000_000,
    })
  })

  it("keeps a card page link only while it is https, and falls back to USD amounts", () => {
    const s = d.parseDepositStatus({
      paymentType: "mastercard",
      localTransaction: { id: "5", status: "success", amount: 12, metadata: { paymentLink: "https://card.example" } },
    })
    expect(s).toMatchObject({ phase: "paid", amount: 12, currency: "USD", paymentLink: "https://card.example", crypto: null })
    expect(d.parseDepositStatus({ localTransaction: { id: "abc" } })).toBeNull()
  })
})

describe("voucher", () => {
  it("normalises a pasted code", () => {
    expect(d.normalizeVoucher(" USD-ab12-CD34 -EF56 \n")).toBe("USD-ab12-CD34-EF56")
  })

  it("uses the server's payment status, not the provider's", async () => {
    handler = () => ({ data: { paymentId: 77, status: "confirm", paymentStatus: "success", valueUSD: 20 } })
    expect(await d.activateVoucher("USD-AAAA-BBBB")).toEqual({ paymentId: "77", phase: "paid", valueUsd: 20 })
    handler = () => ({ data: { paymentId: 78, status: "pending", paymentStatus: "pending" } })
    expect((await d.activateVoucher("USD-AAAA-BBBB")).phase).toBe("waiting")
    handler = () => ({ data: { status: "success", amountUSD: 20 } })
    expect(await d.fetchVoucherStatus("78")).toEqual({ paymentId: "78", phase: "paid", valueUsd: 20 })
  })
})

describe("gift code", () => {
  it("returns the credit, or tells a discount code apart", async () => {
    handler = () => ({ data: { creditedAmount: 5, newBonusBalance: 12, currency: "USD", wagering: { requiredAmount: 15 } } })
    expect(await d.redeemGiftCode("GIFT")).toEqual({
      kind: "credit",
      creditedAmount: 5,
      newBonusBalance: 12,
      currency: "USD",
      wageringRequired: 15,
    })
    handler = () => refused(400, "This gift code can only be applied at checkout")
    expect(await d.redeemGiftCode("SAVE10")).toEqual({ kind: "discount", code: "SAVE10" })
  })
})

describe("depositErrorKey", () => {
  it("maps server reasons to stable copy keys", () => {
    expect(d.depositErrorKey(refused(409, "miniapp_method_disabled"), "card")).toBe("miniapp_method_disabled")
    expect(d.depositErrorKey(refused(400, "card_unavailable_region"), "card")).toBe("card_unavailable_region")
    expect(d.depositErrorKey(new ApiError(0, "network"), "crypto")).toBe("network")
    expect(d.depositErrorKey(refused(429, "slow down"), "crypto")).toBe("too_many_requests")
    expect(d.depositErrorKey(refused(500, "Remitation said no"), "crypto")).toBe("generic")
    expect(d.depositErrorKey(refused(400, "Could not activate voucher"), "voucher")).toBe("voucher_rejected")
    expect(d.depositErrorKey(new d.DepositRefused("card_gateway_unavailable"), "card")).toBe("card_gateway_unavailable")
    expect(d.depositErrorKey(new d.DepositRefused("unknown_key"), "card")).toBe("generic")
  })

  it("explains each gift code refusal", () => {
    const k = (code: number, msg: string) => d.depositErrorKey(refused(code, msg), "giftCode")
    expect(k(409, "Gift code has expired")).toBe("gift_expired")
    expect(k(409, "Gift code is not yet active")).toBe("gift_not_active")
    expect(k(409, "You have already used this gift code")).toBe("gift_used")
    expect(k(403, "Gift code is not assigned to you")).toBe("gift_not_yours")
    expect(k(404, "Gift code not found")).toBe("gift_not_found")
    expect(k(409, "Gift code batch is exhausted")).toBe("gift_unavailable")
    expect(k(400, "Unsupported credit effect")).toBe("gift_invalid")
  })
})
