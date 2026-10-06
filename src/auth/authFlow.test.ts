import { describe, expect, it } from "vitest"
import { authErrorCopy, GENERIC_ERROR, stateFromLinkResponse, stateFromSessionResponse } from "./authFlow"

const TOKEN = "a".repeat(64)

describe("stateFromSessionResponse", () => {
  it("signs in a linked Telegram user", () => {
    expect(
      stateFromSessionResponse({
        success: true,
        status: "linked",
        userAuth: TOKEN,
        sessionExpiresAt: "2026-10-13T12:00:00.000Z",
        startParam: "ref_ABC",
      }),
    ).toEqual({ kind: "ready", token: TOKEN, expiresAt: "2026-10-13T12:00:00.000Z", startParam: "ref_ABC" })
  })

  it("asks an unlinked Telegram user to link", () => {
    const s = stateFromSessionResponse({
      success: true,
      status: "link_required",
      linkTicket: "t".repeat(64),
      linkTicketExpiresAt: "2026-10-06T12:15:00.000Z",
      telegramUser: { firstName: "Sara", username: "sara" },
      startParam: null,
    })
    expect(s).toEqual({
      kind: "link_required",
      linkTicket: "t".repeat(64),
      linkTicketExpiresAt: Date.parse("2026-10-06T12:15:00.000Z"),
      firstName: "Sara",
      username: "sara",
      startParam: null,
    })
  })

  it("maps every documented failure code", () => {
    const kind = (message: string) => stateFromSessionResponse({ success: false, message })
    expect(kind("telegram_not_configured")).toEqual({ kind: "unavailable" })
    expect(kind("telegram_auth_disabled")).toEqual({ kind: "unavailable" })
    expect(kind("invalid_init_data")).toEqual({ kind: "reopen_required", reason: "invalid" })
    expect(kind("init_data_expired")).toEqual({ kind: "reopen_required", reason: "expired" })
    expect(kind("init_data_replayed")).toEqual({ kind: "reopen_required", reason: "replayed" })
    expect(kind("user_is_banned")).toEqual({ kind: "banned" })
    expect(kind("something_new")).toEqual({ kind: "unavailable" })
  })

  it("never treats a malformed success as signed in", () => {
    expect(stateFromSessionResponse(null)).toEqual({ kind: "unavailable" })
    expect(stateFromSessionResponse({ success: true, status: "linked" })).toEqual({ kind: "unavailable" })
    expect(stateFromSessionResponse({ success: true, status: "link_required" })).toEqual({ kind: "unavailable" })
    expect(stateFromSessionResponse({ success: "true", status: "linked", userAuth: TOKEN })).toEqual({ kind: "unavailable" })
  })

  it("drops a start_param outside Telegram's alphabet", () => {
    const s = stateFromSessionResponse({ success: true, status: "linked", userAuth: TOKEN, startParam: "<script>" })
    expect(s.kind === "ready" && s.startParam).toBeNull()
  })
})

describe("stateFromLinkResponse", () => {
  it("returns the new Telegram session", () => {
    expect(stateFromLinkResponse({ success: true, userAuth: TOKEN, sessionExpiresAt: "x" })).toEqual({
      kind: "ready",
      token: TOKEN,
      expiresAt: "x",
      startParam: null,
    })
  })

  it("leaves recoverable errors to the form", () => {
    expect(stateFromLinkResponse({ success: false, message: "telegram_already_linked" })).toBeNull()
    expect(stateFromLinkResponse({ success: false, message: "fresh_login_required" })).toBeNull()
    expect(stateFromLinkResponse({ success: false, message: "user_is_banned" })).toEqual({ kind: "banned" })
  })
})

describe("authErrorCopy", () => {
  it("has copy for backend codes and a generic fallback", () => {
    expect(authErrorCopy("invalid_login")).toBe("The email or password is not correct.")
    expect(authErrorCopy("account_already_linked")).toContain("another Telegram account")
    expect(authErrorCopy("unknown_code")).toBe(GENERIC_ERROR)
    expect(authErrorCopy(undefined)).toBe(GENERIC_ERROR)
  })
})
