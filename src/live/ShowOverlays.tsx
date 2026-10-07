import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { getDisplayCurrency } from "../api"
import { formatCount, formatMoney } from "../format"
import { PRIZE_TIERS, totalWinners, type WinnerTier } from "../games/wingo"
import { currentLanguage } from "../i18n"
import type { ChatMessage } from "./chat"
import type { Award, Board, LiveEvent } from "./drawBoard"
import { CinematicFxPlayer, type CinematicFxEvent } from "./fx/cinematic-fx"
import { LuckyNumberRevealPlayer, type LuckyNumberEvent } from "./fx/lucky-number"
import { DRUM_BALL_COUNT, drumBallColor, drumPosition, newsScrollSeconds, stripBalls } from "./overlayMath"

/**
 * Everything drawn over the show video, as the website's `OverlayContainer`
 * and `LiveCrowdVideoOverlay` do for Wingo: the drum reveal of each drawn
 * ball, the lucky-number reveal, the drawn-numbers strip, winner bubbles, the
 * news ticker, the studio's award pools, the settled results, operator
 * celebrations and the chat stream.
 *
 * A ball stays off the page's board until its reveal has finished, so the
 * strip and the "Drawn numbers" card never give the number away early.
 */

type Bubble = { id: string; text: string; x: number; y: number }
type DrumBall = { id: string; number: number }
type Timed<T> = { id: string; value: T }

const DRUM_MS = 8_000
const BUBBLE_MS = 4_000
const BUBBLE_FADE_MS = 800
const AWARDS_MS = 15_000
const RESULTS_MS = 18_000
const CHAT_LINES = 8

let seq = 0
const nextId = () => `${Date.now()}-${(seq += 1)}`

export function useShowOverlays(args: { isShown: (n: number) => boolean; luckyLabel: string }) {
  const isShownRef = useRef(args.isShown)
  const labelRef = useRef(args.luckyLabel)
  useEffect(() => {
    isShownRef.current = args.isShown
    labelRef.current = args.luckyLabel
  }, [args.isShown, args.luckyLabel])

  const drumRef = useRef<DrumBall[]>([])
  const pendingLuckyRef = useRef<number | null>(null)
  const [drum, setDrum] = useState<DrumBall[]>([])
  const [pendingLucky, setPendingLucky] = useState<number | null>(null)
  const [lucky, setLucky] = useState<LuckyNumberEvent | null>(null)
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [news, setNews] = useState<Timed<string> | null>(null)
  const [awards, setAwards] = useState<Timed<Award[]> | null>(null)
  const [results, setResults] = useState<Timed<WinnerTier[]> | null>(null)
  const [fx, setFx] = useState<CinematicFxEvent | null>(null)

  const push = useCallback((event: LiveEvent) => {
    switch (event.kind) {
      case "ball": {
        const n = event.ball
        if (isShownRef.current(n)) return
        if (drumRef.current.some((d) => d.number === n) || pendingLuckyRef.current === n) return
        if (event.lucky) {
          pendingLuckyRef.current = n
          setPendingLucky(n)
          setLucky({ type: "lucky-number", number: String(n), label: labelRef.current, startAt: event.startAt ?? Date.now() })
          return
        }
        drumRef.current = [...drumRef.current, { id: nextId(), number: n }]
        setDrum(drumRef.current)
        return
      }
      case "winner":
        setBubbles((prev) => [...prev, { id: nextId(), text: event.text, x: Math.random() * 70 + 15, y: Math.random() * 40 + 15 }])
        return
      case "news":
        setNews({ id: nextId(), value: event.text })
        return
      case "awards":
        setAwards({ id: nextId(), value: event.awards })
        return
      case "finalized":
        if (event.winners?.length) setResults({ id: nextId(), value: event.winners })
        return
      case "fx":
        setFx({ ...event.event })
        return
      case "lucky_reveal":
        setLucky({ ...event.event })
        return
      default:
        return
    }
  }, [])

  const onDrumDone = useCallback((id: string) => {
    drumRef.current = drumRef.current.filter((d) => d.id !== id)
    setDrum(drumRef.current)
  }, [])

  const onLuckySettled = useCallback(() => {
    pendingLuckyRef.current = null
    setPendingLucky(null)
    setLucky(null)
  }, [])

  const pending = useMemo(() => {
    const set = new Set(drum.map((d) => d.number))
    if (pendingLucky != null) set.add(pendingLucky)
    return set
  }, [drum, pendingLucky])

  return {
    push,
    pending,
    view: {
      drum: drum[0] ?? null,
      lucky,
      bubbles,
      news,
      awards,
      results,
      fx,
      onDrumDone,
      onLuckySettled,
      onBubbleDone: (id: string) => setBubbles((prev) => prev.filter((b) => b.id !== id)),
      onNewsDone: () => setNews(null),
      onAwardsDone: () => setAwards(null),
      onResultsDone: () => setResults(null),
    },
  }
}

