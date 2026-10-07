/**
 * Wingo game rules ported from wingobingo.tv, so the Mini App shows the same
 * status, countdown, price and live state as the website for the same game:
 *
 * - status / countdown: `WingoBingo/src/utils/home-v2/normalize.ts`
 *   (`resolveHomeGameStatus`, `resolveCountdown`)
 * - hosted shows: `home-v2/compose.ts` (`isHostedShow`, `hostedSort`)
 * - prize pool: `utils/wingoPrizePool.ts`
 * - free tickets: `utils/gameFreeTickets.ts`
 * - ticket identity: `utils/wingoTicketCombo.ts`
 * - draw phase: `hooks/wingo/useDrawPhase.ts`
 * - live page: `utils/specialLiveShow.ts`, `utils/winnerDrawVideo.ts`
 *
 * Ticket ranges and limits are not copied: they come from the game payload
 * (`ticketRules`, set by the Player API from the same constants it validates with).
 */

export type TicketRules = {
  mainCount: number
  mainMin: number
  mainMax: number
  luckyMin: number
  luckyMax: number
  maxTicketsPerPurchase: number
}

export type PrizeTier = { name: string; prize: number; percentage: number }

/** Website `HomeGameFormat` for Wingo: how often a game runs, or that it is a hosted show. */
export type WingoFormat = "special" | "every_15_min" | "hourly" | "daily" | "live" | "scheduled"

export type WingoGame = {
  gameId: string
  name: string
  /** Home classification: special format, including landing-featured games. */
  special: boolean
  /** Stored type only (`tournamentType === 1`), as the website's live-page rules use. */
  specialShow: boolean
  featured: boolean
  format: WingoFormat
  /** Same key for every occurrence of one automated schedule (website `recurrenceKey`). */
  recurrenceKey: string
  imageUrl: string | null
  heroUrl: string | null
  drawAtMs: number | null
  closeAtMs: number | null
  startAtMs: number | null
  isTicketingOpen: boolean
  ticketPrice: number
  prizePool: number
  prizeTiers: PrizeTier[]
  freeTicketsRemaining: number
  rawStatus: string
  finished: number
  cronStatus: number
  cinemaFinalized: boolean
  result: number[]
  liveRoomId: string | null
  streamingStatus: string
  aiEnabled: boolean
  aiAvatar: boolean
  aiDurationSec: number
  isLiveChatEnabled: boolean
  presenterName: string | null
  presenterImageUrl: string | null
  replayUrl: string | null
  ticketRules: TicketRules | null
  /** Settlement snapshot (`winnersDetails`); empty until the draw is finalized. */
  winners: WinnerTier[]
}

/**
 * One settled level, as the website's `normalizeWingoWinnerTiers` reads it:
 * how many tickets won it, its pool, and what one winning ticket is paid.
 */
export type WinnerTier = {
  name: string | null
  condition: string
  winners: number
  pool: number
  perTicket: number
}

export type WingoGameResult = { locked: true; gameId: string } | { locked: false; game: WingoGame }

export type GameStatus =
  | "cancelled"
  | "temporarily_unavailable"
  | "completed"
  | "live_now"
  | "result_being_announced"
  | "starting_soon"
  | "registration_open"
  | "registration_closed"
  | "scheduled"

export type CountdownKind = "registration_closes" | "draw_starts" | "game_starts" | "none"

export type OwnedTicket = { numbers: number[]; lucky: number }

const HTTPS_RE = /^https:\/\//
const MINUTE = 60_000
const JOIN_WINDOW_MS = 5 * MINUTE
const DEFAULT_AI_DURATION_SEC = 300
const AI_SHOW_BUFFER_SEC = 120
const MAX_FREE = 99

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN
  return Number.isFinite(n) ? n : 0
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : ""
}

function https(value: unknown): string | null {
  const s = str(value)
  return HTTPS_RE.test(s) ? s : null
}

/** Unix seconds or ms from the API → ms; null when missing. */
export function toMs(value: unknown): number | null {
  const n = num(value)
  if (n <= 0) return null
  return n > 1e12 ? n : n * 1000
}

