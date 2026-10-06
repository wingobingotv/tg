import { useTranslation } from "react-i18next"
import { getDisplayCurrency } from "../api"
import { Countdown, StatusChip } from "../components/game"
import { Alert, Button, Spinner } from "../components/ui"
import { useProfile, useWallet, useWingoFeed } from "../data"
import { formatDrawTime, formatMoney, toNumber } from "../format"
import {
  CADENCE_COPY,
  CADENCES,
  countdown,
  gameStatus,
  isHostedShow,
  isLiveStatus,
  playToday,
  timeLeft,
  type Cadence,
  type GameStatus,
  type WingoGame,
} from "../games/wingo"
import { useNow } from "../hooks/useNow"
import { currentLanguage } from "../i18n"
import { useNav } from "../navigation"

function WalletCard({ ready }: { ready: boolean }) {
  const { t } = useTranslation()
  const nav = useNav()
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
          <Button variant="secondary" onClick={() => nav.open({ name: "add-funds" })}>
            {t("Add funds")}
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

const pad = (n: number) => String(n).padStart(2, "0")

/** Website `countdownLabel` for the Play Today cards. */
function useCadenceTimerLabel(game: WingoGame | null, status: GameStatus | null, kind: string): string {
  const { t } = useTranslation()
  if (!game) return t("Starts in")
  if (status === "live_now") return t("Live now")
  if (kind === "registration_closes") return t("Registration closes in")
  return t("Next draw in")
}

function Clock({ targetMs, now }: { targetMs: number; now: number }) {
  const { t } = useTranslation()
  const left = timeLeft(targetMs, now)
  return (
    <span className="cadence-clock">
      {left.days > 0 ? <span>{t("{{count}}d", { count: left.days })} </span> : null}
      <span dir="ltr">
        {pad(left.hours)}:{pad(left.minutes)}:{pad(left.seconds)}
      </span>
    </span>
  )
}

/** Website Play Today `ModeCard`: daily is the large poster card, 15-minute and hourly the small ones. */
function CadenceCard({ cadence, game, now }: { cadence: Cadence; game: WingoGame | null; now: number }) {
  const { t } = useTranslation()
  const nav = useNav()
  const lang = currentLanguage()
  const copy = CADENCE_COPY[cadence]
  const status = game ? gameStatus(game, now) : null
  const live = status != null && isLiveStatus(status)
  const timer = game && status ? countdown(game, status, now) : { kind: "none" as const, targetMs: null }
  const target = timer.targetMs ?? (game?.drawAtMs != null && game.drawAtMs > now ? game.drawAtMs : null)
  const daily = cadence === "daily"
  const todayAt = game?.drawAtMs
    ? new Date(game.drawAtMs).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })
    : null
  const open = game ? () => nav.open(live ? { name: "live", gameId: game.gameId } : { name: "wingo", gameId: game.gameId }) : null
  const cta = live ? t("Watch now") : status === "registration_open" || status === "starting_soon" ? t("Get tickets") : t("View details")
  const poster = daily && game ? (game.heroUrl ?? game.imageUrl) : null
  const timerLabel = useCadenceTimerLabel(game, status, timer.kind)

  return (
    <li className={`cadence${daily ? " cadence-daily" : ""}${poster ? " cadence-poster" : ""}${live ? " cadence-live" : ""}`}>
      {poster ? <img className="cadence-bg" src={poster} alt="" loading="lazy" decoding="async" /> : null}
      <div className="cadence-body">
        {daily ? (
          <p className="cadence-title">{t(copy.label)}</p>
        ) : (
          <div className="cadence-id">
            <span className="cadence-mark" aria-hidden="true">
              <strong dir="ltr">{copy.value}</strong>
              <span>{t(copy.unit)}</span>
            </span>
            <span>
              <span className="cadence-hint">{t(copy.hint)}</span>
              <span className="cadence-title">{t(copy.short)}</span>
            </span>
          </div>
        )}
        {daily && todayAt ? <p className="cadence-meta">{t("Today at {{time}}", { time: todayAt })}</p> : null}
        {!daily && live ? <p className="cadence-live-label">{t("Live now")}</p> : null}

        <div className={daily ? "cadence-stats-daily" : "cadence-stats"}>
          <div>
            <p className="cadence-label">{daily ? t("Prize pool") : t("Prize")}</p>
            <p className="cadence-prize" dir="ltr">
              {game ? formatMoney(game.prizePool, getDisplayCurrency(), lang) : "—"}
            </p>
          </div>
          <div>
            <p className="cadence-label">{timerLabel}</p>
            {live ? (
              <p className="cadence-live-label">{daily ? t("Live now") : t("Live")}</p>
            ) : game && target ? (
              <Clock targetMs={target} now={now} />
            ) : (
              <p className="cadence-meta">{t("Coming soon")}</p>
            )}
          </div>
        </div>

        {open ? (
          <Button variant={live || status === "registration_open" || status === "starting_soon" ? "primary" : "secondary"} onClick={open}>
            {cta}
          </Button>
        ) : null}
      </div>
    </li>
  )
}

/** Website `HomePlayToday`, Wingo column. */
function PlayToday({ slots, now }: { slots: Record<Cadence, WingoGame | null>; now: number }) {
  const { t } = useTranslation()
  return (
    <section className="stack" aria-labelledby="play-today">
      <div>
        <p className="eyebrow" id="play-today">
          {t("Play Today")}
        </p>
        <h2 className="section-title">{t("Your next chances to play & win.")}</h2>
        <p className="muted small">{t("Automated draws by schedule — tickets before the draw, live after it starts.")}</p>
      </div>
      <ul className="cadences">
        {CADENCES.map((c) => (
          <CadenceCard key={c} cadence={c} game={slots[c]} now={now} />
        ))}
      </ul>
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

  const hosted = feed.games
    .filter(isHostedShow)
    .map((game) => ({ game, status: gameStatus(game, now) }))
    .filter((e) => !HIDDEN.includes(e.status))
  const liveNow = hosted.filter((e) => isLiveStatus(e.status)).sort(hostedSort)
  const shows = hosted.filter((e) => !isLiveStatus(e.status)).sort(hostedSort)
  const today = playToday(feed.games, now)
  const scheduled = today.scheduled.map((game) => ({ game, status: gameStatus(game, now) }))

  return (
    <div className="stack">
      <p className="greeting">
        {profile.data?.name ? t("Hi {{name}}!", { name: profile.data.name }) : t("Welcome to WingoBingo")}
      </p>
      {feed.isPending ? <Spinner /> : null}
      {feed.isError ? (
        <div className="stack">
          <Alert tone="error">{t("Could not load the games.")}</Alert>
          <Button variant="secondary" onClick={feed.refetch}>
            {t("Try again")}
          </Button>
        </div>
      ) : null}
      <ShowSection title={t("Live now")} entries={liveNow} now={now} />
      <ShowSection title={t("Live shows")} entries={shows} now={now} />
      {!feed.isPending && !feed.isError ? <PlayToday slots={today.slots} now={now} /> : null}
      <ShowSection title={t("Next Shows")} entries={scheduled} now={now} />
      <WalletCard ready={ready} />
    </div>
  )
}
