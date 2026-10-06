import { config } from "./config"
import { trackDebug } from "./telemetry"

/**
 * Player API client — the same endpoints and conventions as the website
 * (`WingoBingo/src/app/api/apiRequest.ts`): POST with a JSON body carrying
 * `metadata.currency`, and the raw session token in `Authorization`.
 */

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const TIMEOUT_MS = 30_000
const CURRENCY_RE = /^[A-Z]{3,5}$/

let authToken: string | null = null
let displayCurrency = "USD"
let onUnauthorized: (() => void) | null = null

export function setAuthToken(token: string | null): void {
  authToken = token
}

export function setDisplayCurrency(currency: unknown): void {
  if (typeof currency === "string" && CURRENCY_RE.test(currency)) displayCurrency = currency
}

export function getDisplayCurrency(): string {
  return displayCurrency
}

/** Called once when an authenticated call gets 401 (session gone or banned). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler
}

type RequestOptions = {
  /** Send the stored session token (default true). */
  auth?: boolean
  /** Use this token instead of the stored one (account-linking step). */
  token?: string
}

async function send(method: "GET" | "POST", path: string, body: unknown, opts: RequestOptions): Promise<unknown> {
  if (!config) throw new ApiError(0, "not_configured")
  const token = opts.token ?? (opts.auth === false ? null : authToken)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${config.playerApiUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: token } : {}),
      },
      body: method === "POST" ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError"
    trackDebug("api.error", "warn", `${method} ${path} → ${timedOut ? "timeout" : "network"}`, { path })
    throw new ApiError(0, timedOut ? "timeout" : "network")
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    trackDebug("api.error", res.status >= 500 ? "error" : "warn", `${method} ${path} → ${res.status}`, {
      path,
      status: res.status,
    })
    if (res.status === 401 && token && !opts.token) onUnauthorized?.()
    throw new ApiError(res.status, res.status === 401 ? "unauthorized" : "http_error")
  }

  try {
    return await res.json()
  } catch {
    throw new ApiError(res.status, "bad_json")
  }
}

export function post<T>(path: string, body: Record<string, unknown> = {}, opts: RequestOptions = {}): Promise<T> {
  const payload = {
    ...body,
    metadata: { currency: displayCurrency, ...(body.metadata as Record<string, unknown> | undefined) },
  }
  return send("POST", path, payload, opts) as Promise<T>
}

export function get<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return send("GET", path, undefined, opts) as Promise<T>
}

/** `{ success, message }` answers used by the auth endpoints. */
export type ResultMessage = { success?: boolean; message?: string }