function dateMs(value: unknown): number | null {
  if (typeof value === "number") return toMs(value)
  const s = str(value)
  if (!s) return null
  const ms = Date.parse(s)
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

function tagged(tags: string, tag: string): boolean {
  return new RegExp(`(^|[,\\s])${tag}([,\\s]|$)`).test(tags)
}

/** Digits from a draw token (`"14"`, `14`, `"5🍀"`). */
export function parseBall(raw: unknown): number | null {
  const m = /(\d+)/.exec(String(raw ?? ""))
  if (!m?.[1]) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** Lotto `result` / LiveKit `numbers-history`: JSON array or array → balls. */
export function parseBalls(raw: unknown): number[] {
  if (raw == null) return []
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    return parsed.map(parseBall).filter((n): n is number => n != null)
  } catch {
    return []
  }
}

export function parseTicketRules(value: unknown): TicketRules | null {
  const r = rec(value)
  const rules = {
    mainCount: num(r.mainCount),
    mainMin: num(r.mainMin),
    mainMax: num(r.mainMax),
    luckyMin: num(r.luckyMin),
    luckyMax: num(r.luckyMax),
    maxTicketsPerPurchase: num(r.maxTicketsPerPurchase),
  }
  const ints = Object.values(rules).every((n) => Number.isInteger(n) && n > 0)
  const sane =
    rules.mainMax - rules.mainMin + 1 >= rules.mainCount &&
    rules.mainMax <= 99 &&
    rules.luckyMax >= rules.luckyMin &&
    rules.luckyMax <= 99 &&
    rules.maxTicketsPerPurchase <= 100
  return ints && sane ? rules : null
}

/** Mirrors `resolveWinnerDrawVideoUrl`: first https video or YouTube link, never a wss room URL. */
export function replayUrlOf(g: Record<string, unknown>): string | null {
  const assets = rec(g.assets)
  const live = rec(assets.liveVideo)
  const room = rec(g.streamingRoom)
  const style = rec(g.style)
  const candidates = [
    g.liveVideoUrl,
    live.cloudUrl,
    live.url,
    g.videoUrl,
    room.recordingUrl,
    room.url,
    style.liveVideoUrl,
    rec(style.videoUrls).fa,
  ]
  for (const c of candidates) {
    const url = https(c)
    if (url) return url
  }
  return null
}

const YOUTUBE_RE = /^https:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//

export function isYouTubeUrl(url: string): boolean {
  return YOUTUBE_RE.test(url)
}

/**
 * Website `detectGameFormat` for Wingo. Cadence tags win over a room: the
 * automated daily, hourly and 15-minute games also get a `wingo-N` room.
 */
export function detectWingoFormat(tags: string, title: string, special: boolean, hasRoom: boolean): WingoFormat {
  const blob = `${tags} ${title.toLowerCase()}`
  const has = (...needles: string[]) => needles.some((n) => tags.includes(n))
  if (special || has("special")) return "special"
  if (has("15min", "15-min", "every15", "15_min", "15mins") || /\bevery\s*15\b/.test(blob) || /\b15\s*mins?\b/.test(blob)) {
    return "every_15_min"
  }
  if (
    has("hourly", "everyhour", "60mins", "60min") ||
    /\bevery\s*60\b/.test(blob) ||
    /\b60\s*mins?\b/.test(blob) ||
    /\b1\s*hour\b/.test(blob) ||
    /\bevery\s*hour\b/.test(blob)
  ) {
    return "hourly"
  }
  if (has("daily", "24h", "24-hour", "every_day", "24hours") || /\bevery\s*day\b/.test(blob) || /\b24\s*hours?\b/.test(blob)) {
    return "daily"
  }
  return hasRoom ? "live" : "scheduled"
}

/** Website `recurrenceKey`: first three tags, else the start of the title. */
export function recurrenceKey(format: WingoFormat, tags: string, title: string): string {
  const tagPart = tags.split(/[,\s]+/).filter(Boolean).slice(0, 3).join("_")
  const titlePart = title.trim().toLowerCase().slice(0, 24).replace(/\s+/g, "_")
  return `wingo:${format}:${tagPart || titlePart || "default"}`
}

/** One `/wingo/getTournaments` item → the fields the Mini App uses. */
export function parseWingoGame(raw: unknown): WingoGame | null {
  const g = rec(raw)
  const gameId = str(g.gameId)
  if (!/^\d{1,12}$/.test(gameId)) return null
  const tags = str(g.tags).toLowerCase()
  const room = rec(g.streamingRoom)
  const roomId = str(room.roomId)
  const liveRoomId = roomId && !/^\d+$/.test(roomId) ? roomId : null
  const name = str(g.name) || "Wingo"
  const featured = tagged(tags, "mainlanding")
  const specialShow = Number(g.tournamentType) === 1
  const detected = detectWingoFormat(tags, name, specialShow, liveRoomId !== null)
  const format: WingoFormat = featured && detected !== "live" ? "special" : detected
  const influencer = rec(g.influencer)
  const aiEnabled = g.aiEnabled === true
  const aiAvatar = aiEnabled && Boolean(str(g.aiAvatarId) || str(g.aiAvatarImageUrl))
  const pool = g.totalPrizePool
  const prizePool =
    pool !== undefined && pool !== null && str(pool) !== "" && Number.isFinite(Number(pool))
      ? Number(pool)
      : num(g.totalRegistrationAmount)
  const tiers = Array.isArray(g.prizeDistribution) ? g.prizeDistribution : []
  const aiDuration = Number.parseInt(str(g.aiDuration), 10)

  return {
    gameId,
    name,
    special: format === "special",
    specialShow,
    featured,
    format,
    recurrenceKey: recurrenceKey(format, tags, name),
    imageUrl: https(g.mobileImageUrl) ?? https(g.icon),
    heroUrl: https(g.desktopImageUrl) ?? https(g.backgroundImageUrl) ?? https(g.mobileImageUrl),
    drawAtMs: toMs(g.drawDate),
    closeAtMs: toMs(g.date),
    startAtMs: dateMs(g.startTime),
    isTicketingOpen: g.isTicketingOpen !== false,
    ticketPrice: num(g.ticketPrice),
    prizePool,
    prizeTiers: tiers
      .map((t) => rec(t))
      .map((t) => ({ name: str(t.name), prize: num(t.prize), percentage: num(t.percentage) }))
      .filter((t) => t.name in PRIZE_TIERS),
    freeTicketsRemaining: Math.min(Math.max(Math.floor(num(g.freeTicketsRemaining ?? g.freeTicketCount)), 0), MAX_FREE),
    rawStatus: str(g.status).toLowerCase(),
    finished: num(g.finished),
    cronStatus: num(g.cronStatus),
    cinemaFinalized: g.cinemaFinalized === true,
    result: parseBalls(g.result),
    liveRoomId,
    streamingStatus: str(room.status).toLowerCase(),
    aiEnabled,
    aiAvatar,
    aiDurationSec: Number.isFinite(aiDuration) && aiDuration > 0 ? Math.min(aiDuration, 600) : DEFAULT_AI_DURATION_SEC,
    isLiveChatEnabled: g.isLiveChatEnabled === true,
    presenterName: aiEnabled ? null : str(influencer.name) || str(influencer.username) || null,
    presenterImageUrl: aiEnabled
      ? https(g.aiAvatarImageUrl)
      : https(influencer.profileImageUrl) ?? https(influencer.imageUrl) ?? https(influencer.avatar),
    replayUrl: replayUrlOf(g),
    ticketRules: parseTicketRules(g.ticketRules),
    winners: parseWinnerTiers(g.winnersDetails),
  }
}

/** Places in draw order, which is also the order of `PRIZE_TIERS` (website `WINGO_PLACE_NAMES`). */
const PLACE_NAMES = [
  "firstPlace",
  "secondPlace",
  "thirdPlace",
  "fourthPlace",
  "fifthPlace",
  "sixthPlace",
  "seventhPlace",
  "eighthPlace",
] as const

/**
 * `winnersDetails` from the game or from `draw-finalized`. Writers differ: the
 * cron names a tier by `place` and stores only the pot and the winner count,
 * Studio adds `prizePerTicket`, so the share is recovered when it is missing.
 */
export function parseWinnerTiers(raw: unknown): WinnerTier[] {
  let list: unknown = raw
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  return list.map((item) => {
    const t = rec(item)
    const winners = num(t.ticketCount ?? t.userCount ?? t.numberOfWinners)
    const pool = num(t.placePool) || num(t.totalPrize) || num(t.prizePerTicket)
    const share = num(t.prizePerTicket)
    const place = num(t.place)
    const named = str(t.name)
    return {
      name: named || (place >= 1 && place <= PLACE_NAMES.length ? (PLACE_NAMES[place - 1] ?? null) : null),
      condition: str(t.condition),
      winners,
      pool,
      perTicket: share > 0 ? share : winners > 0 && pool > 0 ? pool / winners : 0,
    }
  })
}

export function winnersByName(tiers: readonly WinnerTier[]): Map<string, WinnerTier> {
  const byName = new Map<string, WinnerTier>()
  for (const tier of tiers) if (tier.name) byName.set(tier.name, tier)
  return byName
}

export function totalWinners(tiers: readonly WinnerTier[]): number {
  return tiers.reduce((sum, tier) => sum + tier.winners, 0)
}

/** A level the player's tickets have reached (website `QualifiedLevel`). */
export type QualifiedLevel = {
  name: string
  label: string
  mains: number
  lucky: boolean
  /** The whole pool for the level, before it is divided between winners. */
  pool: number
  /** How many of the player's tickets reached it. */
  tickets: number
  /** Known only once the draw is settled. */
  winners: number | null
  /** The player's settled payout for this level; null until settled. */
  confirmed: number | null
}

export type DrawnBoard = { mains: readonly number[]; lucky: number | null }

/**
 * Levels the player is in, by the website live page's rule: before the lucky
 * ball only plain levels with an exact main count count; after it, a lucky
 * level needs the lucky number and a plain level needs it to miss. Reports
 * pools, never a per-player amount, until the settlement snapshot exists.
 */
export function qualifiedLevels(g: WingoGame, board: DrawnBoard, owned: readonly OwnedTicket[]): QualifiedLevel[] {
  const mainCount = g.ticketRules?.mainCount ?? 6
  const luckyDrawn = board.mains.length >= mainCount && board.lucky != null && board.lucky !== 0
  const settled = winnersByName(g.winners)
  return prizeTable(g).flatMap((tier) => {
    const tickets = owned.filter((ticket) => {
      const matched = board.mains.filter((n) => ticket.numbers.includes(n)).length
      if (matched < tier.mains) return false
      if (luckyDrawn) {
        const hit = board.lucky === ticket.lucky
        return tier.lucky === hit && matched === tier.mains
      }
      return !tier.lucky && matched === tier.mains
    }).length
    if (tickets === 0 || !(tier.prize > 0)) return []
    const s = settled.get(tier.name)
    return [
      {
        name: tier.name,
        label: tier.label,
        mains: tier.mains,
        lucky: tier.lucky,
        pool: tier.prize,
        tickets,
        winners: s ? s.winners : null,
        confirmed: s ? s.perTicket * tickets : null,
      },
    ]
  })
}

export type TicketOutcome = {
  matched: number
  luckyHit: boolean
  /** The `PRIZE_TIERS` key this ticket reaches, if any. */
  tier: string | null
  state: "pending" | "in_prize" | "won" | "no_prize"
  /** Settled share; 0 before settlement. */
  prize: number
}

/**
 * One ticket against the draw (website `getWingoTicketOutcome`). The prize is
 * only ever the settled share: a level's configured amount is its pool.
 */
export function ticketOutcome(g: WingoGame, board: DrawnBoard, ticket: OwnedTicket): TicketOutcome {
  const matched = board.mains.filter((n) => ticket.numbers.includes(n)).length
  const luckyHit = board.lucky != null && board.lucky === ticket.lucky
  if (board.mains.length === 0) return { matched, luckyHit, tier: null, state: "pending", prize: 0 }
  const tier = Object.entries(PRIZE_TIERS).find(([, cfg]) => cfg.mains === matched && cfg.lucky === luckyHit)?.[0] ?? null
  const drawComplete = board.lucky != null
  if (g.winners.length > 0) {
    const s = tier ? winnersByName(g.winners).get(tier) : undefined
    const prize = s && s.winners > 0 ? s.perTicket : 0
    return { matched, luckyHit, tier, state: prize > 0 ? "won" : drawComplete ? "no_prize" : "pending", prize }
  }
  if (tier) return { matched, luckyHit, tier, state: "in_prize", prize: 0 }
  return { matched, luckyHit, tier, state: drawComplete ? "no_prize" : "pending", prize: 0 }
}

/** Website `prizeDistConfig`: what each tier needs. Labels are translated copy. */
export const PRIZE_TIERS: Record<string, { label: string; mains: number; lucky: boolean }> = {
  firstPlace: { label: "Jackpot", mains: 6, lucky: true },
  secondPlace: { label: "2nd", mains: 6, lucky: false },
  thirdPlace: { label: "3rd", mains: 5, lucky: true },
  fourthPlace: { label: "4th", mains: 5, lucky: false },
  fifthPlace: { label: "5th", mains: 4, lucky: true },
  sixthPlace: { label: "6th", mains: 4, lucky: false },
  seventhPlace: { label: "7th", mains: 3, lucky: true },
  eighthPlace: { label: "8th", mains: 3, lucky: false },
}

/** Prize per tier as the website shows it: the tier's amount, else its share of the pool. */
export function prizeTable(g: WingoGame) {
  return g.prizeTiers.flatMap((tier) => {
    const cfg = PRIZE_TIERS[tier.name]
    if (!cfg) return []
    const prize = tier.prize > 0 ? tier.prize : Math.round((tier.percentage / 100) * g.prizePool)
    return [{ name: tier.name, ...cfg, prize }]
  })
}

/** Single-game answer: the game, or the private-game lock. */
export function parseWingoGameResult(raw: unknown, gameId: string): WingoGameResult | null {
  const g = rec(raw)
  if (g.requiresPassword === true) return { locked: true, gameId }
  const game = parseWingoGame(raw)
  return game ? { locked: false, game } : null
}

/** Special shows end only on Cinema finalize; other games when the lottery is drawn. */
export function isFinalized(g: WingoGame): boolean {
  if (g.special) return g.cinemaFinalized
  return g.finished === 1 || g.rawStatus === "finish" || g.rawStatus === "finished" || g.cronStatus === 2
}

const AUTOMATED: ReadonlySet<WingoFormat> = new Set(["every_15_min", "hourly", "daily", "scheduled"])

/** Hosted show (website `isHostedShow`): automated games count only when landing-featured. */
export function isHostedShow(g: WingoGame): boolean {
  if (AUTOMATED.has(g.format)) return g.featured
  return g.featured || g.format === "special" || g.format === "live" || g.liveRoomId !== null
}

/** Website `isLiveShowFormat`: a show stays up until Cinema finalizes it, results or not. */
export function isLiveShowFormat(format: WingoFormat): boolean {
  return format === "special" || format === "live"
}

export const CADENCES = ["daily", "every_15_min", "hourly"] as const
export type Cadence = (typeof CADENCES)[number]

/** Website Play Today `MODE_META` plus the cadence mark of the small cards. Labels are translated copy. */
export const CADENCE_COPY: Record<Cadence, { label: string; short: string; hint: string; value: string; unit: string }> = {
  daily: { label: "Daily Draw", short: "Daily", hint: "Daily Draw", value: "24", unit: "Hr" },
  every_15_min: { label: "Every 15 Minutes", short: "15 Min", hint: "Fast draws", value: "15", unit: "Min" },
  hourly: { label: "Every Hour", short: "Hourly", hint: "Steady rhythm", value: "1", unit: "Hr" },
}

/** Design B "How to play" steps. Text is translated copy. */
export const HOW_TO_PLAY = [
  { icon: "🎯", text: "Pick your numbers" },
  { icon: "🎟️", text: "Buy your ticket" },
  { icon: "📺", text: "Watch the live draw" },
  { icon: "🏆", text: "Match numbers and win" },
] as const

const PLAYABLE: readonly GameStatus[] = ["live_now", "result_being_announced", "registration_open", "starting_soon"]
const GROUP_GRACE_MS = 5 * MINUTE

function drawOrder(a: WingoGame, b: WingoGame): number {
  return (a.drawAtMs ?? Number.MAX_SAFE_INTEGER) - (b.drawAtMs ?? Number.MAX_SAFE_INTEGER)
}

/**
 * Website Play Today (`composeHomeV2Feed` recurring groups + `pickSoonestGroup`):
 * per cadence, the next occurrence of the soonest automated schedule. Also
 * returns the next game of each `scheduled` schedule, which has no cadence slot.
 */
export function playToday(games: readonly WingoGame[], nowMs: number) {
  const groups = new Map<string, WingoGame[]>()
  for (const g of games) {
    if (!AUTOMATED.has(g.format) || isHostedShow(g)) continue
    const status = gameStatus(g, nowMs)
    if (status === "completed" || status === "cancelled" || status === "temporarily_unavailable") continue
    groups.set(g.recurrenceKey, [...(groups.get(g.recurrenceKey) ?? []), g])
  }

  const nexts: WingoGame[] = []
  for (const list of groups.values()) {
    const sorted = [...list].sort(drawOrder)
    const next =
      sorted.find((g) => {
        const s = gameStatus(g, nowMs)
        return PLAYABLE.includes(s) || s === "registration_closed" || s === "scheduled"
      }) ?? sorted[0]
    if (!next) continue
    const live = isLiveStatus(gameStatus(next, nowMs))
    if (live || (next.drawAtMs != null && next.drawAtMs >= nowMs - GROUP_GRACE_MS)) nexts.push(next)
  }
  nexts.sort(drawOrder)

  const slots = Object.fromEntries(CADENCES.map((c) => [c, nexts.find((g) => g.format === c) ?? null])) as Record<
    Cadence,
    WingoGame | null
  >
  return { slots, scheduled: nexts.filter((g) => g.format === "scheduled") }
}

export function gameStatus(g: WingoGame, nowMs: number): GameStatus {
  const raw = g.rawStatus
  if (raw === "cancelled" || raw === "canceled") return "cancelled"
  if (raw === "temporarily_unavailable" || raw === "unavailable") return "temporarily_unavailable"
  if (isFinalized(g)) return "completed"

  const drawMs = g.drawAtMs
  const regCloseMs = g.closeAtMs ?? drawMs
  const startMs = g.startAtMs ?? drawMs

  if (drawMs != null && nowMs >= drawMs) {
    return raw.includes("result") || raw.includes("announce") ? "result_being_announced" : "live_now"
  }
  if (g.result.length > 0 && !isLiveShowFormat(g.format)) return "completed"
  if (g.isTicketingOpen) {
    if (regCloseMs != null && regCloseMs - nowMs <= 30 * MINUTE) return "starting_soon"
    if (startMs != null && startMs - nowMs <= 60 * MINUTE) return "starting_soon"
    return "registration_open"
  }
  if (drawMs != null && nowMs < drawMs) return "registration_closed"
  return "scheduled"
}

export function isLiveStatus(s: GameStatus): boolean {
  return s === "live_now" || s === "result_being_announced"
}

export function countdown(g: WingoGame, status: GameStatus, nowMs: number): { kind: CountdownKind; targetMs: number | null } {
  const future = (ms: number | null) => ms != null && ms > nowMs
  switch (status) {
    case "registration_open":
    case "starting_soon":
      if (future(g.closeAtMs)) return { kind: "registration_closes", targetMs: g.closeAtMs }
      if (future(g.drawAtMs)) return { kind: "draw_starts", targetMs: g.drawAtMs }
      if (future(g.startAtMs)) return { kind: "game_starts", targetMs: g.startAtMs }
      return { kind: "none", targetMs: null }
    case "scheduled":
    case "registration_closed":
      if (future(g.drawAtMs)) return { kind: "draw_starts", targetMs: g.drawAtMs }
      if (future(g.startAtMs)) return { kind: "game_starts", targetMs: g.startAtMs }
      return { kind: "none", targetMs: null }
    default:
      return { kind: "none", targetMs: null }
  }
}

/** `{ days, hours, minutes, seconds }` left until `targetMs`, never negative. */
export function timeLeft(targetMs: number, nowMs: number) {
  const total = Math.max(0, Math.floor((targetMs - nowMs) / 1000))
  return {
    total,
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  }
}

/** Website draw phase: sales, the 5-minute join window, then drawn. */
export function drawPhase(g: WingoGame, nowMs: number): "sales" | "join" | "drawn" {
  if (g.drawAtMs == null) return "sales"
  if (nowMs >= g.drawAtMs) return "drawn"
  return nowMs >= g.drawAtMs - JOIN_WINDOW_MS ? "join" : "sales"
}

/** On-camera host: an influencer special, or an AI presenter with an avatar. */
export function hasLiveHost(g: WingoGame): boolean {
  return (g.specialShow && !g.aiEnabled) || g.aiAvatar
}

function liveRoomStatus(s: string): boolean {
  return s === "active" || s === "live"
}

/** Mirrors `isWingoLivePageFinished`: when the live page stops showing the stream. */
export function isLivePageFinished(g: WingoGame, nowMs: number): boolean {
  if (g.cinemaFinalized) return true
  if (liveRoomStatus(g.streamingStatus)) return false
  const drawn = g.finished === 1 || g.rawStatus === "finish" || g.rawStatus === "finished" || g.cronStatus === 2
  if (g.specialShow && !g.aiEnabled) return false
  if (g.aiEnabled) {
    if (!drawn) return false
    if (g.drawAtMs == null) return false
    return nowMs > g.drawAtMs + (g.aiDurationSec + AI_SHOW_BUFFER_SEC) * 1000
  }
  return drawn
}

/** Order-independent identity of one ticket, same key as the website and server. */
export function comboKey(numbers: readonly number[], lucky: number): string {
  return `${[...numbers].sort((a, b) => a - b).join(",")}:${lucky}`
}

export type FreeQuote = { count: number; freeCount: number; gross: number; payable: number }

/** First N tickets are free (N = remaining allowance), as at website checkout. */
export function quote(count: number, unitPrice: number, freeRemaining: number): FreeQuote {
  const freeCount = Math.min(Math.max(freeRemaining, 0), count)
  const gross = round2(unitPrice * count)
  return { count, freeCount, gross, payable: Math.max(round2(unitPrice * (count - freeCount)), 0) }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export type Draft = { numbers: number[]; lucky: number | null }

export function isComplete(d: Draft, rules: TicketRules): boolean {
  return d.numbers.length === rules.mainCount && d.lucky != null
}

/** Toggle a main number, never more than `mainCount`. */
export function toggleMain(d: Draft, n: number, rules: TicketRules): Draft {
  if (d.numbers.includes(n)) return { ...d, numbers: d.numbers.filter((x) => x !== n) }
  if (d.numbers.length >= rules.mainCount || n < rules.mainMin || n > rules.mainMax) return d
  return { ...d, numbers: [...d.numbers, n].sort((a, b) => a - b) }
}

export function setLucky(d: Draft, n: number, rules: TicketRules): Draft {
  if (n < rules.luckyMin || n > rules.luckyMax) return d
  return { ...d, lucky: d.lucky === n ? null : n }
}

function range(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i)
}

export function mainRange(rules: TicketRules): number[] {
  return range(rules.mainMin, rules.mainMax)
}

export function luckyRange(rules: TicketRules): number[] {
  return range(rules.luckyMin, rules.luckyMax)
}

/** Quick Pick: unique random mains (Fisher–Yates) and a lucky number, like the website. */
export function randomDraft(rules: TicketRules, random: () => number = Math.random): Draft {
  const pool = mainRange(rules)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const a = pool[i] as number
    pool[i] = pool[j] as number
    pool[j] = a
  }
  const numbers = pool.slice(0, rules.mainCount).sort((a, b) => a - b)
  const lucky = rules.luckyMin + Math.floor(random() * (rules.luckyMax - rules.luckyMin + 1))
  return { numbers, lucky }
}