export type OverlayView = ReturnType<typeof useShowOverlays>["view"]

/** The board with balls still being revealed held back. */
export function revealedBoard(board: Board, pending: ReadonlySet<number>): Board {
  if (pending.size === 0) return board
  return {
    mains: board.mains.filter((n) => !pending.has(n)),
    lucky: board.lucky != null && pending.has(board.lucky) ? null : board.lucky,
  }
}

export function ShowOverlays({
  view,
  board,
  chat,
}: {
  view: OverlayView
  board: Board
  chat: readonly ChatMessage[]
}) {
  return (
    <div className="ov" aria-hidden="true">
      <FxLayer event={view.fx} />
      <CrowdChat messages={chat} />
      <DrawnStrip board={board} />
      {view.news ? <NewsTicker key={view.news.id} text={view.news.value} onDone={view.onNewsDone} /> : null}
      {view.bubbles.map((b) => (
        <WinnerBubble key={b.id} bubble={b} onDone={view.onBubbleDone} />
      ))}
      {view.drum ? <Drum key={view.drum.id} number={view.drum.number} onDone={() => view.onDrumDone(view.drum?.id ?? "")} /> : null}
      <LuckyLayer event={view.lucky} onSettled={view.onLuckySettled} />
      {view.awards ? <AwardsPanel key={view.awards.id} awards={view.awards.value} onDone={view.onAwardsDone} /> : null}
      {view.results ? <ResultsPanel key={view.results.id} tiers={view.results.value} onDone={view.onResultsDone} /> : null}
    </div>
  )
}

function useTimeout(ms: number, onDone: () => void) {
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  }, [onDone])
  useEffect(() => {
    const id = window.setTimeout(() => doneRef.current(), ms)
    return () => window.clearTimeout(id)
  }, [ms])
}

/** Operator celebrations; the engine draws on its own canvases outside React. */
function FxLayer({ event }: { event: CinematicFxEvent | null }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<CinematicFxPlayer | null>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const player = new CinematicFxPlayer(host)
    playerRef.current = player
    return () => {
      playerRef.current = null
      player.destroy()
    }
  }, [])
  useEffect(() => {
    if (event) playerRef.current?.play(event)
  }, [event])
  return <div ref={hostRef} className="ov-layer" />
}

/** The lucky-number reveal; the engine dedupes, queues and handles late joins. */
function LuckyLayer({ event, onSettled }: { event: LuckyNumberEvent | null; onSettled: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<LuckyNumberRevealPlayer | null>(null)
  const settledRef = useRef(onSettled)
  useEffect(() => {
    settledRef.current = onSettled
  }, [onSettled])
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const player = new LuckyNumberRevealPlayer(host, { onRevealEnd: () => settledRef.current() })
    playerRef.current = player
    return () => {
      playerRef.current = null
      player.destroy()
    }
  }, [])
  useEffect(() => {
    if (!event) return
    const accepted = playerRef.current?.play(event) ?? false
    if (!accepted) settledRef.current()
  }, [event])
  return <div ref={hostRef} className="ov-layer" />
}

type DrumPhase = "intro" | "blowing" | "slowing" | "selecting" | "rising" | "reveal"

const DRUM_PHASES: Array<[DrumPhase, number]> = [
  ["blowing", 300],
  ["slowing", 2_800],
  ["selecting", 3_800],
  ["rising", 4_800],
  ["reveal", 6_300],
]

/**
 * The air-blown bowl that picks each ball (website `LotteryDrumOverlay`).
 * Ball motion is written to the DOM in one rAF loop; only the phase is state.
 */
