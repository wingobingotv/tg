import { describe, expect, it } from "vitest"
import { gameUrl, type GameCard } from "./data"
import { formatDrawTime, formatMoney, toNumber } from "./format"
import { pickLanguage } from "./i18n"

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

describe("gameUrl", () => {
  const base: GameCard = {
    key: "k",
    kind: "wingo",
    gameId: "17",
    title: "",
    imageUrl: null,
    ticketPrice: 1,
    prizePool: 1,
    drawDate: 0,
  }

  it("matches the website routes", () => {
    expect(gameUrl("https://wingobingo.tv", "fa", base)).toBe("https://wingobingo.tv/fa/wingo/17")
    expect(
      gameUrl("https://wingobingo.tv", "en", { ...base, kind: "bingo", gameId: "66ab", bingoMode: "offline" }),
    ).toBe("https://wingobingo.tv/en/bingo/offline?gameId=66ab")
  })

  it("encodes the game id", () => {
    expect(gameUrl("https://wingobingo.tv", "en", { ...base, gameId: "1/../x" })).toBe(
      "https://wingobingo.tv/en/wingo/1%2F..%2Fx",
    )
  })
})