/** Quick Pick that avoids combinations already taken (owned or other drafts). */
export function uniqueRandomDraft(rules: TicketRules, taken: ReadonlySet<string>, random: () => number = Math.random): Draft {
  for (let i = 0; i < 50; i++) {
    const d = randomDraft(rules, random)
    if (d.lucky != null && !taken.has(comboKey(d.numbers, d.lucky))) return d
  }
  return randomDraft(rules, random)
}

export const CART_PROBLEM_COPY = {
  empty: "Add at least one ticket",
  incomplete: "Please pick all numbers and a lucky number",
  duplicate: "This selection includes a duplicate number combination",
  owned: "You already have this number combination",
} as const

/** Why the cart cannot be bought yet, or null when it can. Values are translated copy. */
export function cartProblem(drafts: readonly Draft[], owned: readonly OwnedTicket[], rules: TicketRules): string | null {
  if (drafts.length === 0) return CART_PROBLEM_COPY.empty
  if (drafts.some((d) => !isComplete(d, rules))) return CART_PROBLEM_COPY.incomplete
  const keys = drafts.map((d) => comboKey(d.numbers, d.lucky as number))
  if (new Set(keys).size !== keys.length) return CART_PROBLEM_COPY.duplicate
  const ownedKeys = new Set(owned.map((o) => comboKey(o.numbers, o.lucky)))
  if (keys.some((k) => ownedKeys.has(k))) return CART_PROBLEM_COPY.owned
  return null
}

