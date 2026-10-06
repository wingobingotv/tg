/**
 * Live chat, as the website's live page uses the Player API (`/live-chat/*`):
 * guests read, ticket holders send. The server delays messages by a few
 * seconds and caps how often one viewer can send.
 */

export type ChatMessage = {
  id: string
  displayName: string
  isMine: boolean
  body: string
  likeCount: number
  likedByMe: boolean
  pending: boolean
  /** When everyone else sees it (the server's chat delay). */
  visibleAtMs: number
  clientMsgId: string | null
}

export type ChatStatus = {
  enabled: boolean
  canSend: boolean
  cannotSendReason: "muted" | "no_ticket" | null
  maxBodyLength: number
  myDisplayName: string | null
}

const KEEP = 150
const DEFAULT_MAX_BODY = 100

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

export function parseChatMessage(value: unknown): ChatMessage | null {
  const m = rec(value)
  const id = typeof m.id === "string" || typeof m.id === "number" ? String(m.id) : ""
  const body = typeof m.body === "string" ? m.body : ""
  if (!/^\d{1,20}$/.test(id) || !body) return null
  return {
    id,
    displayName: typeof m.displayName === "string" ? m.displayName : "",
    isMine: m.isMine === true,
    body,
    likeCount: typeof m.likeCount === "number" && m.likeCount > 0 ? m.likeCount : 0,
    likedByMe: m.likedByMe === true,
    pending: m.pending === true,
    visibleAtMs: typeof m.visibleAt === "string" ? Date.parse(m.visibleAt) || 0 : 0,
    clientMsgId: typeof m.clientMsgId === "string" ? m.clientMsgId : null,
  }
}

export function parseChatStatus(value: unknown): ChatStatus {
  const s = rec(value)
  const reason = s.cannotSendReason === "muted" || s.cannotSendReason === "no_ticket" ? s.cannotSendReason : null
  return {
    enabled: s.enabled === true,
    canSend: s.canSend === true,
    cannotSendReason: reason,
    maxBodyLength: typeof s.maxBodyLength === "number" && s.maxBodyLength > 0 ? s.maxBodyLength : DEFAULT_MAX_BODY,
    myDisplayName: typeof s.myDisplayName === "string" ? s.myDisplayName : null,
  }
}

/** Newest messages by id; a server copy replaces our own optimistic one. */
export function mergeMessages(prev: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map(prev.map((m) => [m.id, m]))
  for (const m of incoming) {
    if (m.clientMsgId) {
      for (const [id, old] of byId) if (old.clientMsgId === m.clientMsgId && id !== m.id) byId.delete(id)
    }
    byId.set(m.id, m)
  }
  return [...byId.values()].sort((a, b) => cmpId(a.id, b.id)).slice(-KEEP)
}

function cmpId(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

/**
 * The `afterId` for the next poll: the highest id already public. Our own
 * messages show at once while everyone else's wait out the delay, so moving
 * past a pending one would skip messages that become public after it.
 */
export function nextAfterId(messages: readonly ChatMessage[], current: string, nowMs: number): string {
  return messages.reduce((max, m) => (!isPending(m, nowMs) && cmpId(m.id, max) > 0 ? m.id : max), current)
}

export function isPending(m: ChatMessage, nowMs: number): boolean {
  return m.pending && m.visibleAtMs > nowMs
}

export const CANNOT_SEND_COPY: Record<"muted" | "no_ticket", string> = {
  muted: "Your chat access has been disabled for this show.",
  no_ticket: "Only participants with a ticket can chat.",
}

export type ChatErrorKind = "rate" | "no_ticket" | "muted" | "disabled" | "empty" | "generic"

export const CHAT_ERROR_COPY: Record<ChatErrorKind, string> = {
  rate: "You are sending messages too fast. Try again shortly.",
  no_ticket: "Only participants with a ticket can chat.",
  muted: "Your chat access has been disabled for this show.",
  disabled: "Live Chat is not enabled for this game.",
  empty: "Message cannot be empty.",
  generic: "Your message was not sent. Try again.",
}

/** `{ errorCode }` from `/live-chat/send` and `/live-chat/like` → copy key. */
export function chatErrorKind(errorCode: unknown): ChatErrorKind {
  switch (errorCode) {
    case "RATE_LIMIT":
      return "rate"
    case "NOT_ELIGIBLE":
      return "no_ticket"
    case "CHAT_MUTED":
      return "muted"
    case "CHAT_DISABLED":
      return "disabled"
    case "INVALID_BODY":
      return "empty"
    default:
      return "generic"
  }
}

export function newClientMsgId(): string {
  return `tg-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
}
