import { describe, expect, it } from "vitest"
import { readSession, writeSession, type KeyValueStorage } from "./session"

function memory(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

const TOKEN = "0123456789abcdef".repeat(4)
const NOW = Date.parse("2026-10-06T12:00:00.000Z")

describe("session storage", () => {
  it("round-trips a session for the same Telegram user", () => {
    const s = memory()
    writeSession(s, TOKEN, "2026-10-13T12:00:00.000Z", 42)
    expect(readSession(s, 42, NOW)).toEqual({ token: TOKEN, expiresAt: Date.parse("2026-10-13T12:00:00.000Z"), tgUserId: 42 })
  })

  it("drops a session issued for another Telegram user", () => {
    const s = memory()
    writeSession(s, TOKEN, "2026-10-13T12:00:00.000Z", 42)
    expect(readSession(s, 43, NOW)).toBeNull()
    expect(s.data.size).toBe(0)
  })

  it("drops an expired session", () => {
    const s = memory()
    writeSession(s, TOKEN, "2026-10-06T11:59:59.000Z", 42)
    expect(readSession(s, 42, NOW)).toBeNull()
  })

  it("keeps a session without a server expiry", () => {
    const s = memory()
    writeSession(s, TOKEN, undefined, 42)
    expect(readSession(s, 42, NOW)?.expiresAt).toBeNull()
  })

  it("refuses malformed tokens and corrupt storage", () => {
    const s = memory()
    expect(writeSession(s, "short", null, 42)).toBeNull()
    s.data.set("wb.tg.session", "{not json")
    expect(readSession(s, 42, NOW)).toBeNull()
    s.data.set("wb.tg.session", JSON.stringify({ token: "x y", expiresAt: null, tgUserId: 42 }))
    expect(readSession(s, 42, NOW)).toBeNull()
  })

  it("works without storage", () => {
    expect(readSession(null, 42, NOW)).toBeNull()
    expect(writeSession(null, TOKEN, null, 42)?.token).toBe(TOKEN)
  })
})
