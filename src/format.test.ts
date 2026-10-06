import { describe, expect, it } from "vitest"
import { formatDrawTime, formatMoney, toNumber } from "./format"
import { pickLanguage } from "./i18n"
import { routeFromStartParam } from "./navigation"

describe("formatMoney", () => {
  it("formats ISO currencies", () => {
    expect(formatMoney(12.5, "USD", "en")).toBe("$12.50")
  })

  it("keeps codes Intl does not know", () => {
    expect(formatMoney("3", "USDT", "en")).toBe("3 USDT")
  })

  it("treats junk as zero", () => {
    expect(toNumber("abc")).toBe(0)
    expect(toNumber(undefined)).toBe(0)
  })
})

describe("formatDrawTime", () => {
  it("is empty for a missing date", () => {
    expect(formatDrawTime(0, "en")).toBe("")
    expect(formatDrawTime(null, "fr")).toBe("")
  })

  it("reads Unix seconds", () => {
    expect(formatDrawTime(1_790_000_000, "en")).toContain("2026")
  })
})

describe("pickLanguage", () => {
  it("prefers the saved choice, then Telegram, then the default", () => {
    expect(pickLanguage("fa", "fr", "en")).toBe("fa")
    expect(pickLanguage(null, "fr-CA", "en")).toBe("fr")
    expect(pickLanguage(null, "de", "ar")).toBe("ar")
    expect(pickLanguage("xx", "", "en")).toBe("en")
  })
})

describe("routeFromStartParam", () => {
  it("opens game, live, winner and winners links", () => {
    expect(routeFromStartParam("wingo_4928")).toEqual({ name: "wingo", gameId: "4928" })
    expect(routeFromStartParam("live_4928")).toEqual({ name: "live", gameId: "4928" })
    expect(routeFromStartParam("winner_4928")).toEqual({ name: "winner", gameId: "4928" })
    expect(routeFromStartParam("winners")).toEqual({ name: "winners" })
  })

  it("ignores anything else", () => {
    expect(routeFromStartParam("winner_1&x")).toBeNull()
    expect(routeFromStartParam("profile")).toBeNull()
    expect(routeFromStartParam(undefined)).toBeNull()
  })
})
