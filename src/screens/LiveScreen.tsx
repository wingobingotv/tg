import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Balls, Countdown, PrivateGate, Replay, StatusChip } from "../components/game"
import { Alert, Button, Spinner } from "../components/ui"
import { config } from "../config"
import { useWingoGame, useWingoTickets, wingoGameKey } from "../data"
import {
  countdown,
  gameStatus,
  hasLiveHost,
  isLivePageFinished,
  type WingoGame,
} from "../games/wingo"
import { useNow } from "../hooks/useNow"
import { boardBalls, mergedBoard } from "../live/drawBoard"
import { LiveChat } from "../live/LiveChat"
import { CONNECTION_COPY } from "../live/connection"
import { useLiveShow } from "../live/useLiveShow"
import { useNav } from "../navigation"
import { MyTickets } from "./WingoGameScreen"

const GAME_POLL_MS = 10_000

function LiveView({ game }: { game: WingoGame }) {
  const { t } = useTranslation()
  const nav = useNav()
  const queryClient = useQueryClient()
  const now = useNow(1000)
  const tickets = useWingoTickets(game.gameId, true)
  const status = gameStatus(game, now)
  const timer = countdown(game, status, now)
  const finished = isLivePageFinished(game, now)
  const hosted = hasLiveHost(game)
  const mainCount = game.ticketRules?.mainCount ?? 6

  const onFinalized = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: wingoGameKey(game.gameId) })
  }, [queryClient, game.gameId])

  const live = useLiveShow({ gameId: game.gameId, enabled: hosted && !finished, mainCount, onFinalized })
  const board = mergedBoard(live.board, game.result, mainCount)
  const drawn = boardBalls(board)
  const showStage = hosted && !finished && live.connection !== "off"
  const overlay =
    live.connection === "off" || (live.connection === "live" && live.hasVideo)
      ? null
      : CONNECTION_COPY[live.connection === "live" ? "waiting" : live.connection]

  return (
    <div className="stack">
      <section className="live-head">
        <StatusChip status={status} />
        <h1 className="game-hero-title">{game.name}</h1>
        {game.presenterName ? <p className="muted">{t("Hosted by {{name}}", { name: game.presenterName })}</p> : null}
      </section>

      {finished && game.replayUrl ? (
        <Replay url={game.replayUrl} />
      ) : showStage ? (
        <div className="stage">
          <video ref={live.videoRef} className="stage-video" playsInline autoPlay muted />
          <div ref={live.audioRootRef} hidden />
          {overlay ? (
            <div className="stage-overlay">
              {live.connection === "unavailable" ? null : <span className="spinner" aria-hidden="true" />}
              <p>{t(overlay)}</p>
              {live.connection === "waiting" ? <Countdown kind={timer.kind} targetMs={timer.targetMs} now={now} /> : null}
            </div>
          ) : null}
          {live.audioBlocked && live.connection === "live" ? (
            <button type="button" className="stage-sound" onClick={live.enableAudio}>
              <span aria-hidden="true">🔊</span> {t("Tap to enable sound")}
            </button>
          ) : null}
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

      {live.news ? (
        <p className="news" role="status">
          <bdi>{live.news}</bdi>
        </p>
      ) : null}

      <section className="card" aria-labelledby="board-title">
        <h2 id="board-title" className="card-title">
          {t("Drawn numbers")}
        </h2>
        {drawn.length > 0 ? <Balls numbers={board.mains} lucky={board.lucky} /> : <p className="muted">{t("No numbers drawn yet.")}</p>}
      </section>

      <MyTickets owned={tickets.data ?? []} drawn={drawn} rules={game.ticketRules} />

      {game.isTicketingOpen ? (
        <Button variant="secondary" onClick={() => nav.open({ name: "wingo", gameId: game.gameId })}>
          {t("Buy tickets")}
        </Button>
      ) : null}

      {game.isLiveChatEnabled && hosted && !finished ? <LiveChat gameId={game.gameId} /> : null}
    </div>
  )
}

export function LiveScreen({ gameId }: { gameId: string }) {
  const { t } = useTranslation()
  const query = useWingoGame(gameId, GAME_POLL_MS)

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
