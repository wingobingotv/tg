import { config } from "./config"

/**
 * Live Debug (Admin Panel → Development → Live Debug), 24 h retention.
 * Fire-and-forget: never awaited on the UX path, never throws, never sends
 * tokens, initData, link tickets, passwords or request bodies.
 */

type Level = "debug" | "info" | "warn" | "error"
type EventType = "api.error" | "ui.error" | "auth.session" | "payment.flow" | "stream.room"

const sessionId = (() => {
  try {
    return crypto.randomUUID()
  } catch {
    return `tg-${Date.now().toString(36)}`
  }
})()

export function trackDebug(
  type: EventType,
  level: Level,
  message: string,
  context: Record<string, string | number | boolean | null> = {},
  correlationId?: string,
): void {
  if (!config?.debugTelemetryUrl || !config.debugTelemetryKey) return
  try {
    const body = JSON.stringify({
      source: "wingobingo",
      sessionId,
      events: [
        {
          type,
          level,
          message: message.slice(0, 200),
          correlationId,
          path: window.location.pathname,
          context: { ...context, client: "telegram_mini_app" },
        },
      ],
    })
    void fetch(config.debugTelemetryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Telemetry-Key": config.debugTelemetryKey },
      body,
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // Telemetry must never affect the player.
  }
}
