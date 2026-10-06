import { describe, expect, it } from "vitest"
import {
  cartProblem,
  comboKey,
  countdown,
  drawPhase,
  gameStatus,
  hasLiveHost,
  isLivePageFinished,
  parseBalls,
  parseOwnedTickets,
  parseTicketRules,
  parseWingoGame,
  parseWingoGameResult,
  prizeTable,
  purchaseErrorKind,
  quote,
  randomDraft,
  replayUrlOf,
  setLucky,
  splitDrawn,
  timeLeft,
  toggleMain,
  uniqueRandomDraft,
  type TicketRules,
  type WingoGame,
} from "./wingo"

const RULES: TicketRules = { mainCount: 6, mainMin: 1, mainMax: 47, luckyMin: 1, luckyMax: 10, maxTicketsPerPurchase: 14 }
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0)
const sec = (ms: number) => Math.floor(ms / 1000)
const HOUR = 3_600_000

function game(over: Record<string, unknown> = {}): WingoGame {
  const g = parseWingoGame({
    gameId: 4928,
    name: "Friday Show",
    tournamentType: 1,
    drawDate: sec(NOW + 3 * HOUR),
    date: sec(NOW + 2 * HOUR),
    isTicketingOpen: true,
    ticketPrice: 2,
    totalPrizePool: 1500,
    ticketRules: RULES,
    ...over,
  })
  if (!g) throw new Error("fixture did not parse")
  return g
}

describe("parseWingoGame", () => {
  it("reads the website's fields", () => {
    const g = game({ mobileImageUrl: "https://cdn.example/m.jpg", tags: "special,mainlanding", freeTicketsRemaining: 1 })
    expect(g.gameId).toBe("4928")
    expect(g.special).toBe(true)
    expect(g.featured).toBe(true)
    expect(g.imageUrl).toBe("https://cdn.example/m.jpg")
    expect(g.drawAtMs).toBe(sec(NOW + 3 * HOUR) * 1000)
    expect(g.prizePool).toBe(1500)
    expect(g.freeTicketsRemaining).toBe(1)
    expect(g.ticketRules).toEqual(RULES)
  })

  it("prices each prize tier like the website and drops unknown tiers", () => {
    const g = game({
      prizeDistribution: [
        { name: "firstPlace", prize: 0, percentage: 50 },
        { name: "thirdPlace", prize: 40, percentage: 5 },
        { name: "bogus", prize: 9 },
      ],
    })
    expect(prizeTable(g)).toEqual([
      { name: "firstPlace", label: "Jackpot", mains: 6, lucky: true, prize: 750 },
      { name: "thirdPlace", label: "3rd", mains: 5, lucky: true, prize: 40 },
    ])
  })

  it("falls back to gross sales only when the pool is missing", () => {
    expect(game({ totalPrizePool: null, totalRegistrationAmount: 90 }).prizePool).toBe(90)
    expect(game({ totalPrizePool: 0, totalRegistrationAmount: 90 }).prizePool).toBe(0)
  })

  it("never trusts non-https images and numeric room ids", () => {
    const g = game({ mobileImageUrl: "javascript:alert(1)", icon: "http://x/y.png", streamingRoom: { roomId: "123" } })
    expect(g.imageUrl).toBeNull()
    expect(g.liveRoomId).toBeNull()
    expect(game({ streamingRoom: { roomId: "wingo-4928" } }).liveRoomId).toBe("wingo-4928")
  })

  it("rejects unusable ids and reports private locks", () => {
    expect(parseWingoGame({ gameId: "abc" })).toBeNull()
    expect(parseWingoGameResult({ gameId: 7, isPrivate: true, requiresPassword: true }, "7")).toEqual({ locked: true, gameId: "7" })
  })

  it("drops invalid ticket rules instead of guessing", () => {
    expect(parseTicketRules(undefined)).toBeNull()
    expect(parseTicketRules({ ...RULES, mainMax: 3 })).toBeNull()
    expect(parseTicketRules({ ...RULES, luckyMin: 0 })).toBeNull()
  })
})

