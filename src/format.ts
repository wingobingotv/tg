import type { Language } from "./config"

const LOCALE: Record<Language, string> = { en: "en-US", fr: "fr-FR", ar: "ar", fa: "fa-IR" }

export function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN
  return Number.isFinite(n) ? n : 0
}

/** Amount in the display currency. Codes Intl does not know (e.g. USDT) keep their code. */
export function formatMoney(value: unknown, currency: string, lang: Language): string {
  const amount = toNumber(value)
  try {
    return new Intl.NumberFormat(LOCALE[lang], {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    const n = new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 2 }).format(amount)
    return `${n} ${currency}`
  }
}

/** Draw time from the API (Unix seconds). Empty when missing. */
export function formatDrawTime(epochSec: unknown, lang: Language): string {
  const sec = toNumber(epochSec)
  if (sec <= 0) return ""
  return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(sec * 1000),
  )
}
