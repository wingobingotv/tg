import type { CSSProperties } from "react"
import { useTranslation } from "react-i18next"
import { getDisplayCurrency } from "../api"
import { Balls, PrivateGate, Replay } from "../components/game"
import { Alert, Button, Spinner } from "../components/ui"
import { useWinnerDetail } from "../data"
import { formatDrawTime, formatMoney } from "../format"
import { TIMELINE_COPY, type PrizeRow, type WinnerDetail } from "../games/winners"
import { currentLanguage } from "../i18n"

function Money({ value }: { value: number }) {
  const lang = currentLanguage()
  if (value <= 0) return <span className="muted">—</span>
  return <span dir="ltr">{formatMoney(value, getDisplayCurrency(), lang)}</span>
}

function PrizeTable({ rows }: { rows: PrizeRow[] }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  if (rows.length === 0) {
    return (
      <section className="card">
        <h2 className="card-title">{t("Prize breakdown")}</h2>
        <p className="muted">{t("There is no winners")}</p>
      </section>
    )
  }
  const totalWinners = rows.reduce((sum, r) => sum + r.count, 0)
  const totalPool = rows.reduce((sum, r) => sum + r.pool, 0)

  return (
    <section className="card">
      <h2 className="card-title">{t("Prize breakdown")}</h2>
      <p className="muted small">{t("A level's prize is split equally between its winning tickets.")}</p>
      <ul className="prize-rows">
        {rows.map((r) => (
          <li key={r.tier} className={`prize-row${r.jackpot ? " prize-row-jackpot" : ""}`}>
            <p className="prize-row-head">
              <strong>{t(r.tier)}</strong>
              <span className="muted small" dir="ltr">
                {r.match}
              </span>
              {r.rolledOver ? <span className="chip chip-small">{t("Rolled over")}</span> : null}
            </p>
            <dl className="prize-row-facts">
              <div>
                <dt>{t("winners")}</dt>
                <dd dir="ltr">{r.count.toLocaleString(lang)}</dd>
              </div>
              <div>
                <dt>{t("Each winner")}</dt>
                <dd>{r.count > 0 ? <Money value={r.each} /> : <span className="muted">—</span>}</dd>
              </div>
              <div>
                <dt>{t("Prize pool")}</dt>
                <dd>
                  <Money value={r.pool} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <p className="prize-total">
        <span>{t("Total")}</span>
        <span dir="ltr">{totalWinners.toLocaleString(lang)}</span>
        <Money value={totalPool} />
      </p>
    </section>
  )
}

function Detail({ detail }: { detail: WinnerDetail }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const drawn = detail.drawAtMs ? formatDrawTime(detail.drawAtMs / 1000, lang) : ""

  return (
    <div className="stack winner-detail" style={{ "--accent": detail.accent } as CSSProperties}>
      <section className="card winner-info">
        <p className="winner-info-tags">
          {detail.specialShow ? (
            <span className="winner-badge">
              <span className="live-dot" aria-hidden="true" />
              {t("Live")}
            </span>
          ) : null}
          {detail.specialShow && detail.hostLabel ? (
            <span className="muted small">{t("Hosted by {{name}}", { name: detail.hostLabel })}</span>
          ) : null}
          <span className="status-chip status-done">{t("Draw completed")}</span>
        </p>
        <h1 className="card-title">{detail.title}</h1>
        <dl className="winner-facts">
          <div>
            <dt>{t("Game ID")}</dt>
            <dd dir="ltr">#{detail.gameId}</dd>
          </div>
          <div>
            <dt>{t("Draw")}</dt>
            <dd dir="ltr">{drawn || "—"}</dd>
          </div>
          <div>
            <dt>{t("Jackpot up to")}</dt>
            <dd className="winner-prize">
              <Money value={detail.prize} />
            </dd>
          </div>
          <div>
            <dt>{t("Winners")}</dt>
            <dd dir="ltr">{detail.winnersCount.toLocaleString(lang)}</dd>
          </div>
        </dl>
      </section>

      <section className="card">
        <h2 className="card-title">{t("Winning numbers")}</h2>
        <p className="muted small">{t("Official draw results")}</p>
        {detail.numbers.length > 0 ? (
          <Balls numbers={detail.numbers} lucky={detail.lucky} labelLucky />
        ) : (
          <p className="muted">{t("Draw numbers are not available yet")}</p>
        )}
      </section>

      <PrizeTable rows={detail.rows} />

      <section className="card">
        <h2 className="card-title">{t("Draw Result")}</h2>
        {detail.replayUrl ? (
          <Replay url={detail.replayUrl} />
        ) : (
          <p className="muted">{t("Replay recording is not available yet for this game.")}</p>
        )}
      </section>

      {detail.timeline.length > 0 ? (
        <section className="card">
          <h2 className="card-title">{t("Game timeline")}</h2>
          <ol className="timeline">
            {detail.timeline.map((e) => (
              <li key={e.id}>
                <span>{t(TIMELINE_COPY[e.id])}</span>
                <span className="muted small" dir="ltr">
                  {formatDrawTime(e.atMs / 1000, lang)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  )
}

export function WinnerDetailScreen({ gameId }: { gameId: string }) {
  const { t } = useTranslation()
  const query = useWinnerDetail(gameId)

  if (query.isPending) return <Spinner />
  if (query.isError || !query.data) {
    return (
      <div className="stack">
        <Alert tone="error">{t("Could not load this draw.")}</Alert>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t("Try again")}
        </Button>
      </div>
    )
  }
  if (query.data.locked) return <PrivateGate gameId={gameId} />
  return <Detail detail={query.data.detail} />
}
