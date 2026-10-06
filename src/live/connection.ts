export type LiveConnection = "off" | "connecting" | "waiting" | "live" | "reconnecting" | "unavailable"

/** Stage overlay while there is no host picture; `live` without video reads as `waiting`. */
export const CONNECTION_COPY: Record<Exclude<LiveConnection, "off" | "live">, string> = {
  connecting: "Connecting to the show…",
  waiting: "Preparing the draw…",
  reconnecting: "Reconnecting…",
  unavailable: "The live stream is not available right now.",
}
