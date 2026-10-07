import { useState } from "react"
import { useTranslation } from "react-i18next"
import { getDisplayCurrency } from "../api"
import { Balls, Countdown, PrivateGate, StatusChip } from "../components/game"
import { TicketShop } from "../components/TicketShop"
import { Alert, Button, Spinner } from "../components/ui"
import { useWingoGame, useWingoTickets } from "../data"
import { formatCount, formatDrawTime, formatMoney } from "../format"
import {
  PRIZE_TIERS,
  countdown,
  drawPhase,
  gameStatus,
  hasLiveHost,
  prizeTable,
  splitDrawn,
  ticketOutcome,
  totalWinners,
  winnersByName,
  type DrawnBoard,
  type OwnedTicket,
  type TicketOutcome,
  type WingoGame,
} from "../games/wingo"
import { useNow } from "../hooks/useNow"
import { currentLanguage } from "../i18n"
import { useNav } from "../navigation"

const GAME_POLL_MS = 30_000

function OutcomeChip({ outcome }: { outcome: TicketOutcome }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const tier = outcome.tier ? PRIZE_TIERS[outcome.tier] : undefined
  if (outcome.state === "won") {
    return <span className="outcome-chip outcome-won">{t("Won {{amount}}", { amount: formatMoney(outcome.prize, getDisplayCurrency(), lang) })}</span>
  }
  if (outcome.state === "in_prize" && tier) {
    return <span className="outcome-chip outcome-in">{t("In the prize — {{level}}", { level: t(tier.label) })}</span>
  }
  if (outcome.state === "no_prize") return <span className="outcome-chip">{t("No prize")}</span>
  if (outcome.matched > 0) return <span className="outcome-chip">{t("{{matches}} matches", { matches: outcome.matched })}</span>
  return null
}

/** The player's tickets; numbers that match the draw so far are highlighted. */
export function MyTickets({ game, owned, board }: { game: WingoGame; owned: OwnedTicket[]; board: DrawnBoard }) {
  const { t } = useTranslation()
  if (owned.length === 0) return null
  const hits = new Set(board.mains)
  return (
    <section className="card" aria-labelledby="my-tickets-title">
      <h2 id="my-tickets-title" className="card-title">
        {t("Your tickets in this draw")} <span className="muted">({owned.length})</span>
      </h2>
      <ul className="ticket-list">
        {owned.map((ticket, i) => (
          <li key={`${ticket.numbers.join("-")}:${ticket.lucky}:${i}`} className="ticket-row">
            <Balls numbers={ticket.numbers} lucky={ticket.lucky} hits={hits} luckyHit={board.lucky != null && board.lucky === ticket.lucky} />
            <OutcomeChip outcome={ticketOutcome(game, board, ticket)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Website `SharedPrizePoolNote`: a level pays one pool, divided between its winners. */
export function SharedPoolNote() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="pool-note">
      <span aria-hidden="true">ⓘ</span>
      <div className="pool-note-body">
        <p>{t("Each level's prize is one pool, shared equally between everyone who matches that level.")}</p>
        <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t("Hide example") : t("See an example")}
        </button>
        {open ? (
          <p>
            {t(
              "A level pool of $60 pays $20 each if 3 tickets match it, or $15 each if 4 do. Players reach a level at different times during the draw, so your own amount is confirmed once the final number is out.",
            )}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** Website `PrizesDistruction`: each level's pool, and once settled its winners and share. */
export function PrizeTable({ game }: { game: WingoGame }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const currency = getDisplayCurrency()
  const rows = prizeTable(game)
  if (rows.length === 0) return null
  const settled = winnersByName(game.winners)
  const showWinners = settled.size > 0
  return (
    <section className="card" aria-labelledby="prizes-title">
      <h2 id="prizes-title" className="card-title">
        {t("Prize distribution")}
      </h2>
      <ul className="prize-list">
        {rows.map((row) => {
          const s = settled.get(row.name)
          return (
            <li key={row.name}>
              <span className="prize-label">
                <span className="prize-dots" dir="ltr" aria-hidden="true">
                  {Array.from({ length: 6 }, (_, i) => (
                    <span key={i} className={`prize-dot${i < row.mains ? " prize-dot-on" : ""}`} />
                  ))}
                  <span className="prize-plus">+</span>
                  <span className={`prize-dot${row.lucky ? " prize-dot-lucky" : ""}`} />
                </span>
                <strong>{t(row.label)}</strong>
                <span className="muted small">
                  {row.lucky ? t("{{n}} numbers + lucky number", { n: row.mains }) : t("{{n}} numbers", { n: row.mains })}
                </span>
                {showWinners ? (
                  <span className="small">
                    {s && s.winners > 0
                      ? s.perTicket > 0
                        ? t("{{winners}} winning tickets · {{amount}} each", {
                            winners: formatCount(s.winners, lang),
                            amount: formatMoney(s.perTicket, currency, lang),
                          })
                        : t("{{winners}} winning tickets", { winners: formatCount(s.winners, lang) })
                      : t("No winners")}
                  </span>
                ) : null}
              </span>
              <span className="prize-amount">
                <strong dir="ltr">{formatMoney(row.prize, currency, lang)}</strong>
                <span className="muted small">{t("Level pool")}</span>
              </span>
            </li>
          )
        })}
      </ul>
      {showWinners ? (
        <p className="small">
          {t("Draw complete — {{winners}} winning tickets across all levels", { winners: formatCount(totalWinners(game.winners), lang) })}
        </p>
      ) : null}
      <SharedPoolNote />
    </section>
  )
}

/** Buying for this game: the shop while sales are open, otherwise why not. */
export function TicketSales({ game, open }: { game: WingoGame; open: boolean }) {
  const { t } = useTranslation()
  const [purchased, setPurchased] = useState(false)
  const tickets = useWingoTickets(game.gameId, true)
  const owned = tickets.data ?? []
  return (
    <>
      {purchased ? <Alert tone="info">{t("Your tickets are confirmed")}</Alert> : null}
      {!open ? (
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
    </>
  )
}

function GameView({ game }: { game: WingoGame }) {
  const { t } = useTranslation()
  const nav = useNav()
  const lang = currentLanguage()
  const currency = getDisplayCurrency()
  const now = useNow(1000)
  const tickets = useWingoTickets(game.gameId, true)
  const status = gameStatus(game, now)
  const phase = drawPhase(game, now)
  const timer = countdown(game, status, now)
  const owned = tickets.data ?? []
  const draw = game.drawAtMs ? formatDrawTime(game.drawAtMs / 1000, lang) : ""
  const drawn = splitDrawn(game.result, game.ticketRules?.mainCount ?? 6)
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
          <Balls numbers={drawn.mains} lucky={drawn.lucky} />
        </section>
      ) : null}

      <MyTickets game={game} owned={owned} board={drawn} />
      <TicketSales game={game} open={game.isTicketingOpen} />
      <PrizeTable game={game} />
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