describe("status and countdown (home-v2 rules)", () => {
  it("is open, then starting soon within 30 minutes of the close", () => {
    expect(gameStatus(game(), NOW)).toBe("registration_open")
    expect(gameStatus(game({ date: sec(NOW + 20 * 60_000) }), NOW)).toBe("starting_soon")
    expect(gameStatus(game({ startTime: new Date(NOW + 30 * 60_000).toISOString() }), NOW)).toBe("starting_soon")
  })

  it("goes live at draw time and only Cinema finalize ends a special", () => {
    const g = game({ drawDate: sec(NOW - 60_000), finished: 1 })
    expect(gameStatus(g, NOW)).toBe("live_now")
    expect(gameStatus(game({ cinemaFinalized: true }), NOW)).toBe("completed")
  })

  it("ends a normal game when the lottery is drawn", () => {
    expect(gameStatus(game({ tournamentType: 0, finished: 1 }), NOW)).toBe("completed")
    expect(gameStatus(game({ tournamentType: 0, cronStatus: 2 }), NOW)).toBe("completed")
  })

  it("is closed when ticketing is off before the draw", () => {
    expect(gameStatus(game({ isTicketingOpen: false }), NOW)).toBe("registration_closed")
  })

  it("counts down to the registration close, then the draw", () => {
    const g = game()
    expect(countdown(g, "registration_open", NOW)).toEqual({ kind: "registration_closes", targetMs: g.closeAtMs })
    expect(countdown(g, "registration_closed", NOW)).toEqual({ kind: "draw_starts", targetMs: g.drawAtMs })
    expect(countdown(g, "live_now", NOW).kind).toBe("none")
    expect(timeLeft(NOW + 90_061_000, NOW)).toMatchObject({ days: 1, hours: 1, minutes: 1, seconds: 1 })
    expect(timeLeft(NOW - 5, NOW).total).toBe(0)
  })

  it("opens the join window five minutes before the draw", () => {
    const g = game({ drawDate: sec(NOW + 4 * 60_000) })
    expect(drawPhase(game(), NOW)).toBe("sales")
    expect(drawPhase(g, NOW)).toBe("join")
    expect(drawPhase(game({ drawDate: sec(NOW - 1000) }), NOW)).toBe("drawn")
  })
})

describe("live page rules", () => {
  it("has a host for influencer specials and AI with an avatar only", () => {
    expect(hasLiveHost(game())).toBe(true)
    expect(hasLiveHost(game({ tournamentType: 0 }))).toBe(false)
    expect(hasLiveHost(game({ tournamentType: 0, aiEnabled: true, aiAvatarId: "a1" }))).toBe(true)
  })

  it("keeps a special on air until Cinema finalize even when cron drew it", () => {
    expect(isLivePageFinished(game({ finished: 1 }), NOW)).toBe(false)
    expect(isLivePageFinished(game({ cinemaFinalized: true }), NOW)).toBe(true)
    expect(isLivePageFinished(game({ tournamentType: 0, finished: 1 }), NOW)).toBe(true)
  })

  it("keeps an AI show open for its duration plus the buffer", () => {
    const ai = { tournamentType: 0, aiEnabled: true, aiAvatarId: "a1", finished: 1, aiDuration: "300" }
    expect(isLivePageFinished(game({ ...ai, drawDate: sec(NOW - 60_000) }), NOW)).toBe(false)
    expect(isLivePageFinished(game({ ...ai, drawDate: sec(NOW - HOUR) }), NOW)).toBe(true)
  })

  it("picks the replay like the website and never a wss room URL", () => {
    expect(replayUrlOf({ streamingRoom: { url: "wss://x.livekit.cloud", recordingUrl: "https://cdn/r.mp4" } })).toBe("https://cdn/r.mp4")
    expect(replayUrlOf({ liveVideoUrl: "https://youtu.be/abcdefghijk" })).toBe("https://youtu.be/abcdefghijk")
    expect(replayUrlOf({})).toBeNull()
  })

  it("parses draw balls and splits mains from the lucky number", () => {
    expect(parseBalls('["4","17","5🍀"]')).toEqual([4, 17, 5])
    expect(parseBalls("not json")).toEqual([])
    expect(splitDrawn([1, 2, 3, 4, 5, 6, 9], 6)).toEqual({ mains: [1, 2, 3, 4, 5, 6], lucky: 9 })
    expect(splitDrawn([1, 2], 6)).toEqual({ mains: [1, 2], lucky: null })
  })
})

