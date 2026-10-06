/**
 * Wingo winners archive and draw detail, ported from wingobingo.tv:
 *
 * - list: `hooks/home/useGetRecentWinnersPreview.ts`, `WingoWinnerItem.tsx`
 * - filters: `WingoWinnersFilters.tsx`, `hooks/more/winners/useGetDrawTimes.ts`
 * - detail: `app/[lang]/(main)/more/winners/[gameId]/page.tsx`, `WingoWinnerDetail.tsx`
 * - tiers: `utils/wingoWinnerTiers.ts`; timeline: `utils/wingoGameTimeline.ts`
 */
import { replayUrlOf, toMs } from "./wingo"

export type WinnerEventType = "all" | "special" | "normal"

export const EVENT_TYPES: { id: WinnerEventType; label: string; short: string }[] = [
  { id: "all", label: "All events", short: "All" },
  { id: "special", label: "Special Live Show", short: "Live" },
  { id: "normal", label: "Normal Draws", short: "Normal" },
]

export type WinnerDraw = {
  gameId: string
  title: string
  imageUrl: string | null
  drawAtMs: number | null
  winners: number
  reward: number
  numbers: number[]
  lucky: number | null
  specialShow: boolean
  hostLabel: string | null
  accent: string
}

export type PrizeRow = {
  tier: string
  match: string
  count: number
  pool: number
  each: number
  rolledOver: boolean
  jackpot: boolean
}

export type TimelineEvent = { id: TimelineId; atMs: number }
export type TimelineId = "created" | "registration-open" | "registration-close" | "draw"

export const TIMELINE_COPY: Record<TimelineId, string> = {
  created: "Game created",
  "registration-open": "Registration opens",
  "registration-close": "Registration closes",
  draw: "Live draw",
}

export type WinnerDetail = {
  gameId: string
  title: string
  drawAtMs: number | null
  accent: string
  numbers: number[]
  lucky: number | null
  rows: PrizeRow[]
  winnersCount: number
  prize: number
  replayUrl: string | null
  timeline: TimelineEvent[]
  specialShow: boolean
  hostLabel: string | null
}

export type WinnerDetailResult = { locked: true } | { locked: false; detail: WinnerDetail }

/** Website detail `PRIZE_TIERS`: the nine levels in the order `winnersDetails` lists them. */
export const DETAIL_TIERS = [
  { tier: "Jackpot", match: "6 + 1" },
  { tier: "2nd", match: "6 + 0" },
  { tier: "3rd", match: "5 + 1" },
  { tier: "4th", match: "5 + 0" },
  { tier: "5th", match: "4 + 1" },
  { tier: "6th", match: "4 + 0" },
  { tier: "7th", match: "3 + 1" },
  { tier: "8th", match: "3 + 0" },
  { tier: "9th", match: "2+1 · 1+1 · 0+1" },
] as const

const LIST_ACCENT = "#F7941D"
const DETAIL_ACCENT = "#1b8faf"
const COLOR_RE = /^#[0-9a-f]{3,8}$/i
const HTTPS_RE = /^https:\/\//

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : ""
}

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function https(value: unknown): string | null {
  const s = str(value)
  return HTTPS_RE.test(s) ? s : null
}

/** `style` arrives as JSON, JSON inside a JSON string, or an object (website `safeJsonParse`). */
export function parseStyle(value: unknown): Record<string, unknown> {
  let parsed = value
  try {
    for (let i = 0; i < 3 && typeof parsed === "string"; i++) parsed = JSON.parse(parsed)
  } catch {
    return {}
  }
  return rec(parsed)
}

function color(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    const s = str(c)
    if (COLOR_RE.test(s)) return s
  }
  return null
}

/** Website `parseGameTimestamp`: seconds, ms, numeric strings or date strings → ms. */
export function timestampMs(value: unknown): number | null {
  if (typeof value === "number") return toMs(value)
  const s = str(value)
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) return toMs(Number(s))
  const ms = Date.parse(s)
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

function hostLabel(influencer: unknown): string | null {
  const i = rec(influencer)
  return str(i.name) || str(i.username) || null
}

/** One `/wingo/getWinners` item. The last winning number is the lucky ball. */
export function parseWinnerDraw(raw: unknown): WinnerDraw | null {
  const g = rec(raw)
  const gameId = str(g.id)
  if (!/^\d{1,12}$/.test(gameId)) return null
  const balls = (Array.isArray(g.winningNumbers) ? g.winningNumbers : [])
    .map((b) => num(rec(b).number))
    .filter((n) => Number.isInteger(n) && n > 0)
  const style = parseStyle(g.style)
  return {
    gameId,
    title: str(g.title) || str(g.name) || "Wingo",
    imageUrl: https(g.image) ?? https(g.backgroundImageUrl),
    drawAtMs: toMs(g.drawDate),
    winners: num(g.numberOfWinners),
    reward: num(g.reward),
    numbers: balls.slice(0, -1),
    lucky: balls.length > 0 ? (balls[balls.length - 1] ?? null) : null,
    specialShow: Number(g.tournamentType) === 1,
    hostLabel: hostLabel(g.influencer),
    accent: color(rec(style.colors).background, g.backgroundColor) ?? LIST_ACCENT,
  }
}

