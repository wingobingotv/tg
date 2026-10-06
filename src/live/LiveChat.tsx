import { useEffect, useRef, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { ApiError, post } from "../api"
import { Alert, Button } from "../components/ui"
import { useNow } from "../hooks/useNow"
import { haptic } from "../telegram"
import {
  CANNOT_SEND_COPY,
  CHAT_ERROR_COPY,
  chatErrorKind,
  isPending,
  mergeMessages,
  newClientMsgId,
  nextAfterId,
  parseChatMessage,
  parseChatStatus,
  type ChatMessage,
  type ChatStatus,
} from "./chat"

const POLL_MS = 2_000

type Envelope<T> = { data?: T }

/** The show's chat, polled like the website's `useLiveChat`. Guests read; ticket holders write. */
export function LiveChat({ gameId }: { gameId: string }) {
  const { t } = useTranslation()
  const now = useNow(1000)
  const [status, setStatus] = useState<ChatStatus | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [offline, setOffline] = useState(false)
  const afterRef = useRef("0")
  const listRef = useRef<HTMLOListElement | null>(null)

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    afterRef.current = "0"
    setMessages([])

    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          const res = await post<Envelope<Record<string, unknown>>>("/live-chat/messages", {
            gameId,
            gameType: "wingo",
            afterId: afterRef.current,
            limit: 50,
          })
          if (disposed) return
          setOffline(false)
          setStatus(parseChatStatus(res.data))
          const batch = (Array.isArray(res.data?.messages) ? res.data.messages : [])
            .map(parseChatMessage)
            .filter((m): m is ChatMessage => m !== null)
          if (batch.length) {
            setMessages((prev) => {
              const next = mergeMessages(prev, batch)
              afterRef.current = nextAfterId(next, afterRef.current, Date.now())
              return next
            })
          }
        } catch {
          if (!disposed) setOffline(true)
        }
      }
      if (!disposed) timer = setTimeout(() => void poll(), POLL_MS)
    }
    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [gameId])

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages.length])

  if (!status?.enabled) return null
  const maxLength = status.maxBodyLength

  const send = async (e: FormEvent) => {
    e.preventDefault()
    const body = draft.trim().slice(0, maxLength)
    if (!body || sending) return
    setSending(true)
    setError("")
    try {
      const res = await post<Envelope<{ message?: unknown }>>("/live-chat/send", {
        gameId,
        gameType: "wingo",
        body,
        clientMsgId: newClientMsgId(),
      })
      const message = parseChatMessage(res.data?.message)
      if (message) setMessages((prev) => mergeMessages(prev, [message]))
      setDraft("")
    } catch (err) {
      haptic("error")
      const body = err instanceof ApiError && err.body && typeof err.body === "object" ? (err.body as Record<string, unknown>) : {}
      const kind = chatErrorKind(body.errorCode)
      const wait = typeof body.retryAfterMs === "number" ? Math.ceil(body.retryAfterMs / 1000) : 0
      setError(kind === "rate" && wait > 0 ? t("Wait {{count}}s before sending again", { count: wait }) : t(CHAT_ERROR_COPY[kind]))
      if (kind === "muted" || kind === "no_ticket") setStatus((s) => (s ? { ...s, canSend: false, cannotSendReason: kind } : s))
    } finally {
      setSending(false)
    }
  }

  const like = async (messageId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, likedByMe: !m.likedByMe, likeCount: Math.max(0, m.likeCount + (m.likedByMe ? -1 : 1)) } : m,
      ),
    )
    try {
      const res = await post<Envelope<{ message?: unknown }>>("/live-chat/like", { gameId, gameType: "wingo", messageId })
      const message = parseChatMessage(res.data?.message)
      if (message) setMessages((prev) => mergeMessages(prev, [message]))
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, likedByMe: !m.likedByMe, likeCount: Math.max(0, m.likeCount + (m.likedByMe ? -1 : 1)) } : m,
        ),
      )
    }
  }

  return (
    <section className="card chat" aria-labelledby="chat-title">
      <h2 id="chat-title" className="card-title">
        {t("Live chat")}
      </h2>
      {offline ? <p className="muted small">{t("Reconnecting to the chat…")}</p> : null}
      {messages.length === 0 ? (
        <p className="muted small">{t("No messages yet. Say hello!")}</p>
      ) : (
        <ol className="chat-list" ref={listRef} aria-live="polite">
          {messages.map((m) => (
            <li key={m.id} className={`chat-msg${m.isMine ? " chat-mine" : ""}${isPending(m, now) ? " chat-pending" : ""}`}>
              <span className="chat-name">
                <bdi>{m.displayName}</bdi>
                {m.isMine ? <span className="muted small"> · {t("you")}</span> : null}
              </span>
              <bdi className="chat-body">{m.body}</bdi>
              <button
                type="button"
                className={`chat-like${m.likedByMe ? " chat-liked" : ""}`}
                aria-pressed={m.likedByMe}
                aria-label={t("Like")}
                disabled={!status.canSend || m.isMine}
                onClick={() => void like(m.id)}
              >
                <span aria-hidden="true">♥</span>
                {m.likeCount > 0 ? <span dir="ltr">{m.likeCount}</span> : null}
              </button>
            </li>
          ))}
        </ol>
      )}

      {status.canSend ? (
        <form className="chat-form" onSubmit={(e) => void send(e)}>
          <input
            className="chat-input"
            value={draft}
            maxLength={maxLength}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("Write a message…")}
            aria-label={t("Message")}
            enterKeyHint="send"
          />
          <Button type="submit" busy={sending} disabled={!draft.trim()}>
            {t("Send")}
          </Button>
        </form>
      ) : status.cannotSendReason ? (
        <p className="muted small">{t(CANNOT_SEND_COPY[status.cannotSendReason])}</p>
      ) : null}
      {status.canSend && status.myDisplayName ? (
        <p className="muted small">{t("You chat as {{name}}", { name: status.myDisplayName })}</p>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
    </section>
  )
}
