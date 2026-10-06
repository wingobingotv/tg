import { useCallback, useEffect, useState } from "react"
import { ApiError, post, setAuthToken, setUnauthorizedHandler } from "../api"
import { config } from "../config"
import { browserStorage, clearSession, readSession, writeSession } from "../session"
import { getWebApp, telegramUserIdHint } from "../telegram"
import { trackDebug } from "../telemetry"
import { stateFromSessionResponse, type AuthState, type ReopenReason } from "./authFlow"

/**
 * One sign-in attempt per Mini App open. initData can open a session only
 * once (the backend refuses a replay), so a double effect run — React strict
 * mode, a remount — must share the same request.
 */
let inflight: Promise<AuthState> | null = null

async function signIn(): Promise<AuthState> {
  if (!config) return { kind: "unavailable" }
  const app = getWebApp()
  if (!app) return { kind: "outside_telegram" }

  const storage = browserStorage()
  const tgUserId = telegramUserIdHint(app)
  const stored = readSession(storage, tgUserId)
  if (stored) return { kind: "ready", token: stored.token, expiresAt: stored.expiresAt, startParam: null }

  try {
    const res = await post<unknown>("/auth/telegram/session", { initData: app.initData }, { auth: false })
    const state = stateFromSessionResponse(res)
    if (state.kind === "ready") writeSession(storage, state.token, state.expiresAt, tgUserId)
    if (state.kind !== "ready" && state.kind !== "link_required") {
      trackDebug("auth.session", "warn", `telegram session → ${state.kind}`, {
        reason: state.kind === "reopen_required" ? state.reason : null,
      })
    }
    return state
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) return { kind: "network_error" }
    if (err instanceof ApiError && err.status === 0) return { kind: "network_error" }
    return { kind: "unavailable" }
  }
}

export function useTelegramAuth() {
  const [state, setState] = useState<AuthState>({ kind: "booting" })

  const endSession = useCallback((reason: ReopenReason) => {
    clearSession(browserStorage())
    setAuthToken(null)
    inflight = null
    setState({ kind: "reopen_required", reason })
  }, [])

  const accept = useCallback((next: AuthState) => {
    if (next.kind === "ready") {
      setAuthToken(next.token)
    }
    setState(next)
  }, [])

  const start = useCallback(() => {
    setState({ kind: "booting" })
    inflight ??= signIn()
    void inflight.then((next) => {
      // A failed network attempt may be retried; a decided answer stays.
      if (next.kind === "network_error") inflight = null
      accept(next)
    })
  }, [accept])

  /** Called by the link screen with the session returned by /auth/telegram/link. */
  const completeLink = useCallback(
    (next: AuthState) => {
      if (next.kind === "ready") writeSession(browserStorage(), next.token, next.expiresAt, telegramUserIdHint(getWebApp()))
      accept(next)
    },
    [accept],
  )

  useEffect(() => {
    setUnauthorizedHandler(() => endSession("session_ended"))
    start()
    return () => setUnauthorizedHandler(null)
  }, [start, endSession])

  return { state, retry: start, completeLink, endSession }
}
