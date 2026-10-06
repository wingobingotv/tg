import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import ar from "../locales/ar/translation.json"
import en from "../locales/en/translation.json"
import fa from "../locales/fa/translation.json"
import fr from "../locales/fr/translation.json"
import { AUTH_ERROR_COPY, GENERIC_ERROR, REOPEN_COPY } from "./auth/authFlow"
import { COUNTDOWN_COPY, STATUS_COPY } from "./components/game"
import { DETAIL_TIERS, EVENT_TYPES, TIMELINE_COPY } from "./games/winners"
import { CADENCE_COPY, CART_PROBLEM_COPY, PRIZE_TIERS, PURCHASE_ERROR_COPY } from "./games/wingo"
import { STARS_RESULT_COPY } from "./components/payments"
import { CANNOT_SEND_COPY, CHAT_ERROR_COPY } from "./live/chat"
import { CONNECTION_COPY } from "./live/connection"
import { STARS_ERROR_COPY } from "./payments/stars"

const COPY_TABLES: Record<string, string>[] = [
  AUTH_ERROR_COPY,
  REOPEN_COPY,
  STATUS_COPY,
  COUNTDOWN_COPY,
  CART_PROBLEM_COPY,
  PURCHASE_ERROR_COPY,
  CHAT_ERROR_COPY,
  CANNOT_SEND_COPY,
  CONNECTION_COPY,
  STARS_ERROR_COPY,
  STARS_RESULT_COPY,
  Object.fromEntries(Object.entries(PRIZE_TIERS).map(([k, v]) => [k, v.label])),
  TIMELINE_COPY,
  Object.fromEntries(DETAIL_TIERS.map((d) => [d.tier, d.tier])),
  Object.fromEntries(EVENT_TYPES.flatMap((e) => [[`${e.id}-label`, e.label], [`${e.id}-short`, e.short]])),
  Object.fromEntries(
    Object.entries(CADENCE_COPY).flatMap(([k, v]) => [
      [`${k}-label`, v.label],
      [`${k}-short`, v.short],
      [`${k}-hint`, v.hint],
      [`${k}-unit`, v.unit],
    ]),
  ),
  { home: "Home", winners: "Winners", profile: "Profile" },
]

const SRC = path.dirname(new URL(import.meta.url).pathname)

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) return sourceFiles(p)
    return /\.tsx?$/.test(d.name) && !d.name.endsWith(".test.ts") ? [p] : []
  })
}

/** Every literal passed to t("…") plus the copy tables that are translated at render time. */
function usedKeys(): string[] {
  const keys = new Set<string>([...COPY_TABLES.flatMap((table) => Object.values(table)), GENERIC_ERROR])
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, "utf8")
    for (const m of text.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`) as string)
  }
  return [...keys]
}

const locales: Record<string, Record<string, string>> = { en, ar, fa, fr }

describe("locales", () => {
  it("English has every string the code uses", () => {
    const missing = usedKeys().filter((k) => !(k in en))
    expect(missing).toEqual([])
  })

  for (const [lang, table] of Object.entries(locales)) {
    it(`${lang} has every English key, non-empty`, () => {
      const missing = Object.keys(en).filter((k) => typeof table[k] !== "string" || !table[k]?.trim())
      expect(missing).toEqual([])
    })

    it(`${lang} keeps every placeholder`, () => {
      const broken = Object.keys(en).filter((k) => {
        const want = (k.match(/\{\{\w+\}\}/g) ?? []).sort().join()
        const got = (table[k]?.match(/\{\{\w+\}\}/g) ?? []).sort().join()
        return want !== got
      })
      expect(broken).toEqual([])
    })
  }

  it("has no keys English does not have", () => {
    for (const table of [ar, fa, fr] as Record<string, string>[]) {
      expect(Object.keys(table).filter((k) => !(k in en))).toEqual([])
    }
  })
})
