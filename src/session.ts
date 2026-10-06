/**
 * The Player API session token for this Mini App open.
 *
 * Kept in sessionStorage: Telegram keeps it while the Mini App stays open
 * (initData can open a session only once — the backend refuses a replay),
 * and it is gone once the WebView closes.
 */

export type StoredSession = {
  token: string
  /** Epoch ms; null when the server did not say. */
  expiresAt: number | null
  /** Telegram user the session was issued for (display hint, not proof). */
  tgUserId: number | null
}

export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

const KEY = "wb.tg.session"
const TOKEN_RE = /^[A-Za-z0-9_-]{16,256}$/

export function readSession(
  storage: KeyValueStorage | null,
  tgUserId: number | null,
  now: number = Date.now(),
): StoredSession | null {
  if (!storage) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(storage.getItem(KEY) ?? "null")
  } catch {
    parsed = null
  }
  if (!parsed || typeof parsed !== "object") return null
  const s = parsed as Partial<StoredSession>
  const valid =
    typeof s.token === "string" &&
    TOKEN_RE.test(s.token) &&
    (s.expiresAt === null || (typeof s.expiresAt === "number" && s.expiresAt > now)) &&
    (s.tgUserId ?? null) === tgUserId
  if (!valid) {
    clearSession(storage)
    return null
  }
  return { token: s.token as string, expiresAt: s.expiresAt ?? null, tgUserId: s.tgUserId ?? null }
}

export function writeSession(
  storage: KeyValueStorage | null,
  token: string,
  expiresAtIso: unknown,
  tgUserId: number | null,
): StoredSession | null {
  if (!TOKEN_RE.test(token)) return null
  const ms = typeof expiresAtIso === "string" ? Date.parse(expiresAtIso) : NaN
  const session: StoredSession = { token, expiresAt: Number.isFinite(ms) ? ms : null, tgUserId }
  try {
    storage?.setItem(KEY, JSON.stringify(session))
  } catch {
    // Storage can be full or blocked; the session still works for this page.
  }
  return session
}

export function clearSession(storage: KeyValueStorage | null): void {
  try {
    storage?.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}

export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}
