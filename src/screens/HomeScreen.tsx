import { useTranslation } from "react-i18next"
import { getDisplayCurrency } from "../api"
import { Countdown, StatusChip } from "../components/game"
import { Alert, Button, Spinner } from "../components/ui"
import { config } from "../config"
import { bingoUrl, useBingoGames, useProfile, useWallet, useWingoFeed, type GameCard } from "../data"
import { formatDrawTime, formatMoney, toNumber } from "../format"
import {
  countdown,
  gameStatus,
  isHostedShow,
  isLiveStatus,
  type GameStatus,
  type WingoGame,
} from "../games/wingo"
import { useNow } from "../hooks/useNow"
import { currentLanguage } from "../i18n"
import { useNav } from "../navigation"
import { openExternal } from "../telegram"

function WalletCard({ ready }: { ready: boolean }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const wallet = useWallet(ready)

  return (
    <section className="card wallet" aria-labelledby="wallet-title">
      <h2 id="wallet-title" className="card-title">
        {t("Wallet")}
      </h2>
      {wallet.isPending ? <Spinner /> : null}
      {wallet.isError ? <Alert tone="error">{t("Could not load your balance.")}</Alert> : null}
      {wallet.data ? (
        <>
          <p className="wallet-balance" dir="ltr">
            {formatMoney(wallet.data.balance, wallet.data.currency, lang)}
          </p>
          {toNumber(wallet.data.bonusBalance) > 0 ? (
            <p className="muted">
              {t("Bonus balance")}: <span dir="ltr">{formatMoney(wallet.data.bonusBalance, wallet.data.currency, lang)}</span>
            </p>
          ) : null}
          <Button variant="secondary" onClick={() => openExternal(`${config?.siteUrl ?? ""}/${lang}/more/deposit`)}>
            {t("Add funds on the website")}
          </Button>
        </>
      ) : null}
    </section>
  )
}

/** Website `hostedSort`: featured first, then live, starting soon, open, the rest; then draw time. */
const STATUS_RANK: Partial<Record<GameStatus, number>> = {
  live_now: 0,
  result_being_announced: 0.5,
  starting_soon: 1,
  registration_open: 2,
  scheduled: 3,
  registration_closed: 3,
}

type Entry = { game: WingoGame; status: GameStatus }

function byDraw(a: Entry, b: Entry): number {
  return (a.game.drawAtMs ?? Infinity) - (b.game.drawAtMs ?? Infinity)
}

function hostedSort(a: Entry, b: Entry): number {
  if (a.game.featured !== b.game.featured) return a.game.featured ? -1 : 1
  const rank = (STATUS_RANK[a.status] ?? 4) - (STATUS_RANK[b.status] ?? 4)
  return rank !== 0 ? rank : byDraw(a, b)
}

const HIDDEN: readonly GameStatus[] = ["cancelled", "temporarily_unavailable", "completed"]

function ShowCard({ entry, now }: { entry: Entry; now: number }) {
  const { t } = useTranslation()
  const nav = useNav()
  const lang = currentLanguage()
  const currency = getDisplayCurrency()
  const { game, status } = entry
  const live = isLiveStatus(status)
  const timer = countdown(game, status, now)
  const draw = game.drawAtMs ? formatDrawTime(game.drawAtMs / 1000, lang) : ""
  const open = () => nav.open(live ? { name: "live", gameId: game.gameId } : { name: "wingo", gameId: game.gameId })

  return (
    <li className={`show${live ? " show-live" : ""}`}>
      <button type="button" className="show-media" onClick={open} aria-label={game.name}>
        {game.heroUrl || game.imageUrl ? (
          <img src={game.heroUrl ?? game.imageUrl ?? ""} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="show-media-empty" aria-hidden="true" />
        )}
        <StatusChip status={status} />
      </button>
      <div className="show-body">
        <p className="show-title">{game.name}</p>
        {game.presenterName ? <p className="game-meta">{t("Hosted by {{name}}", { name: game.presenterName })}</p> : null}
        <div className="show-facts">
          {game.prizePool > 0 ? (
            <span>
              {t("Prize pool")}: <strong dir="ltr">{formatMoney(game.prizePool, currency, lang)}</strong>
            </span>
          ) : null}
          {game.ticketPrice > 0 ? (
            <span>
              {t("Ticket")}: <span dir="ltr">{formatMoney(game.ticketPrice, currency, lang)}</span>
            </span>
          ) : null}
          {game.freeTicketsRemaining > 0 && game.isTicketingOpen ? (
            <span className="free-badge">{t("{{count}} free ticket(s)", { count: game.freeTicketsRemaining })}</span>
          ) : null}
        </div>
        {timer.kind !== "none" ? (
          <Countdown kind={timer.kind} targetMs={timer.targetMs} now={now} />
        ) : draw && !live ? (
          <p className="game-meta">
            {t("Draw")}: <span dir="ltr">{draw}</span>
          </p>
        ) : null}
        <Button variant={live || status === "registration_open" || status === "starting_soon" ? "primary" : "secondary"} onClick={open}>
          {live ? t("Watch now") : game.isTicketingOpen ? t("Get tickets") : t("View details")}
        </Button>
      </div>
    </li>
  )
}

