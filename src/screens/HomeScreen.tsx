import { useTranslation } from "react-i18next"
import { getDisplayCurrency } from "../api"
import { Alert, Button, Spinner } from "../components/ui"
import { config } from "../config"
import { gameUrl, useBingoGames, useProfile, useWallet, useWingoGames, type GameCard } from "../data"
import { formatDrawTime, formatMoney, toNumber } from "../format"
import { currentLanguage } from "../i18n"
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

function GameRow({ game }: { game: GameCard }) {
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
        <p className="game-title">{game.title || (game.kind === "wingo" ? "Wingo" : "Bingo")}</p>
        {toNumber(game.prizePool) > 0 ? (
          <p className="game-meta">
            {t("Prize pool")}: <span dir="ltr">{formatMoney(game.prizePool, currency, lang)}</span>
          </p>
        ) : null}
        {toNumber(game.ticketPrice) > 0 ? (
          <p className="game-meta">
            {t("Ticket")}: <span dir="ltr">{formatMoney(game.ticketPrice, currency, lang)}</span>
          </p>
        ) : null}
        {draw ? (
          <p className="game-meta">
            {t("Draw")}: <span dir="ltr">{draw}</span>
          </p>
        ) : null}
      </div>
      <Button onClick={() => openExternal(gameUrl(config?.siteUrl ?? "", lang, game))}>{t("Play")}</Button>
    </li>
  )
}

function GameSection({
  title,
  query,
}: {
  title: string
  query: { isPending: boolean; isError: boolean; data?: GameCard[]; refetch: () => unknown }
}) {
  const { t } = useTranslation()
  return (
    <section className="card" aria-label={title}>
      <h2 className="card-title">{title}</h2>
      {query.isPending ? <Spinner /> : null}
      {query.isError ? (
        <div className="stack">
          <Alert tone="error">{t("Could not load the games.")}</Alert>
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t("Try again")}
          </Button>
        </div>
      ) : null}
      {query.data && query.data.length === 0 ? <p className="muted">{t("No open games right now.")}</p> : null}
      {query.data && query.data.length > 0 ? (
        <ul className="games">
          {query.data.map((g) => (
            <GameRow key={g.key} game={g} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}

export function HomeScreen() {
  const { t } = useTranslation()
  const profile = useProfile()
  const ready = profile.isSuccess
  const wingo = useWingoGames(ready)
  const bingo = useBingoGames(ready)

  if (profile.isError) {
    return (
      <div className="stack">
        <Alert tone="error">{t("Could not load your account.")}</Alert>
        <Button onClick={() => void profile.refetch()}>{t("Try again")}</Button>
      </div>
    )
  }

  return (
    <div className="stack">
      <p className="greeting">
        {profile.data?.name ? t("Hi {{name}}!", { name: profile.data.name }) : t("Welcome to WingoBingo")}
      </p>
      <WalletCard ready={ready} />
      <GameSection title={t("Wingo")} query={wingo} />
      <GameSection title={t("Bingo")} query={bingo} />
      <p className="muted small">{t("Tickets open on the website for now. Buying inside Telegram is coming soon.")}</p>
    </div>
  )
}
