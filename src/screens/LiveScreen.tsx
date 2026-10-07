import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { getDisplayCurrency } from "../api"
import { Balls, Countdown, PrivateGate, Replay, StatusChip } from "../components/game"
import { Alert, Button, Spinner } from "../components/ui"
import { config } from "../config"
import { useWingoGame, useWingoTickets, wingoGameKey } from "../data"
import { formatCount, formatDrawTime, formatMoney } from "../format"
import {
  countdown,
  gameStatus,
  hasLiveHost,
  isLivePageFinished,
  qualifiedLevels,
  totalWinners,
  type OwnedTicket,
  type QualifiedLevel,
  type WingoGame,
  type WingoGameResult,
} from "../games/wingo"
import { useNow } from "../hooks/useNow"
import { currentLanguage } from "../i18n"
import { isPending } from "../live/chat"
import { CONNECTION_COPY } from "../live/connection"
import { boardBalls, mergedBoard, type Board } from "../live/drawBoard"
import { LiveChat, useLiveChat } from "../live/LiveChat"
import { ShowOverlays, revealedBoard, useShowOverlays } from "../live/ShowOverlays"
import { useLiveShow } from "../live/useLiveShow"
import { openExternal, setTelegramFullscreen } from "../telegram"
import { MyTickets, PrizeTable, SharedPoolNote, TicketSales } from "./WingoGameScreen"

/** The website's pre-show loop, played until the host's video arrives. */
const PRE_SHOW_URL =
  "https://wingobingo.fra1.digitaloceanspaces.com/assets/1786632739665_create_wingobingo_pre-show_anima__202608131652.mp4"

const POLL_MS = 8_000
/** Drawn but not yet settled: the website polls this fast for the results. */
const POLL_SETTLING_MS = 4_000
/** Settled: only the replay link is still to come. */
const POLL_SETTLED_MS = 30_000

function livePoll(data: WingoGameResult | null | undefined): number {
  if (!data || data.locked) return POLL_MS
  const g = data.game
  if (g.winners.length > 0 || g.cinemaFinalized) return POLL_SETTLED_MS
  return g.result.length > (g.ticketRules?.mainCount ?? 6) ? POLL_SETTLING_MS : POLL_MS
}

/** Website `LevelPoolLine`: the level reached and its pool, or the settled share. */
function LevelLine({ level }: { level: QualifiedLevel }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const money = (v: number) => formatMoney(v, getDisplayCurrency(), lang)
  const pool = money(level.pool)
  return (
    <li className="level-line">
      <span className="chip chip-static">
        {level.lucky ? t("{{matches}} matches + Lucky", { matches: level.mains }) : t("{{matches}} matches", { matches: level.mains })}
      </span>
      <span>
        {level.confirmed != null && (level.winners ?? 0) > 0
          ? t("{{pool}} pool split by {{winners}} winning tickets — {{yours}} to you", {
              pool,
              winners: formatCount(level.winners ?? 0, lang),
              yours: money(level.confirmed),
            })
          : level.tickets > 1
            ? t("{{pool}} pool — your {{tickets}} tickets each take a share", { pool, tickets: level.tickets })
            : t("{{pool}} pool — divided between everyone who matches it", { pool })}
      </span>
    </li>
  )
}

/**
 * Website prize banner. Before settlement it reports the pools of the levels
 * reached, never a per-player figure: the divisor is unknown until the last
 * ball. After settlement it is the player's confirmed amount.
 */
function PrizeBanner({ game, board, owned }: { game: WingoGame; board: Board; owned: OwnedTicket[] }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const mainCount = game.ticketRules?.mainCount ?? 6
  const levels = qualifiedLevels(game, board, owned)
  const settled = game.winners.length > 0
  const poolTotal = levels.reduce((sum, l) => sum + l.pool, 0)
  const confirmedTotal = levels.reduce((sum, l) => sum + (l.confirmed ?? 0), 0)
  if (!(settled ? confirmedTotal > 0 : poolTotal > 0)) return null
  const drawComplete = board.mains.length >= mainCount && board.lucky != null
  return (
    <section className="card prize-banner" role="status">
      <div className="prize-banner-head">
        <span className="prize-banner-icon" aria-hidden="true">
          🎉
        </span>
        <div className="stack-tight">
          <p className="muted">{settled ? t("Congratulations — you won!") : drawComplete ? t("Counting the winners…") : t("You're in the prize")}</p>
          <p className="prize-banner-amount">
            <strong dir="ltr">{formatMoney(settled ? confirmedTotal : poolTotal, getDisplayCurrency(), lang)}</strong>
            <span className="chip chip-static">{settled ? t("your confirmed prize") : t("pool, shared between winners")}</span>
          </p>
        </div>
      </div>
      <ul className="level-lines">
        {levels.map((level) => (
          <LevelLine key={level.name} level={level} />
        ))}
      </ul>
      {settled ? (
        <Button variant="secondary" onClick={() => openExternal(`${config?.siteUrl ?? ""}/${lang}/more/withdraw`)}>
          {t("Withdraw on the website")}
        </Button>
      ) : (
        <SharedPoolNote />
      )}
    </section>
  )
}