function Drum({ number, onDone }: { number: number; onDone: () => void }) {
  const [phase, setPhase] = useState<DrumPhase>("intro")
  const phaseRef = useRef<DrumPhase>("intro")
  const ballEls = useRef<Array<HTMLSpanElement | null>>([])
  const doneRef = useRef(onDone)
  const count = Math.max(DRUM_BALL_COUNT, number)
  const [balls] = useState(() => {
    const list = Array.from({ length: count }, (_, i) => i + 1)
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      const a = list[i] as number
      list[i] = list[j] as number
      list[j] = a
    }
    return list
  })

  useEffect(() => {
    doneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    const timers = DRUM_PHASES.map(([next, at]) =>
      window.setTimeout(() => {
        phaseRef.current = next
        setPhase(next)
      }, at),
    )
    timers.push(window.setTimeout(() => doneRef.current(), DRUM_MS))
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [])

  useEffect(() => {
    let frame = 0
    let last = performance.now()
    let time = 0
    let speed = 1
    let riseY = 0
    let scale = 1
    const step = (now: number) => {
      const delta = Math.min((now - last) / 1000, 0.1)
      last = now
      const p = phaseRef.current
      if (p === "slowing") speed = Math.max(0.05, speed * 0.97)
      else if (p === "selecting" || p === "rising" || p === "reveal") speed = 0.02
      if (p === "rising") {
        riseY = Math.min(riseY + delta * 120, 100)
        scale = Math.min(scale + delta * 1.2, 2)
      }
      if (p === "reveal") scale = Math.min(scale + delta * 0.5, 2.2)
      time += delta * speed
      const dimmed = p === "selecting" || p === "rising" || p === "reveal"
      balls.forEach((n, i) => {
        const el = ballEls.current[i]
        if (!el) return
        let x: number
        let y: number
        let s = 1
        let opacity = 1
        if (n === number && p === "selecting") {
          x = 0
          y = 0
          s = 1.4
        } else if (n === number && (p === "rising" || p === "reveal")) {
          x = 0
          y = -riseY
          s = scale
        } else {
          const pos = drumPosition(i, time, speed)
          x = pos.x
          y = pos.y
          if (dimmed) opacity = 0.35
        }
        el.style.transform = `translate(${x}px, ${y}px) scale(${s})`
        el.style.opacity = String(opacity)
      })
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [balls, number])

  const highlighted = phase === "selecting" || phase === "rising" || phase === "reveal"
  return (
    <div className="ov-center">
      <div className={`drum${phase === "intro" ? "" : " drum-on"}`}>
        <div className="drum-back" />
        {phase === "blowing" || phase === "slowing" ? (
          <div className="drum-air">
            <span />
            <span />
            <span />
          </div>
        ) : null}
        <div className="drum-balls" dir="ltr">
          {balls.map((n, i) => {
            const winner = n === number && highlighted
            return (
              <span
                key={n}
                ref={(el) => {
                  ballEls.current[i] = el
                }}
                className={`drum-ball${winner ? " drum-ball-win" : ""}${phase === "selecting" || phase === "rising" ? " drum-ball-move" : ""}`}
                style={winner ? { zIndex: 200 } : { zIndex: i, color: drumBallColor(n) }}
              >
                {n}
              </span>
            )
          })}
        </div>
        <div className="drum-front" />
        <div className="drum-rim" />
        <div className="drum-base" />
      </div>
    </div>
  )
}

/** Drawn balls along the bottom of the video; the lucky ball in gold. */
function DrawnStrip({ board }: { board: Board }) {
  const balls = stripBalls(board)
  if (balls.length === 0) return null
  return (
    <div className="ov-strip" dir="ltr">
      {balls.map((b, i) => (
        <span key={`${b.n}-${b.lucky ? "l" : "m"}`} className={`ov-strip-ball${b.lucky ? " ov-strip-lucky" : ""}`} style={{ animationDelay: `${i * 0.04}s` }}>
          {b.n}
        </span>
      ))}
    </div>
  )
}

function WinnerBubble({ bubble, onDone }: { bubble: Bubble; onDone: (id: string) => void }) {
  const [leaving, setLeaving] = useState(false)
  useTimeout(BUBBLE_MS, () => setLeaving(true))
  useTimeout(BUBBLE_MS + BUBBLE_FADE_MS, () => onDone(bubble.id))
  return (
    <div className={`ov-bubble${leaving ? " ov-bubble-out" : ""}`} style={{ insetInlineStart: `${bubble.x}%`, insetBlockStart: `${bubble.y}%` }}>
      <span className="ov-bubble-text">
        ★ <bdi>{bubble.text}</bdi> ★
      </span>
    </div>
  )
}

function NewsTicker({ text, onDone }: { text: string; onDone: () => void }) {
  const { t } = useTranslation()
  const seconds = newsScrollSeconds(text)
  useTimeout((seconds + 2) * 1000, onDone)
  return (
    <div className="ov-news">
      <span className="ov-news-label">
        <span className="ov-news-dot" />
        {t("News")}
      </span>
      <span className="ov-news-track">
        <span className="ov-news-text" style={{ animationDuration: `${seconds}s` }}>
          <bdi>{text}</bdi>
        </span>
      </span>
    </div>
  )
}

/** The studio's level pools. The payload has no winner count, so never a personal amount. */
function AwardsPanel({ awards, onDone }: { awards: Award[]; onDone: () => void }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  useTimeout(AWARDS_MS, onDone)
  return (
    <div className="ov-panel-wrap">
      <div className="ov-panel">
        <p className="ov-panel-icon">🏆</p>
        <p className="ov-panel-title">{t("Winner awards")}</p>
        <p className="ov-panel-sub">{t("Match numbers and win prizes!")}</p>
        <p className="ov-panel-note">{t("Each amount is the level pool, shared between its winners")}</p>
        <ul className="ov-grid">
          {awards.map((a) => (
            <li key={a.combination} className="ov-cell">
              <span className="ov-cell-key">
                <span className="ov-combo" dir="ltr">
                  {a.combination}
                </span>
                <span>{t("Match")}</span>
              </span>
              <strong className="ov-cell-prize" dir="ltr">
                {formatMoney(a.prize, "USD", lang)}
              </strong>
            </li>
          ))}
        </ul>
        <p className="ov-panel-foot">{t("Good luck to all players!")}</p>
      </div>
    </div>
  )
}

/** The divisor every viewer sees at finalize: winning tickets per level and each one's share. */
function ResultsPanel({ tiers, onDone }: { tiers: WinnerTier[]; onDone: () => void }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const currency = getDisplayCurrency()
  useTimeout(RESULTS_MS, onDone)
  return (
    <div className="ov-panel-wrap">
      <div className="ov-panel ov-panel-scroll">
        <p className="ov-panel-icon">🏆</p>
        <p className="ov-panel-title">{t("Draw results")}</p>
        <p className="ov-panel-sub">
          {t("{{winners}} winning tickets — each level's pool is split between them", { winners: formatCount(totalWinners(tiers), lang) })}
        </p>
        <ul className="ov-grid">
          {tiers.map((tier, i) => {
            const cfg = tier.name ? PRIZE_TIERS[tier.name] : undefined
            const won = tier.winners > 0
            return (
              <li key={tier.name ?? `tier-${i}`} className="ov-cell">
                <span className="ov-cell-key ov-cell-stack">
                  <strong className="ov-cell-label">
                    {cfg ? (cfg.lucky ? t("{{matches}} matches + Lucky", { matches: cfg.mains }) : t("{{matches}} matches", { matches: cfg.mains })) : <bdi>{tier.condition.split("(")[0]?.trim() || String(i + 1)}</bdi>}
                  </strong>
                  <span>{won ? t("{{winners}} winning tickets", { winners: formatCount(tier.winners, lang) }) : t("No winners")}</span>
                </span>
                {won && tier.perTicket > 0 ? (
                  <span className="ov-cell-stack ov-cell-end">
                    <strong className="ov-cell-prize" dir="ltr">
                      {formatMoney(tier.perTicket, currency, lang)}
                    </strong>
                    <span>{t("each")}</span>
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/** Read-only chat stream over the video (website `LiveCrowdVideoOverlay`). */
function CrowdChat({ messages }: { messages: readonly ChatMessage[] }) {
  const { t } = useTranslation()
  const lines = messages.slice(-CHAT_LINES)
  if (lines.length === 0) return null
  return (
    <div className="ov-chat">
      {lines.map((m) => (
        <p key={m.id} className="ov-chat-line">
          <bdi className="ov-chat-name">{m.displayName}</bdi>
          {m.isMine ? <span className="ov-chat-you">{t("you")}</span> : null}
          <span className="ov-chat-sep">: </span>
          <bdi>{m.body}</bdi>
        </p>
      ))}
    </div>
  )
}
