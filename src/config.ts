export const LANGUAGES = ["en", "ar", "fa", "fr"] as const
export type Language = (typeof LANGUAGES)[number]

export type AppConfig = {
  playerApiUrl: string
  siteUrl: string
  botUsername: string
  miniAppShortName: string
  defaultLang: Language
  debugTelemetryUrl: string
  debugTelemetryKey: string
}

const HTTPS_URL = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~/-]*)?$/

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value)
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function url(value: unknown): string {
  const v = text(value).replace(/\/+$/, "")
  return HTTPS_URL.test(v) ? v : ""
}

/**
 * Validates `window.__WINGOBINGO_CONFIG__`, written from .env at container
 * start by deploy/nginx/05-runtime-config.envsh (which already refuses bad
 * values). Returns null when the Player API URL is missing or unsafe, so the
 * app shows "temporarily unavailable" instead of calling a wrong host.
 */
export function parseConfig(raw: unknown): AppConfig | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const playerApiUrl = url(r.playerApiUrl)
  if (!playerApiUrl) return null
  const debugTelemetryUrl = url(r.debugTelemetryUrl)
  const debugTelemetryKey = text(r.debugTelemetryKey)
  const telemetry = Boolean(debugTelemetryUrl && debugTelemetryKey)
  const botUsername = text(r.botUsername)
  const miniAppShortName = text(r.miniAppShortName)
  return {
    playerApiUrl,
    siteUrl: url(r.siteUrl) || "https://wingobingo.tv",
    botUsername: /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(botUsername) ? botUsername : "",
    miniAppShortName: /^[A-Za-z0-9_]{3,30}$/.test(miniAppShortName) ? miniAppShortName : "",
    defaultLang: isLanguage(r.defaultLang) ? r.defaultLang : "en",
    debugTelemetryUrl: telemetry ? debugTelemetryUrl : "",
    debugTelemetryKey: telemetry ? debugTelemetryKey : "",
  }
}

export const config: AppConfig | null = parseConfig(
  typeof window === "undefined" ? undefined : window.__WINGOBINGO_CONFIG__,
)
