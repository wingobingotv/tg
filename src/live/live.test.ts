import { describe, expect, it } from "vitest"
import { mergeMessages, nextAfterId, parseChatMessage, parseChatStatus, chatErrorKind, type ChatMessage } from "./chat"
import { EMPTY_BOARD, boardBalls, decodeLiveMessage, mergedBoard, nextBoard, programFromMetadata, type Board } from "./drawBoard"
import { pickShowMedia, type PublicationLike } from "./hostMedia"
import { isRealHost, participantRole } from "./showRoom"

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))

describe("decodeLiveMessage", () => {
  it("reads the show's data messages", () => {
    expect(decodeLiveMessage(enc({ type: "winner-bubble", text: "14" }))).toEqual({ kind: "ball", ball: 14 })
    expect(decodeLiveMessage(enc({ type: "winner-bubble", text: "5🍀" }))).toEqual({ kind: "ball", ball: 5 })
    expect(decodeLiveMessage(enc({ type: "winner-bubble", text: "Congratulations!" }))).toEqual({ kind: "winner", text: "Congratulations!" })
    expect(decodeLiveMessage(enc({ type: "numbers-history", numbers: ["3", 9, "x"] }))).toEqual({ kind: "history", balls: [3, 9] })
    expect(decodeLiveMessage(enc({ type: "clear-numbers" }))).toEqual({ kind: "clear" })
    expect(decodeLiveMessage(enc({ type: "draw-finalized" }))).toEqual({ kind: "finalized" })
    expect(decodeLiveMessage(enc({ type: "program-source-change", source: "CINEMATIC", programVersion: 4 }))).toEqual({
      kind: "program",
      source: "CINEMATIC",
      version: 4,
    })
    expect(decodeLiveMessage(enc({ type: "news-announcement", text: " Big night " }))).toEqual({ kind: "news", text: "Big night" })
  })

  it("ignores junk and unknown types", () => {
    expect(decodeLiveMessage(new TextEncoder().encode("not json"))).toBeNull()
    expect(decodeLiveMessage(enc({ type: "guest-joined" }))).toBeNull()
    expect(decodeLiveMessage(enc(null))).toBeNull()
  })
})

describe("draw board", () => {
  const ball = (n: number) => ({ kind: "ball" as const, ball: n })

  it("keeps six unique mains, then the lucky number", () => {
    let b: Board = EMPTY_BOARD
    for (const n of [4, 4, 11, 20, 31, 40, 47]) b = nextBoard(b, ball(n), 6)
    expect(b).toEqual({ mains: [4, 11, 20, 31, 40, 47], lucky: null })
    b = nextBoard(b, ball(4), 6)
    expect(b).toEqual({ mains: [4, 11, 20, 31, 40, 47], lucky: 4 })
    expect(boardBalls(b)).toEqual([4, 11, 20, 31, 40, 47, 4])
  })

  it("never lets a shorter history replace a longer board", () => {
    const b = nextBoard(EMPTY_BOARD, { kind: "history", balls: [1, 2, 3] }, 6)
    expect(nextBoard(b, { kind: "history", balls: [1] }, 6)).toBe(b)
    expect(nextBoard(b, { kind: "history", balls: [1, 2, 3, 4] }, 6).mains).toEqual([1, 2, 3, 4])
    expect(nextBoard(b, { kind: "clear" }, 6)).toEqual(EMPTY_BOARD)
  })

  it("converges with the API result", () => {
    const live = nextBoard(EMPTY_BOARD, ball(7), 6)
    expect(mergedBoard(live, [1, 2, 3, 4, 5, 6, 8], 6)).toEqual({ mains: [1, 2, 3, 4, 5, 6], lucky: 8 })
    expect(mergedBoard(live, [], 6)).toBe(live)
  })

  it("reads the program source from room metadata", () => {
    expect(programFromMetadata(JSON.stringify({ programOutput: { activeProgramSource: "CINEMATIC", programVersion: 3 } }))).toEqual({
      source: "CINEMATIC",
      version: 3,
    })
    expect(programFromMetadata(JSON.stringify({ origin: "admin-auto" }))).toBeNull()
    expect(programFromMetadata("{bad")).toBeNull()
    expect(programFromMetadata(undefined)).toBeNull()
  })
})

describe("show roles", () => {
  it("classifies identities like the website", () => {
    expect(participantRole("viewer-1-abc")).toBe("viewer")
    expect(participantRole("cinema-publisher-9")).toBe("cinema_publisher")
    expect(participantRole("liveavatar-agent-x")).toBe("ai_presenter")
    expect(participantRole("pub-123")).toBe("presenter")
    expect(isRealHost("avatar-1")).toBe(true)
    expect(isRealHost("admin-emergency")).toBe(false)
    expect(isRealHost("streaming-hub")).toBe(false)
  })
})

