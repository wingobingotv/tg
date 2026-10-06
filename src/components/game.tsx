import { useQueryClient } from "@tanstack/react-query"
import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { apiErrorDetail, post, setPrivateAccessToken } from "../api"
import { winnerDetailKey, wingoGameKey, wingoTicketsKey } from "../data"
import { isYouTubeUrl, timeLeft, type CountdownKind, type GameStatus } from "../games/wingo"
import { haptic, openExternal } from "../telegram"
import { Alert, Button, Field } from "./ui"

/** Status chip copy, same states as the website's home cards. */
export const STATUS_COPY: Record<GameStatus, string> = {
  live_now: "Live now",
  result_being_announced: "Results are coming",
  starting_soon: "Starting soon",
  registration_open: "Tickets on sale",
  registration_closed: "Sales closed",
  scheduled: "Scheduled",
  completed: "Finished",
  cancelled: "Cancelled",
  temporarily_unavailable: "Temporarily unavailable",
}

export const COUNTDOWN_COPY: Record<Exclude<CountdownKind, "none">, string> = {
  registration_closes: "Sales close in",
  draw_starts: "Draw in",
  game_starts: "Starts in",
}

export function StatusChip({ status }: { status: GameStatus }) {
  const { t } = useTranslation()
  const live = status === "live_now" || status === "result_being_announced"
  return (
    <span className={`status-chip status-${live ? "live" : status === "completed" ? "done" : "open"}`}>
      {live ? <span className="live-dot" aria-hidden="true" /> : null}
      {t(STATUS_COPY[status])}
    </span>
  )
}

const pad = (n: number) => String(n).padStart(2, "0")

export function Countdown({ kind, targetMs, now }: { kind: CountdownKind; targetMs: number | null; now: number }) {
  const { t } = useTranslation()
  if (kind === "none" || targetMs == null) return null
  const left = timeLeft(targetMs, now)
  return (
    <p className="countdown">
      <span className="muted">{t(COUNTDOWN_COPY[kind])}</span>{" "}
      {left.days > 0 ? <span>{t("{{count}}d", { count: left.days })} </span> : null}
      <span dir="ltr" className="countdown-clock">
        {pad(left.hours)}:{pad(left.minutes)}:{pad(left.seconds)}
      </span>
    </p>
  )
}

/** Drawn or picked numbers; `hits` are highlighted (matches with the draw). */
export function Balls({
  numbers,
  lucky,
  hits,
  luckyHit,
  labelLucky = false,
}: {
  numbers: readonly number[]
  lucky?: number | null
  hits?: ReadonlySet<number>
  luckyHit?: boolean
  /** Website winners style: "Lucky" above the lucky ball. */
  labelLucky?: boolean
}) {
  const { t } = useTranslation()
  const luckyBall = lucky != null ? <span className={`ball ball-lucky${luckyHit ? " ball-hit" : ""}`}>{lucky}</span> : null
  return (
    <span className="balls" dir="ltr">
      {numbers.map((n, i) => (
        <span key={`${n}-${i}`} className={`ball${hits?.has(n) ? " ball-hit" : ""}`}>
          {n}
        </span>
      ))}
      {luckyBall && labelLucky ? (
        <span className="ball-lucky-wrap">
          <span className="ball-lucky-label">{t("Lucky")}</span>
          {luckyBall}
        </span>
      ) : (
        luckyBall
      )}
    </span>
  )
}

/** Recorded show: YouTube opens outside Telegram, files play in place. */
export function Replay({ url }: { url: string }) {
  const { t } = useTranslation()
  if (isYouTubeUrl(url)) {
    return (
      <div className="stage stage-empty">
        <Button onClick={() => openExternal(url)}>{t("Watch the replay")}</Button>
      </div>
    )
  }
  return (
    <div className="stage">
      <video className="stage-video" src={url} controls playsInline preload="metadata" />
    </div>
  )
}

/** Password form for private Wingo games (`/wingo/unlockPrivateGame`). */
export function PrivateGate({ gameId }: { gameId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !password) return
    setBusy(true)
    setError("")
    try {
      const res = await post<{ data?: { accessToken?: unknown } }>("/wingo/unlockPrivateGame", { gameId, password })
      setPrivateAccessToken(gameId, res.data?.accessToken)
      haptic("success")
      setPassword("")
      await queryClient.invalidateQueries({ queryKey: wingoGameKey(gameId) })
      await queryClient.invalidateQueries({ queryKey: wingoTicketsKey(gameId) })
      await queryClient.invalidateQueries({ queryKey: winnerDetailKey(gameId) })
    } catch (err) {
      haptic("error")
      setError(apiErrorDetail(err).status === 429 ? t("Too many attempts. Try again later.") : t("Incorrect password"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card" onSubmit={(e) => void submit(e)}>
      <h2 className="card-title">{t("Private game")}</h2>
      <p className="muted">{t("This game is private. Enter the password to see it.")}</p>
      <Field
        label={t("Password")}
        type="password"
        autoComplete="off"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" busy={busy} disabled={!password}>
        {t("Unlock")}
      </Button>
    </form>
  )
}