function ShowSection({ title, entries, now }: { title: string; entries: Entry[]; now: number }) {
  if (entries.length === 0) return null
  return (
    <section className="stack" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      <ul className="shows">
        {entries.map((e) => (
          <ShowCard key={e.game.gameId} entry={e} now={now} />
        ))}
      </ul>
    </section>
  )
}

function BingoRow({ game }: { game: GameCard }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const currency = getDisplayCurrency()
  const draw = formatDrawTime(game.drawDate, lang)

  return (
    <li className="game">
      {game.imageUrl ? (
        <img className="game-image" src={game.imageUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="game-image game-image-empty" aria-hidden="true" />
      )}
      <div className="game-body">
        <p className="game-title">{game.title || "Bingo"}</p>
        {toNumber(game.prizePool) > 0 ? (
          <p className="game-meta">
            {t("Prize pool")}: <span dir="ltr">{formatMoney(game.prizePool, currency, lang)}</span>
          </p>
        ) : null}
        {draw ? (
          <p className="game-meta">
            {t("Draw")}: <span dir="ltr">{draw}</span>
          </p>
        ) : null}
      </div>
      <Button variant="secondary" onClick={() => openExternal(bingoUrl(config?.siteUrl ?? "", lang, game))}>
        {t("Play")}
      </Button>
    </li>
  )
}

function BingoSection({ ready }: { ready: boolean }) {
  const { t } = useTranslation()
  const bingo = useBingoGames(ready)
  if (!bingo.data?.length) return null
  return (
    <section className="card" aria-label={t("Bingo")}>
      <h2 className="card-title">{t("Bingo")}</h2>
      <ul className="games">
        {bingo.data.map((g) => (
          <BingoRow key={g.key} game={g} />
        ))}
      </ul>
      <p className="muted small">{t("Bingo opens on the website for now.")}</p>
    </section>
  )
}

export function HomeScreen() {
  const { t } = useTranslation()
  const profile = useProfile()
  const ready = profile.isSuccess
  const feed = useWingoFeed(ready)
  const now = useNow(1000)

  if (profile.isError) {
    return (
      <div className="stack">
        <Alert tone="error">{t("Could not load your account.")}</Alert>
        <Button onClick={() => void profile.refetch()}>{t("Try again")}</Button>
      </div>
    )
  }

  const entries = feed.games
    .map((game) => ({ game, status: gameStatus(game, now) }))
    .filter((e) => !HIDDEN.includes(e.status))
  const hosted = entries.filter((e) => isHostedShow(e.game))
  const liveNow = hosted.filter((e) => isLiveStatus(e.status)).sort(hostedSort)
  const shows = hosted.filter((e) => !isLiveStatus(e.status)).sort(hostedSort)
  const wingo = entries.filter((e) => !isHostedShow(e.game)).sort(byDraw)

  return (
    <div className="stack">
      <p className="greeting">
        {profile.data?.name ? t("Hi {{name}}!", { name: profile.data.name }) : t("Welcome to WingoBingo")}
      </p>
      <ShowSection title={t("Live now")} entries={liveNow} now={now} />
      <WalletCard ready={ready} />
      {feed.isPending ? <Spinner /> : null}
      {feed.isError ? (
        <div className="stack">
          <Alert tone="error">{t("Could not load the games.")}</Alert>
          <Button variant="secondary" onClick={feed.refetch}>
            {t("Try again")}
          </Button>
        </div>
      ) : null}
      <ShowSection title={t("Live shows")} entries={shows} now={now} />
      <ShowSection title={t("Wingo")} entries={wingo} now={now} />
      {!feed.isPending && !feed.isError && entries.length === 0 ? <p className="muted">{t("No open games right now.")}</p> : null}
      <BingoSection ready={ready} />
    </div>
  )
}
