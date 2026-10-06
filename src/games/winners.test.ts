import { describe, expect, it } from "vitest"
import { parseDrawDays, parseStyle, parseWinnerDetail, parseWinnersPage, prizeRows, timeline } from "./winners"

const balls = (...n: number[]) => n.map((number, i) => ({ number, isLucky: i === n.length - 1 }))

describe("winners list", () => {
  it("reads a live /wingo/getWinners item", () => {
    const page = parseWinnersPage({
      data: [
        {
          id: 15757,
          title: "Daily 15 Minutes",
          image: "https://cdn.example/icon.png",
          style: JSON.stringify(JSON.stringify({ colors: { background: "#8c60c3" } })),
          backgroundColor: "#31CCEC",
          reward: 100,
          numberOfWinners: 0,
          drawDate: 1791324921,
          tournamentType: 2,
          influencer: null,
          winningNumbers: balls(3, 9, 22, 26, 42, 47, 8),
        },
      ],
      meta: { total: 15329, page: 1, count: 10 },
    })
    expect(page.total).toBe(15329)
    expect(page.items[0]).toMatchObject({
      gameId: "15757",
      numbers: [3, 9, 22, 26, 42, 47],
      lucky: 8,
      accent: "#8c60c3",
      reward: 100,
      specialShow: false,
      drawAtMs: 1791324921000,
    })
  })

  it("sorts newest draw first, then highest id, and drops bad rows", () => {
    const { items } = parseWinnersPage({
      data: [
        { id: 1, drawDate: 100 },
        { id: 3, drawDate: 200 },
        { id: 2, drawDate: 200 },
        { id: "x", drawDate: 300 },
      ],
    })
    expect(items.map((d) => d.gameId)).toEqual(["3", "2", "1"])
  })

  it("labels a special show with its host and ignores unsafe colours and images", () => {
    const { items } = parseWinnersPage({
      data: [
        {
          id: 9,
          tournamentType: 1,
          influencer: { name: "", username: "@host" },
          style: '{"colors":{"background":"red;x:url(y)"}}',
          image: "javascript:alert(1)",
        },
      ],
    })
    expect(items[0]).toMatchObject({ specialShow: true, hostLabel: "@host", accent: "#F7941D", imageUrl: null })
  })
})

describe("draw days", () => {
  it("keeps distinct UTC days, newest first", () => {
    expect(parseDrawDays([1791244800, 1791244800 + 3600, 1793145600, "bad"])).toEqual([1793145600, 1791244800])
  })
})

describe("prize breakdown", () => {
  it("normalizes the settlement shape like the website", () => {
    const rows = prizeRows([
      { place: 1, condition: "6 + 1 (jackpot)", ticketCount: 0, placePool: 1000, rolledOver: true },
      { place: 2, ticketCount: 4, placePool: 200 },
      { place: 3, userCount: 2, prizePerTicket: 30 },
    ])
    expect(rows[0]).toEqual({ tier: "Jackpot", match: "6 + 1", count: 0, pool: 1000, each: 0, rolledOver: true, jackpot: true })
    expect(rows[1]).toMatchObject({ tier: "2nd", match: "6 + 0", count: 4, pool: 200, each: 50, rolledOver: false })
    expect(rows[2]).toMatchObject({ tier: "3rd", count: 2, pool: 30, each: 30 })
  })

  it("is empty when the draw has no settlement", () => {
    expect(prizeRows(null)).toEqual([])
  })
})

describe("winner detail", () => {
  it("unwraps double-encoded style", () => {
    expect(parseStyle('"{\\"colors\\":{\\"cardBackground\\":\\"#123456\\"}}"')).toEqual({ colors: { cardBackground: "#123456" } })
    expect(parseStyle("not json")).toEqual({})
  })

  it("orders the timeline and drops missing or repeated moments", () => {
    const events = timeline({
      createdAt: "2026-10-05 18:44:01",
      startTime: 1791000000,
      finishTime: "1791500000",
      drawTime: "1791500000",
    })
    expect(events.map((e) => e.id)).toEqual(["registration-open", "created", "registration-close"])
  })

  it("reads /getGameDetails, with the lock for private games", () => {
    expect(parseWinnerDetail({ gameId: "7", isPrivate: true, requiresPassword: true }, "7")).toEqual({ locked: true })
    expect(parseWinnerDetail({ gameId: "8" }, "7")).toBeNull()

    const result = parseWinnerDetail(
      {
        gameId: 15616,
        title: "Wingo by Sahand",
        tournamentType: 1,
        influencer: { name: "Sahand" },
        winningNumbers: [1, 2, 3, 4, 5, 6, 9],
        winnersDetails: [{ place: 1, ticketCount: 1, placePool: 500 }],
        winnersCount: 0,
        totalPrizePool: 2000,
        drawTime: "2026-10-11 18:00:00",
        style: JSON.stringify({ liveVideoUrl: "https://cdn.example/replay.mp4" }),
      },
      "15616",
    )
    if (!result || result.locked) throw new Error("expected a detail")
    expect(result.detail).toMatchObject({
      numbers: [1, 2, 3, 4, 5, 6],
      lucky: 9,
      winnersCount: 1,
      prize: 2000,
      specialShow: true,
      hostLabel: "Sahand",
      replayUrl: "https://cdn.example/replay.mp4",
    })
  })
})