function LiveView({ game }: { game: WingoGame }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const lang = currentLanguage()
  const now = useNow(1000)
  const tickets = useWingoTickets(game.gameId, true)
  const status = gameStatus(game, now)
  const timer = countdown(game, status, now)
  const finished = isLivePageFinished(game, now)
  const hosted = hasLiveHost(game)
  const mainCount = game.ticketRules?.mainCount ?? 6
  const owned = tickets.data ?? []

  const onFinalized = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: wingoGameKey(game.gameId) })
  }, [queryClient, game.gameId])

  const knownRef = useRef<Board>({ mains: [], lucky: null })
  const isShown = useCallback((n: number) => knownRef.current.mains.includes(n) || knownRef.current.lucky === n, [])
  const overlays = useShowOverlays({ isShown, luckyLabel: t("Lucky Number") })
  const showLive = hosted && !finished
  const live = useLiveShow({ gameId: game.gameId, enabled: showLive, mainCount, onFinalized, onEvent: overlays.push })
  const known = mergedBoard(live.board, game.result, mainCount)
  useEffect(() => {
    knownRef.current = known
  })
  const board = revealedBoard(known, overlays.pending)
  const drawn = boardBalls(board)

  const chat = useLiveChat(game.gameId, game.isLiveChatEnabled && showLive)
  const crowd = chat.messages.filter((m) => !isPending(m, now))

  const preShowRef = useRef<HTMLVideoElement | null>(null)
  const [preShowMuted, setPreShowMuted] = useState(true)
  const [full, setFull] = useState(false)
  const showStage = showLive && live.connection !== "off"
  const onAir = live.connection === "live" && live.hasVideo

  useEffect(() => {
    const el = preShowRef.current
    if (el) el.muted = preShowMuted || live.muted
  }, [preShowMuted, live.muted, onAir])

  useEffect(() => {
    if (!full) return
    document.documentElement.classList.add("stage-full-open")
    setTelegramFullscreen(true)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false)
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.documentElement.classList.remove("stage-full-open")
      setTelegramFullscreen(false)
    }
  }, [full])

  const enablePreShowSound = () => {
    setPreShowMuted(false)
    live.setMuted(false)
    const el = preShowRef.current
    if (el) {
      el.muted = false
      void el.play().catch(() => {})
    }
    live.enableAudio()
  }

  const showMute = onAir ? !live.audioBlocked : !preShowMuted
  const salesOpen = game.isTicketingOpen && !finished
  const draw = game.drawAtMs ? formatDrawTime(game.drawAtMs / 1000, lang) : ""
  const settledWinners = totalWinners(game.winners)

  return (
    <div className="stack">
      <section className="live-head">
        <div className="live-head-row">
          <StatusChip status={status} />
          {game.prizePool > 0 ? (
            <span className="live-jackpot">
              <span aria-hidden="true">🏆</span>
              <strong dir="ltr">{formatMoney(game.prizePool, getDisplayCurrency(), lang)}</strong>
            </span>
          ) : null}
        </div>
        <h1 className="game-hero-title">{game.name}</h1>
        {draw ? (
          <p className="muted small">
            {t("Draw time")} · <span dir="ltr">{draw}</span>
          </p>
        ) : null}
        {game.presenterName ? <p className="muted">{t("Hosted by {{name}}", { name: game.presenterName })}</p> : null}
      </section>

      {finished && game.replayUrl ? (
        <Replay url={game.replayUrl} />
      ) : showStage ? (
        <div className={`stage${full ? " stage-full" : ""}${live.guest ? " stage-split" : ""}`}>
          <div className="stage-feeds">
            <div className="stage-feed">
              <video ref={live.videoRef} className="stage-video" playsInline autoPlay muted />
            </div>
            <div className="stage-feed stage-guest">
              <video ref={live.guestVideoRef} className="stage-video" playsInline autoPlay muted />
              {live.guest ? (
                <span className="stage-guest-name">
                  <span aria-hidden="true">👤</span> <bdi>{live.guest.name}</bdi>
                </span>
              ) : null}
            </div>
          </div>
          <div ref={live.audioRootRef} hidden />

          {!onAir && live.connection !== "unavailable" ? (
            <div className="pre-show">
              <video ref={preShowRef} className="pre-show-video" src={PRE_SHOW_URL} autoPlay loop muted playsInline />
              <div className="pre-show-foot">
                <p className="pre-show-status">
                  <span className="spinner" aria-hidden="true" />
                  {t(CONNECTION_COPY[live.connection === "live" || live.connection === "off" ? "waiting" : live.connection])}
                </p>
                <Countdown kind={timer.kind} targetMs={timer.targetMs} now={now} />
              </div>
            </div>
          ) : null}
          {live.connection === "unavailable" ? (
            <div className="stage-overlay">
              <p>{t(CONNECTION_COPY.unavailable)}</p>
            </div>
          ) : null}

          <ShowOverlays view={overlays.view} board={board} chat={crowd} />

          {!onAir && preShowMuted && live.connection !== "unavailable" ? (
            <button type="button" className="stage-sound stage-sound-center" onClick={enablePreShowSound}>
              <span aria-hidden="true">🔊</span> {t("Tap to enable sound")}
            </button>
          ) : null}
          {onAir && live.audioBlocked ? (
            <button
              type="button"
              className="stage-sound stage-sound-center"
              onClick={() => {
                setPreShowMuted(false)
                live.enableAudio()
              }}
            >
              <span aria-hidden="true">🔊</span> {t("Tap to enable sound")}
            </button>
          ) : null}
          {showMute ? (
            <button
              type="button"
              className="stage-btn stage-btn-mute"
              aria-label={live.muted ? t("Unmute") : t("Mute")}
              onClick={() => live.setMuted(!live.muted)}
            >
              <span aria-hidden="true">{live.muted ? "🔇" : "🔊"}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="stage-btn stage-btn-full"
            aria-label={full ? t("Exit full screen") : t("Full screen")}
            aria-pressed={full}
            onClick={() => setFull((v) => !v)}
          >
            <span aria-hidden="true">{full ? "✕" : "⛶"}</span>
          </button>
        </div>
      ) : (
        <div className="stage stage-empty">
          {finished ? (
            <p>{hosted ? t("The replay is being processed. Check back soon.") : t("The draw has finished.")}</p>
          ) : hosted && !config?.livekitUrl ? (
            <p>{t("The live stream is not available right now.")}</p>
          ) : (
            <>
              <p>{t("The official draw runs at draw time. Numbers appear here as they are drawn.")}</p>
              <Countdown kind={timer.kind} targetMs={timer.targetMs} now={now} />
            </>
          )}
        </div>
      )}

      {settledWinners > 0 ? (
        <Alert tone="info">
          {t("Draw complete — {{winners}} winning tickets across all levels", { winners: formatCount(settledWinners, lang) })}
        </Alert>
      ) : null}

      <PrizeBanner game={game} board={board} owned={owned} />

      <section className="card" aria-labelledby="board-title">
        <h2 id="board-title" className="card-title">
          {t("Drawn numbers")}
        </h2>
        {drawn.length > 0 ? <Balls numbers={board.mains} lucky={board.lucky} labelLucky /> : <p className="muted">{t("No numbers drawn yet.")}</p>}
      </section>

      <MyTickets game={game} owned={owned} board={board} />

      <TicketSales game={game} open={salesOpen} />

      <PrizeTable game={game} />

      {chat.status ? <LiveChat gameId={game.gameId} chat={chat} /> : null}
    </div>
  )
}

export function LiveScreen({ gameId }: { gameId: string }) {
  const { t } = useTranslation()
  const query = useWingoGame(gameId, livePoll)

  if (query.isPending) return <Spinner />
  if (query.isError) {
    return (
      <div className="stack">
        <Alert tone="error">{t("Could not load the game.")}</Alert>
        <Button onClick={() => void query.refetch()}>{t("Try again")}</Button>
      </div>
    )
  }
  if (!query.data) return <Alert tone="info">{t("This game is not available")}</Alert>
  if (query.data.locked) return <PrivateGate gameId={gameId} />
  return <LiveView game={query.data.game} />
}
