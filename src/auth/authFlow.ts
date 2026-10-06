/**
 * Pure mapping from Player API auth answers to Mini App states.
 * Every code here is listed in docs/TELEGRAM_AUTH.md.
 */

export type ReopenReason = "invalid" | "expired" | "replayed" | "session_ended" | "unlinked" | "signed_out"

export type AuthState =
  | { kind: "booting" }
  | { kind: "outside_telegram" }
  | { kind: "unavailable" }
  | { kind: "network_error" }
  | { kind: "reopen_required"; reason: ReopenReason }
  | { kind: "banned" }
  | {
      kind: "link_required"
      linkTicket: string
      linkTicketExpiresAt: number | null
      firstName: string
      username: string
      startParam: string | null
    }
  | { kind: "ready"; token: string; expiresAt: unknown; startParam: string | null }

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function startParamOf(value: unknown): string | null {
  const s = str(value)
  return /^[A-Za-z0-9_-]{1,512}$/.test(s) ? s : null
}

const FAILURE_STATES: Record<string, AuthState> = {
  telegram_not_configured: { kind: "unavailable" },
  telegram_auth_disabled: { kind: "unavailable" },
  invalid_init_data: { kind: "reopen_required", reason: "invalid" },
  init_data_expired: { kind: "reopen_required", reason: "expired" },
  init_data_replayed: { kind: "reopen_required", reason: "replayed" },
  user_is_banned: { kind: "banned" },
}

/** Answer of POST /auth/telegram/session. */
export function stateFromSessionResponse(res: unknown): AuthState {
  if (!res || typeof res !== "object") return { kind: "unavailable" }
  const r = res as Record<string, unknown>
  if (r.success !== true) return FAILURE_STATES[str(r.message)] ?? { kind: "unavailable" }

  if (r.status === "linked" && str(r.userAuth)) {
    return { kind: "ready", token: str(r.userAuth), expiresAt: r.sessionExpiresAt, startParam: startParamOf(r.startParam) }
  }
  if (r.status === "link_required" && str(r.linkTicket)) {
    const user = (r.telegramUser && typeof r.telegramUser === "object" ? r.telegramUser : {}) as Record<string, unknown>
    const expires = Date.parse(str(r.linkTicketExpiresAt))
    return {
      kind: "link_required",
      linkTicket: str(r.linkTicket),
      linkTicketExpiresAt: Number.isFinite(expires) ? expires : null,
      firstName: str(user.firstName),
      username: str(user.username),
      startParam: startParamOf(r.startParam),
    }
  }
  return { kind: "unavailable" }
}

/** Answer of POST /auth/telegram/link (after a fresh email login) or /auth/telegram/connect with `confirm`. */
export function stateFromLinkResponse(res: unknown): AuthState | null {
  if (!res || typeof res !== "object") return null
  const r = res as Record<string, unknown>
  if (r.success === true && str(r.userAuth)) {
    return { kind: "ready", token: str(r.userAuth), expiresAt: r.sessionExpiresAt, startParam: startParamOf(r.startParam) }
  }
  if (r.message === "user_is_banned") return { kind: "banned" }
  if (r.message === "telegram_not_configured" || r.message === "telegram_auth_disabled") return { kind: "unavailable" }
  return null
}

/**
 * Connect codes come from the website after a Google sign-in, either in the
 * deep link (`startapp=lk_ABCDEFGH`) or typed as `ABCD-EFGH`. Same alphabet
 * as the Player API (no 0/O/1/I/L); the server decides whether it is valid.
 */
const CONNECT_CODE_CHARS = /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g
const CONNECT_START_RE = /^lk_([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8})$/

export function connectCodeFromStartParam(startParam: string | null): string | null {
  const code = startParam ? CONNECT_START_RE.exec(startParam)?.[1] : undefined
  return code ? formatConnectCodeInput(code) : null
}

/** Live formatting for the code field: upper case, allowed characters, `XXXX-XXXX`. */
export function formatConnectCodeInput(value: string): string {
  const s = value.toUpperCase().replace(CONNECT_CODE_CHARS, "").slice(0, 8)
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s
}

export function isCompleteConnectCode(value: string): boolean {
  return formatConnectCodeInput(value).length === 9
}

/** Answer of POST /auth/telegram/connect without `confirm`: which account the code is for. */
export function connectPreviewFrom(res: unknown): { maskedEmail: string } | null {
  if (!res || typeof res !== "object") return null
  const r = res as Record<string, unknown>
  if (r.success !== true || r.status !== "confirm") return null
  const account = (r.account && typeof r.account === "object" ? r.account : {}) as Record<string, unknown>
  return { maskedEmail: str(account.maskedEmail) }
}

/**
 * English copy for a login / register / link failure code. The English text is
 * the translation key (locales/<lang>/translation.json).
 */
export const AUTH_ERROR_COPY: Record<string, string> = {
  invalid_login: "The email or password is not correct.",
  wrong_captcha: "The security code is not correct. Try the new one.",
  use_google_login: "This account signs in with Google. Use “Continue with Google” instead.",
  user_could_not_be_empty: "Enter your email.",
  password_could_not_be_empty: "Enter your password.",
  user_length_too_long: "This email is too long.",
  password_length_too_long: "The password can be at most 50 characters.",
  user_is_banned: "This account is suspended. Contact support for help.",
  invalid_name_format: "Enter your name (up to 100 characters).",
  invalid_email_format: "Enter a valid email address.",
  invalid_username_format: "The username can use only English letters and digits (up to 30).",
  min_password_length: "The password needs at least 8 characters.",
  max_password_length: "The password can be at most 50 characters.",
  unequal_passwords: "The two passwords do not match.",
  duplicate_email: "An account with this email already exists. Sign in instead.",
  duplicate_username: "This username is taken. Choose another one.",
  duplicate_mobileNumber: "An account with this phone number already exists.",
  fresh_login_required: "For your security, sign in again to connect Telegram.",
  link_ticket_invalid: "This connection request has expired. Close and reopen the app from the bot.",
  telegram_already_linked: "This Telegram account is already connected to another WingoBingo account.",
  account_already_linked: "This WingoBingo account is already connected to another Telegram account.",
  code_invalid: "This code is not correct or has expired. Get a new one in the browser.",
  too_many_attempts: "Too many wrong codes. Wait a few minutes, then try again.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  network: "Connection problem. Check your internet and try again.",
}

export const REOPEN_COPY: Record<ReopenReason, string> = {
  invalid: "We could not confirm this Telegram session. Close the app and open it again from the bot.",
  expired: "This session has expired. Close the app and open it again from the bot.",
  replayed: "This session was already used. Close the app and open it again from the bot.",
  session_ended: "You have been signed out. Close the app and open it again from the bot.",
  unlinked: "Telegram is disconnected from your account. Open the app again from the bot to connect it.",
  signed_out: "You are signed out. Opening the app from the bot signs you in again.",
}

export const GENERIC_ERROR = "Something went wrong. Please try again."

export function authErrorCopy(code: unknown): string {
  return AUTH_ERROR_COPY[str(code)] ?? GENERIC_ERROR
}