describe("pickShowMedia", () => {
  type Pub = PublicationLike & { name: string }
  const pub = (name: string, kind: "video" | "audio", extra: Partial<Pub> = {}): Pub => ({
    name,
    kind,
    source: kind === "video" ? "camera" : "microphone",
    isMuted: false,
    isSubscribed: true,
    track: { sid: name, kind, isMuted: false },
    ...extra,
  })
  const room = (people: Record<string, Pub[]>) => ({
    remoteParticipants: new Map(
      Object.entries(people).map(([identity, pubs]) => [identity, { identity, trackPublications: new Map(pubs.map((p) => [p.name, p])) }]),
    ),
  })

  it("shows the presenter, preferring an unmuted camera", () => {
    const r = room({
      "pub-1": [pub("muted-cam", "video", { isMuted: true }), pub("cam", "video"), pub("mic", "audio")],
      "viewer-2": [pub("v-cam", "video")],
    })
    const m = pickShowMedia(r, "INFLUENCER_LIVE")
    expect(m.video?.name).toBe("cam")
    expect(m.audio.map((p) => p.name)).toEqual(["mic"])
    expect(m.hasHost).toBe(true)
  })

  it("switches to the cinema publisher only in CINEMATIC with video", () => {
    const r = room({
      "pub-1": [pub("cam", "video"), pub("mic", "audio")],
      "cinema-publisher-1": [pub("film", "video"), pub("film-audio", "audio")],
      guest_9: [pub("guest-mic", "audio")],
    })
    expect(pickShowMedia(r, "INFLUENCER_LIVE").video?.name).toBe("cam")
    const cine = pickShowMedia(r, "CINEMATIC")
    expect(cine.video?.name).toBe("film")
    expect(cine.audio.map((p) => p.name)).toEqual(["film-audio", "guest-mic"])

    const noFilm = room({ "pub-1": [pub("cam", "video")], "cinema-publisher-1": [pub("film", "video", { track: undefined })] })
    expect(pickShowMedia(noFilm, "CINEMATIC").video?.name).toBe("cam")
  })

  it("asks to subscribe to show tracks it is not receiving", () => {
    const r = room({ "pub-1": [pub("cam", "video", { isSubscribed: false, track: undefined })] })
    const m = pickShowMedia(r, "INFLUENCER_LIVE")
    expect(m.video).toBeNull()
    expect(m.subscribe.map((p) => p.name)).toEqual(["cam"])
  })
})

describe("live chat", () => {
  const msg = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id,
    displayName: "Lucky Fox",
    isMine: false,
    body: "hi",
    likeCount: 0,
    likedByMe: false,
    pending: false,
    visibleAtMs: 0,
    clientMsgId: null,
    ...extra,
  })

  it("parses server messages and drops malformed ones", () => {
    expect(parseChatMessage({ id: "12", body: "gl", displayName: "A", visibleAt: "2026-10-06T10:00:00.000Z" })?.visibleAtMs).toBe(
      Date.parse("2026-10-06T10:00:00.000Z"),
    )
    expect(parseChatMessage({ id: "x", body: "gl" })).toBeNull()
    expect(parseChatMessage({ id: "3", body: "" })).toBeNull()
  })

  it("merges by id in numeric order", () => {
    const merged = mergeMessages([msg("9"), msg("10")], [msg("10", { likeCount: 2 }), msg("100")])
    expect(merged.map((m) => m.id)).toEqual(["9", "10", "100"])
    expect(merged[1]?.likeCount).toBe(2)
  })

  it("does not move afterId past a message still in the delay", () => {
    const list = [msg("5"), msg("8", { pending: true, visibleAtMs: 2_000 })]
    expect(nextAfterId(list, "0", 1_000)).toBe("5")
    expect(nextAfterId(list, "0", 3_000)).toBe("8")
  })

  it("reads send permission and maps error codes", () => {
    expect(parseChatStatus({ enabled: true, canSend: false, cannotSendReason: "no_ticket" })).toMatchObject({
      enabled: true,
      canSend: false,
      cannotSendReason: "no_ticket",
      maxBodyLength: 100,
    })
    expect(parseChatStatus(null).enabled).toBe(false)
    expect(chatErrorKind("RATE_LIMIT")).toBe("rate")
    expect(chatErrorKind("CHAT_MUTED")).toBe("muted")
    expect(chatErrorKind("???")).toBe("generic")
  })
})