/** A page of winners, newest draw first (the website sorts each page the same way). */
export function parseWinnersPage(raw: unknown): { items: WinnerDraw[]; total: number | null } {
  const r = rec(raw)
  const items = (Array.isArray(r.data) ? r.data : [])
    .map(parseWinnerDraw)
    .filter((d): d is WinnerDraw => d !== null)
    .sort((a, b) => (b.drawAtMs ?? 0) - (a.drawAtMs ?? 0) || Number(b.gameId) - Number(a.gameId))
  const total = rec(r.meta).total
  return { items, total: typeof total === "number" && Number.isFinite(total) ? total : null }
}

/** `/getDrawTimes` → distinct UTC day starts (unix seconds), newest first. */
export function parseDrawDays(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : []
  const days = new Set<number>()
  for (const v of list) {
    const ms = toMs(v)
    if (ms == null) continue
    const d = new Date(ms)
    days.add(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000)
  }
  return [...days].sort((a, b) => b - a)
}

/** Website `normalizeWingoWinnerTiers` + `derivePrizeRows`. */
export function prizeRows(raw: unknown): PrizeRow[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item, index) => {
    const r = rec(item)
    const count = num(r.ticketCount ?? r.userCount ?? r.numberOfWinners)
    const placePool = num(r.placePool)
    const perTicket = num(r.prizePerTicket)
    const legacyTotal = num(r.totalPrize)
    const pool = placePool > 0 ? placePool : legacyTotal > 0 ? legacyTotal : perTicket
    const each = perTicket > 0 ? perTicket : count > 0 && pool > 0 ? pool / count : 0
    const meta = DETAIL_TIERS[index]
    const condition = str(r.condition).replace(/\s*\(.*\)\s*$/, "").trim()
    return {
      tier: meta?.tier ?? `#${index + 1}`,
      match: condition || meta?.match || "—",
      count,
      pool,
      each,
      rolledOver: r.rolledOver === true && count === 0,
      jackpot: index === 0,
    }
  })
}

/** Website `buildWingoGameTimelineEvents`: known steps in time order, one per moment. */
export function timeline(g: Record<string, unknown>): TimelineEvent[] {
  const steps: [TimelineId, unknown][] = [
    ["created", g.createdAt],
    ["registration-open", g.startTime],
    ["registration-close", g.finishTime],
    ["draw", g.drawTime],
  ]
  const seen = new Set<number>()
  return steps
    .map(([id, v]) => ({ id, atMs: timestampMs(v) }))
    .filter((e): e is TimelineEvent => e.atMs != null)
    .sort((a, b) => a.atMs - b.atMs)
    .filter((e) => {
      const second = Math.floor(e.atMs / 1000)
      if (seen.has(second)) return false
      seen.add(second)
      return true
    })
}

/** `/getGameDetails` for a Wingo draw, or the private-game lock. */
export function parseWinnerDetail(raw: unknown, gameId: string): WinnerDetailResult | null {
  const g = rec(raw)
  if (g.requiresPassword === true) return { locked: true }
  if (str(g.gameId) !== gameId) return null
  const style = parseStyle(g.style)
  const balls = (Array.isArray(g.winningNumbers) ? g.winningNumbers : []).map(num).filter((n) => Number.isInteger(n) && n > 0)
  const rows = prizeRows(g.winnersDetails)
  const declared = num(g.winnersCount)
  return {
    locked: false,
    detail: {
      gameId,
      title: str(g.title) || str(g.name) || "Wingo",
      drawAtMs: timestampMs(g.drawTime),
      accent: color(rec(style.colors).cardBackground, g.backgroundColor) ?? DETAIL_ACCENT,
      numbers: balls.length > 1 ? balls.slice(0, -1) : balls,
      lucky: balls.length > 1 ? (balls[balls.length - 1] ?? null) : null,
      rows,
      winnersCount: declared > 0 ? declared : rows.reduce((sum, r) => sum + r.count, 0),
      prize: num(g.reward) || num(g.totalPrizePool),
      replayUrl: replayUrlOf({ ...g, style }),
      timeline: timeline(g),
      specialShow: Number(g.tournamentType) === 1,
      hostLabel: hostLabel(g.influencer),
    },
  }
}
