import { parseBall, parseBalls, parseWinnerTiers, type WinnerTier } from "../games/wingo"
import { isCinematicFxEvent, type CinematicFxEvent } from "./fx/cinematic-fx"
import { isLuckyNumberEvent, type LuckyNumberEvent } from "./fx/lucky-number"

/**
 * LiveKit data messages the viewer acts on, as the website's live page and
 * `OverlayContainer` handle them (`live/wingo/[gameId]/page.tsx`,
 * `workers/wingo-live-worker.ts`):
 *
 * - `winner-bubble` with digits: one more drawn ball (`isLucky` marks the lucky one)
 * - `winner-bubble` with text: a winner name bubble
 * - `numbers-history`: the full list; a shorter list never replaces a longer one
 * - `clear-numbers`: reset the board
 * - `draw-finalized`: results exist, re-read the game; may carry `winnersDetails`
 * - `program-source-change`: CINEMATIC ↔ INFLUENCER_LIVE, newest version wins
 * - `news-announcement`: ticker text
 * - `show-awards`: level pools the studio puts on screen
 * - `cinematic-fx` / `lucky-number`: operator celebration and lucky reveal
 */

export type ProgramSource = "CINEMATIC" | "INFLUENCER_LIVE"

export type Award = { combination: string; prize: number }

export type LiveEvent =
  | { kind: "ball"; ball: number; lucky?: boolean; startAt?: number }
  | { kind: "history"; balls: number[] }
  | { kind: "clear" }
  | { kind: "finalized"; winners?: WinnerTier[] }
  | { kind: "program"; source: ProgramSource; version: number }
  | { kind: "news"; text: string }
  | { kind: "winner"; text: string }
  | { kind: "awards"; awards: Award[] }
  | { kind: "fx"; event: CinematicFxEvent }
  | { kind: "lucky_reveal"; event: LuckyNumberEvent }

const MAX_TEXT = 280
const MAX_AWARDS = 12

export function decodeLiveMessage(payload: Uint8Array): LiveEvent | null {
  let msg: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(payload))
    if (!parsed || typeof parsed !== "object") return null
    msg = parsed as Record<string, unknown>
  } catch {
    return null
  }
  if (isCinematicFxEvent(msg)) return { kind: "fx", event: msg }
  if (isLuckyNumberEvent(msg)) return { kind: "lucky_reveal", event: msg }
  switch (msg.type) {
    case "winner-bubble": {
      const text = typeof msg.text === "string" ? msg.text.trim() : ""
      const ball = parseBall(text)
      if (ball != null) {
        const event: LiveEvent = { kind: "ball", ball }
        if (msg.isLucky === true) event.lucky = true
        if (typeof msg.startAt === "number" && Number.isFinite(msg.startAt)) event.startAt = msg.startAt
        return event
      }
      return text ? { kind: "winner", text: text.slice(0, MAX_TEXT) } : null
    }
    case "numbers-history":
      return Array.isArray(msg.numbers) ? { kind: "history", balls: parseBalls(msg.numbers) } : null
    case "clear-numbers":
      return { kind: "clear" }
    case "draw-finalized": {
      const winners = parseWinnerTiers(msg.winnersDetails)
      return winners.length ? { kind: "finalized", winners } : { kind: "finalized" }
    }
    case "show-awards": {
      if (!Array.isArray(msg.awards)) return null
      const awards = msg.awards
        .map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>) : {}))
        .map((a) => ({ combination: typeof a.combination === "string" ? a.combination.trim().slice(0, 24) : "", prize: Number(a.prize) }))
        .filter((a) => a.combination && Number.isFinite(a.prize))
        .slice(0, MAX_AWARDS)
      return awards.length ? { kind: "awards", awards } : null
    }
    case "program-source-change":
      return {
        kind: "program",
        source: msg.source === "CINEMATIC" ? "CINEMATIC" : "INFLUENCER_LIVE",
        version: typeof msg.programVersion === "number" ? msg.programVersion : 0,
      }
    case "news-announcement":
      return typeof msg.text === "string" && msg.text.trim() ? { kind: "news", text: msg.text.trim().slice(0, MAX_TEXT) } : null
    default:
      return null
  }
}

/** Drawn balls as the website's live worker keeps them: unique mains, then the lucky ball. */
export type Board = { mains: number[]; lucky: number | null }

export const EMPTY_BOARD: Board = { mains: [], lucky: null }

const boardSize = (b: Board) => b.mains.length + (b.lucky != null ? 1 : 0)

function boardFrom(balls: readonly number[], mainCount: number): Board {
  const mains: number[] = []
  let lucky: number | null = null
  for (const n of balls) {
    if (!Number.isFinite(n)) continue
    if (mains.length < mainCount) {
      if (!mains.includes(n)) mains.push(n)
    } else {
      lucky = n
    }
  }
  return { mains, lucky }
}

/** Board after one event (`pushNumber` / `bulkReset` / `resetNumbers`). */
export function nextBoard(board: Board, event: LiveEvent, mainCount: number): Board {
  switch (event.kind) {
    case "ball":
      if (board.mains.length < mainCount) {
        return board.mains.includes(event.ball) ? board : { mains: [...board.mains, event.ball], lucky: board.lucky }
      }
      return board.lucky === event.ball ? board : { mains: board.mains, lucky: event.ball }
    case "history": {
      const next = boardFrom(event.balls, mainCount)
      return boardSize(next) < boardSize(board) ? board : next
    }
    case "clear":
      return EMPTY_BOARD
    default:
      return board
  }
}

/** Live board and the API's `result` converge: the fuller one wins, like the site's poll. */
export function mergedBoard(live: Board, apiResult: readonly number[], mainCount: number): Board {
  const api = boardFrom(apiResult, mainCount)
  return boardSize(live) >= boardSize(api) ? live : api
}

export function boardBalls(board: Board): number[] {
  return board.lucky != null ? [...board.mains, board.lucky] : [...board.mains]
}

/** `room.metadata` → the program source the room was in when we joined. */
export function programFromMetadata(metadata: string | undefined): { source: ProgramSource; version: number } | null {
  if (!metadata) return null
  try {
    const m = JSON.parse(metadata) as Record<string, unknown>
    const out = (m.programOutput && typeof m.programOutput === "object" ? m.programOutput : {}) as Record<string, unknown>
    if (!out.activeProgramSource) return null
    return {
      source: out.activeProgramSource === "CINEMATIC" ? "CINEMATIC" : "INFLUENCER_LIVE",
      version: typeof out.programVersion === "number" ? out.programVersion : 0,
    }
  } catch {
    return null
  }
}