describe("tickets", () => {
  it("prices free tickets first, like checkout", () => {
    expect(quote(3, 2.5, 1)).toEqual({ count: 3, freeCount: 1, gross: 7.5, payable: 5 })
    expect(quote(1, 2.5, 4)).toEqual({ count: 1, freeCount: 1, gross: 2.5, payable: 0 })
  })

  it("keeps picks inside the game's rules", () => {
    let d = { numbers: [] as number[], lucky: null as number | null }
    for (const n of [5, 1, 9, 47, 30, 2, 8]) d = toggleMain(d, n, RULES)
    expect(d.numbers).toEqual([1, 2, 5, 9, 30, 47])
    expect(toggleMain(d, 5, RULES).numbers).toEqual([1, 2, 9, 30, 47])
    expect(toggleMain({ numbers: [], lucky: null }, 48, RULES).numbers).toEqual([])
    expect(setLucky(d, 11, RULES).lucky).toBeNull()
    expect(setLucky(d, 7, RULES).lucky).toBe(7)
  })

  it("quick-picks six unique numbers and a lucky number in range", () => {
    for (let i = 0; i < 50; i++) {
      const d = randomDraft(RULES)
      expect(new Set(d.numbers).size).toBe(6)
      expect(d.numbers.every((n) => n >= 1 && n <= 47)).toBe(true)
      expect(d.lucky).toBeGreaterThanOrEqual(1)
      expect(d.lucky).toBeLessThanOrEqual(10)
    }
  })

  it("avoids taken combinations when quick-picking", () => {
    const first = randomDraft(RULES, () => 0)
    const taken = new Set([comboKey(first.numbers, first.lucky as number)])
    let calls = 0
    const next = uniqueRandomDraft(RULES, taken, () => (calls++ < 7 ? 0 : 0.5))
    expect(comboKey(next.numbers, next.lucky as number)).not.toBe(comboKey(first.numbers, first.lucky as number))
  })

  it("blocks incomplete, duplicate and already-owned tickets", () => {
    const a = { numbers: [1, 2, 3, 4, 5, 6], lucky: 7 }
    expect(cartProblem([], [], RULES)).toBe("Add at least one ticket")
    expect(cartProblem([{ numbers: [1], lucky: 2 }], [], RULES)).toBe("Please pick all numbers and a lucky number")
    expect(cartProblem([a, { numbers: [6, 5, 4, 3, 2, 1], lucky: 7 }], [], RULES)).toBe(
      "This selection includes a duplicate number combination",
    )
    expect(cartProblem([a], [{ numbers: [6, 5, 4, 3, 2, 1], lucky: 7 }], RULES)).toBe("You already have this number combination")
    expect(cartProblem([a, { ...a, lucky: 8 }], [], RULES)).toBeNull()
  })

  it("reads owned tickets and skips junk", () => {
    expect(parseOwnedTickets([{ numbers: [1, 2, 3, 4, 5, 6], chanceNumber: 3, isPaid: true }, { numbers: "x" }, null])).toEqual([
      { numbers: [1, 2, 3, 4, 5, 6], lucky: 3 },
    ])
    expect(parseOwnedTickets({ requiresPassword: true })).toEqual([])
  })

  it("maps purchase failures like the website", () => {
    expect(purchaseErrorKind({ status: 400, code: 4501, msg: "" })).toBe("insufficient")
    expect(purchaseErrorKind({ status: 400, code: 4504, msg: "" })).toBe("gone")
    expect(purchaseErrorKind({ status: 409, code: 409, msg: "You already have this number combination" })).toBe("owned")
    expect(purchaseErrorKind({ status: 400, code: 400, msg: "Ticketing is closed for this game" })).toBe("closed")
    expect(purchaseErrorKind({ status: 403, code: 403, msg: "" })).toBe("private")
    expect(purchaseErrorKind({ status: 400, code: 400, msg: "Main numbers must be between 1 and 47" })).toBe("generic")
  })
})