/** Paid tickets from `/wingo/getTickets`. */
export function parseOwnedTickets(raw: unknown): OwnedTicket[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((t) => rec(t))
    .map((t) => ({
      numbers: Array.isArray(t.numbers) ? t.numbers.map(num).filter((n) => Number.isInteger(n) && n > 0) : [],
      lucky: num(t.chanceNumber),
    }))
    .filter((t) => t.numbers.length > 0 && t.lucky > 0)
}

/** Drawn balls split as on the website: the first `mainCount` are mains, the next is lucky. */
export function splitDrawn(balls: readonly number[], mainCount: number): { mains: number[]; lucky: number | null } {
  return { mains: balls.slice(0, mainCount), lucky: balls[mainCount] ?? null }
}

/**
 * Purchase failures → translated copy, as the website's `useHandleWingoPayment`
 * and checkout handle them. Server reasons that players can act on are shown
 * as themselves; anything else gets the generic message.
 */
export type PurchaseErrorKind = "insufficient" | "closed" | "gone" | "private" | "duplicate" | "owned" | "free_used" | "generic"

export const PURCHASE_ERROR_COPY: Record<PurchaseErrorKind, string> = {
  insufficient: "Cash and bonus together are not enough for this purchase.",
  closed: "Ticketing is closed for this game",
  gone: "This game is no longer available",
  private: "This game is private. Unlock it with the password first.",
  duplicate: "This selection includes a duplicate number combination",
  owned: "You already have this number combination",
  free_used: "This account already used its free ticket for this draw. Your total has been updated.",
  generic: "We couldn't complete your ticket purchase",
}

const SERVER_REASONS: Record<string, PurchaseErrorKind> = {
  "Ticketing is closed for this game": "closed",
  "This selection includes a duplicate number combination": "duplicate",
  "You already have this number combination": "owned",
  "Free ticket allowance has already been used": "free_used",
  "This game is private. Unlock it with the password first.": "private",
}

export function purchaseErrorKind(detail: { status: number; code: number | null; msg: string }): PurchaseErrorKind {
  if (detail.code === 4501) return "insufficient"
  if (detail.code === 4504) return "gone"
  const known = SERVER_REASONS[detail.msg]
  if (known) return known
  if (detail.status === 403) return "private"
  return "generic"
}
