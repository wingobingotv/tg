import { useEffect, useRef, useState, type CSSProperties } from "react"
import { useTranslation } from "react-i18next"
import { getDisplayCurrency } from "../api"
import { Balls } from "../components/game"
import { Alert, Button, Spinner } from "../components/ui"
import { useDrawDays, useWingoWinners, type WinnersFilters } from "../data"
import { formatDrawTime, formatMoney } from "../format"
import { EVENT_TYPES, type WinnerDraw } from "../games/winners"
import { currentLanguage } from "../i18n"
import { useNav } from "../navigation"

const QUICK_DATES = 8
const SEARCH_DEBOUNCE_MS = 350
const NO_FILTERS: WinnersFilters = { eventType: "all", date: null, gameId: "" }

function formatDay(unixSec: number, lang: string, long = false): string {
  return new Date(unixSec * 1000).toLocaleDateString(lang, {
    month: long ? "long" : "short",
    day: "numeric",
    ...(long ? { year: "numeric" } : {}),
    timeZone: "UTC",
  })
}

export function WinnerCard({ draw }: { draw: WinnerDraw }) {
  const { t } = useTranslation()
  const nav = useNav()
  const lang = currentLanguage()
  const open = () => nav.open({ name: "winner", gameId: draw.gameId })
  const drawn = draw.drawAtMs ? formatDrawTime(draw.drawAtMs / 1000, lang) : ""

  return (
    <li className={`winner-card${draw.specialShow ? " winner-card-live" : ""}`} style={{ "--accent": draw.accent } as CSSProperties}>
      <button type="button" className="winner-head" onClick={open} aria-label={draw.title}>
        {draw.imageUrl ? <img src={draw.imageUrl} alt="" loading="lazy" decoding="async" /> : null}
        <span className="winner-head-text">
          {draw.specialShow ? (
            <span className="winner-badge">
              <span className="live-dot" aria-hidden="true" />
              {t("Live")} · {t("Special Live Show")}
            </span>
          ) : null}
          <span className="winner-title">{draw.title}</span>
          {draw.specialShow && draw.hostLabel ? (
            <span className="winner-host">{t("Hosted by {{name}}", { name: draw.hostLabel })}</span>
          ) : null}
        </span>
      </button>
      <div className="winner-body">
        <dl className="winner-facts">
          <div>
            <dt>{t("Game ID")}</dt>
            <dd dir="ltr">#{draw.gameId}</dd>
          </div>
          {drawn ? (
            <div>
              <dt>{t("Draw")}</dt>
              <dd dir="ltr">{drawn}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t("Winners")}</dt>
            <dd dir="ltr">{draw.winners.toLocaleString(lang)}</dd>
          </div>
          <div>
            <dt>{t("Jackpot up to")}</dt>
            <dd dir="ltr" className="winner-prize">
              {formatMoney(draw.reward, getDisplayCurrency(), lang)}
            </dd>
          </div>
        </dl>
        {draw.numbers.length > 0 || draw.lucky != null ? (
          <div className="winner-numbers">
            <p className="muted small">{t("Winning numbers")}</p>
            <Balls numbers={draw.numbers} lucky={draw.lucky} labelLucky />
          </div>
        ) : null}
        <Button variant="secondary" onClick={open}>
          {t("Detail")}
        </Button>
      </div>
    </li>
  )
}

function Filters({ value, onChange, total }: { value: WinnersFilters; onChange: (next: WinnersFilters) => void; total: number | null }) {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const days = useDrawDays(value.eventType)
  const [query, setQuery] = useState(value.gameId)
  const latest = useRef(value)
  latest.current = value

  useEffect(() => setQuery(value.gameId), [value.gameId])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = query.trim()
      if (trimmed !== latest.current.gameId) onChange({ ...latest.current, gameId: trimmed })
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query, onChange])

  const dates = days.data ?? []
  const active = value.eventType !== "all" || value.gameId !== "" || value.date !== null
  const eventLabel = EVENT_TYPES.find((e) => e.id === value.eventType)?.label

  return (
    <section className="card winners-filters" aria-label={t("Explore draw results")}>
      <div className="winners-filters-head">
        <h2 className="card-title">{t("Explore draw results")}</h2>
        {total != null ? (
          <p className="muted small">
            <strong dir="ltr">{total.toLocaleString(lang)}</strong> {t("draws found")}
          </p>
        ) : null}
      </div>

      <div className="chips" role="group" aria-label={t("All events")}>
        {EVENT_TYPES.map((e) => (
          <button
            key={e.id}
            type="button"
            className={`chip${value.eventType === e.id ? " chip-active" : ""}`}
            aria-pressed={value.eventType === e.id}
            onClick={() => onChange({ ...value, eventType: e.id, date: null })}
          >
            {t(e.short)}
          </button>
        ))}
      </div>

      <div className="search">
        <input
          className="field-input"
          inputMode="numeric"
          dir="ltr"
          placeholder={t("Search by game ID")}
          aria-label={t("Search by game ID")}
          value={query}
          onChange={(e) => setQuery(e.target.value.replace(/\D/g, "").slice(0, 12))}
        />
        {query ? (
          <button type="button" className="search-clear" aria-label={t("Clear search")} onClick={() => setQuery("")}>
            ×
          </button>
        ) : null}
      </div>

      <label className="field">
        <span className="field-label">{t("Draw date")}</span>
        <select
          className="field-input"
          value={value.date ?? ""}
          onChange={(e) => onChange({ ...value, date: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">{t("All dates")}</option>
          {dates.map((d) => (
            <option key={d} value={d}>
              {formatDay(d, lang, true)}
            </option>
          ))}
        </select>
      </label>
      {dates.length > 0 ? (
        <div className="chips chips-scroll">
          <button
            type="button"
            className={`chip${value.date === null ? " chip-active" : ""}`}
            aria-pressed={value.date === null}
            onClick={() => onChange({ ...value, date: null })}
          >
            {t("All dates")}
          </button>
          {dates.slice(0, QUICK_DATES).map((d) => (
            <button
              key={d}
              type="button"
              className={`chip${value.date === d ? " chip-active" : ""}`}
              aria-pressed={value.date === d}
              onClick={() => onChange({ ...value, date: d })}
            >
              {formatDay(d, lang)}
            </button>
          ))}
        </div>
      ) : null}

      {active ? (
        <div className="winners-active">
          <p className="muted small">
            {[
              value.eventType !== "all" && eventLabel ? t(eventLabel) : null,
              value.gameId ? `#${value.gameId}` : null,
              value.date !== null ? formatDay(value.date, lang, true) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <Button
            variant="link"
            onClick={() => {
              setQuery("")
              onChange(NO_FILTERS)
            }}
          >
            {t("Clear filters")}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

export function WinnersScreen() {
  const { t } = useTranslation()
  const nav = useNav()
  const [filters, setFilters] = useState<WinnersFilters>(NO_FILTERS)
  const winners = useWingoWinners(filters)
  const sentinel = useRef<HTMLLIElement | null>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = winners

  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasNextPage) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const pages = winners.data?.pages ?? []
  const draws = [...new Map(pages.flatMap((p) => p.items).map((d) => [d.gameId, d] as const)).values()]
  const total = pages[0]?.total ?? null
  const active = filters.eventType !== "all" || filters.gameId !== "" || filters.date !== null
  const refreshing = winners.isFetching && !winners.isFetchingNextPage && !winners.isPending

  return (
    <div className="stack">
      <header className="winners-hero">
        <p className="eyebrow">{t("Live draw archive")}</p>
        <h1 className="winners-hero-title">{t("Latest Draw Results")}</h1>
        <p className="muted">
          {t("Here you can find the results for all the lotteries. This page is updated right after each draw takes place!")}
        </p>
        <p className="winners-hero-badge">
          <span className="muted small">{t("Hall of fame")}</span> <strong>{t("Verified winners")}</strong>
        </p>
      </header>

      <Filters value={filters} onChange={setFilters} total={total} />

      {winners.isPending ? <Spinner /> : null}
      {winners.isError && draws.length === 0 ? (
        <div className="stack">
          <Alert tone="error">{t("Could not load the winners.")}</Alert>
          <Button variant="secondary" onClick={() => void winners.refetch()}>
            {t("Try again")}
          </Button>
        </div>
      ) : null}

      {!winners.isPending && !winners.isError && draws.length === 0 && !refreshing ? (
        active ? (
          <div className="card empty">
            <p className="card-title">{t("No winners match your search")}</p>
            <p className="muted">{t("Try another game ID, event type, or draw date")}</p>
            <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
              {t("Clear filters")}
            </Button>
          </div>
        ) : (
          <div className="card empty">
            <p className="card-title">{t("No draws yet")}</p>
            <p className="muted">{t("No lottery has been held yet. To join the tournament, click the button below.")}</p>
            <Button variant="secondary" onClick={() => nav.open({ name: "home" })}>
              {t("Go to the Wingo page")}
            </Button>
          </div>
        )
      ) : null}

      {draws.length > 0 ? (
        <>
          {refreshing ? <p className="muted small">{t("Updating results")}</p> : null}
          {active && !refreshing && total != null ? (
            <p className="muted small">{t("Showing {{count}} draws for your filters", { count: total })}</p>
          ) : null}
          <ul className={`winners${refreshing ? " is-refreshing" : ""}`}>
            {draws.map((d) => (
              <WinnerCard key={d.gameId} draw={d} />
            ))}
            {hasNextPage ? <li ref={sentinel} className="winners-sentinel" aria-hidden="true" /> : null}
          </ul>
          {isFetchingNextPage ? <Spinner /> : null}
        </>
      ) : null}
    </div>
  )
}
