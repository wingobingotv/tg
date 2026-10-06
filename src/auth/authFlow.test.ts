import { describe, expect, it } from "vitest"
import {
  authErrorCopy,
  connectCodeFromStartParam,
  connectPreviewFrom,
  formatConnectCodeInput,
  GENERIC_ERROR,
  isCompleteConnectCode,
  stateFromLinkResponse,
  stateFromSessionResponse,
} from "./authFlow"

describe("connect codes (Continue with Google)", () => {
  it("reads the code from the deep-link start parameter only", () => {
    expect(connectCodeFromStartParam("lk_ABCDEFGH")).toBe("ABCD-EFGH")
    expect(connectCodeFromStartParam("lk_ABCDEFG0")).toBeNull()
    expect(connectCodeFromStartParam("ref_ABCDEFGH")).toBeNull()
    expect(connectCodeFromStartParam(null)).toBeNull()
  })

  it("formats what the player types", () => {
    expect(formatConnectCodeInput("abcd")).toBe("ABCD")
    expect(formatConnectCodeInput("ab cd-ef gh")).toBe("ABCD-EFGH")
    expect(formatConnectCodeInput("ABCDEFGHJK")).toBe("ABCD-EFGH")
    expect(formatConnectCodeInput("O0I1L")).toBe("")
    expect(isCompleteConnectCode("abcdefgh")).toBe(true)
    expect(isCompleteConnectCode("ABCD-EFG")).toBe(false)
  })

  it("reads the confirm preview and nothing else", () => {
    expect(
      connectPreviewFrom({ success: true, status: "confirm", account: { maskedEmail: "r•••@gmail.com" } }),
    ).toEqual({ maskedEmail: "r•••@gmail.com" })
    expect(connectPreviewFrom({ success: true, status: "linked", userAuth: "x" })).toBeNull()
    expect(connectPreviewFrom({ success: false, message: "code_invalid" })).toBeNull()
  })

  it("has copy for the new refusal codes", () => {
    expect(authErrorCopy("code_invalid")).not.toBe(GENERIC_ERROR)
    expect(authErrorCopy("too_many_attempts")).not.toBe(GENERIC_ERROR)
    expect(authErrorCopy("use_google_login")).toContain("Continue with Google")
  })
})

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
