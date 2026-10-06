import { useState } from "react"
import { useTranslation } from "react-i18next"
import { getDisplayCurrency } from "../api"
import { Balls, Countdown, PrivateGate, StatusChip } from "../components/game"
import { TicketShop } from "../components/TicketShop"
import { Alert, Button, Spinner } from "../components/ui"
import { useWingoGame, useWingoTickets } from "../data"
import { formatDrawTime, formatMoney } from "../format"
import {
  countdown,
  drawPhase,
  gameStatus,
  hasLiveHost,
  prizeTable,
  splitDrawn,
  type OwnedTicket,
  type TicketRules,
  type WingoGame,
} from "../games/wingo"
import { useNow } from "../hooks/useNow"
import { currentLanguage } from "../i18n"
import { useNav } from "../navigation"

const GAME_POLL_MS = 30_000

/** The player's tickets; numbers that match the draw so far are highlighted. */
export function MyTickets({ owned, drawn, rules }: { owned: OwnedTicket[]; drawn: readonly number[]; rules: TicketRules | null }) {
  const { t } = useTranslation()
  if (owned.length === 0) return null
  const mainCount = rules?.mainCount ?? 6
  const { mains, lucky } = splitDrawn(drawn, mainCount)
  const hits = new Set(mains)
  return (
    <section className="card" aria-labelledby="my-tickets-title">
      <h2 id="my-tickets-title" className="card-title">
        {t("Your tickets in this draw")} <span className="muted">({owned.length})</span>
      </h2>
      <ul className="ticket-list">
        {owned.map((ticket, i) => (
          <li key={`${ticket.numbers.join("-")}:${ticket.lucky}:${i}`}>
            <Balls numbers={ticket.numbers} lucky={ticket.lucky} hits={hits} luckyHit={lucky != null && lucky === ticket.lucky} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function Prizes({ game }: { game: WingoGame }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const rows = prizeTable(game)
  if (rows.length === 0) return null
  return (
    <section className="card" aria-labelledby="prizes-title">
      <h2 id="prizes-title" className="card-title">
        {t("Prize distribution")}
      </h2>
      <ul className="prize-list">
        {rows.map((row) => (
          <li key={row.name}>
            <span className="prize-label">
              <strong>{t(row.label)}</strong>
              <span className="muted small">
                {row.lucky ? t("{{n}} numbers + lucky number", { n: row.mains }) : t("{{n}} numbers", { n: row.mains })}
              </span>
            </span>
            <strong dir="ltr">{formatMoney(row.prize, getDisplayCurrency(), lang)}</strong>
          </li>
        ))}
      </ul>
    </section>
  )
}

function GameView({ game }: { game: WingoGame }) {
  const { t } = useTranslation()
  const nav = useNav()
  const lang = currentLanguage()
  const currency = getDisplayCurrency()
  const now = useNow(1000)
  const [purchased, setPurchased] = useState(false)
  const tickets = useWingoTickets(game.gameId, true)
  const status = gameStatus(game, now)
  const phase = drawPhase(game, now)
  const timer = countdown(game, status, now)
  const owned = tickets.data ?? []
  const draw = game.drawAtMs ? formatDrawTime(game.drawAtMs / 1000, lang) : ""
  const watchLabel =
    phase === "join" ? t("Join and Watch") : hasLiveHost(game) ? t("Watch now") : t("Watch the Draw")

  return (
    <div className="stack">
      <section className="game-hero">
        {game.heroUrl || game.imageUrl ? <img src={game.heroUrl ?? game.imageUrl ?? ""} alt="" decoding="async" /> : null}
        <div className="game-hero-body">
          <StatusChip status={status} />
          <h1 className="game-hero-title">{game.name}</h1>
          {game.presenterName ? <p className="muted">{t("Hosted by {{name}}", { name: game.presenterName })}</p> : null}
        </div>
      </section>

      <section className="card">
        <dl className="details">
          {game.prizePool > 0 ? (
            <>
              <dt>{t("Prize pool")}</dt>
              <dd className="accent" dir="ltr">
                {formatMoney(game.prizePool, currency, lang)}
              </dd>
            </>
          ) : null}
          <dt>{t("Ticket price")}</dt>
          <dd dir="ltr">{formatMoney(game.ticketPrice, currency, lang)}</dd>
          {draw ? (
            <>
              <dt>{t("Draw")}</dt>
              <dd dir="ltr">{draw}</dd>
            </>
          ) : null}
        </dl>
        <Countdown kind={timer.kind} targetMs={timer.targetMs} now={now} />
        {game.freeTicketsRemaining > 0 && game.isTicketingOpen ? (
          <Alert tone="info">{t("You have {{count}} free ticket(s) for this draw.", { count: game.freeTicketsRemaining })}</Alert>
        ) : null}
        {phase !== "sales" ? <Button onClick={() => nav.open({ name: "live", gameId: game.gameId })}>{watchLabel}</Button> : null}
      </section>

      {game.result.length > 0 ? (
        <section className="card" aria-labelledby="drawn-title">
          <h2 id="drawn-title" className="card-title">
            {t("Drawn numbers")}
          </h2>
          {(() => {
            const { mains, lucky } = splitDrawn(game.result, game.ticketRules?.mainCount ?? 6)
            return <Balls numbers={mains} lucky={lucky} />
          })()}
        </section>
      ) : null}

      {purchased ? <Alert tone="info">{t("Your tickets are confirmed")}</Alert> : null}
      <MyTickets owned={owned} drawn={game.result} rules={game.ticketRules} />

      {!game.isTicketingOpen ? (
        <Alert tone="info">{t("Ticket sales are closed for this draw")}</Alert>
      ) : !game.ticketRules ? (
        <Alert tone="error">{t("Ticket sales aren't available in the app right now. Please try again later.")}</Alert>
      ) : tickets.isPending ? (
        <Spinner />
      ) : tickets.isError ? (
        <div className="stack">
          <Alert tone="error">{t("Could not load your tickets.")}</Alert>
          <Button variant="secondary" onClick={() => void tickets.refetch()}>
            {t("Try again")}
          </Button>
        </div>
      ) : (
        <TicketShop key={owned.length} game={game} rules={game.ticketRules} owned={owned} onPurchased={() => setPurchased(true)} />
      )}

      <Prizes game={game} />
    </div>
  )
}

export function WingoGameScreen({ gameId }: { gameId: string }) {
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
  return <GameView game={query.data.game} />
}
