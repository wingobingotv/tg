/**
 * Participant classification from the LiveKit show-room contract. Same table
 * and behaviour as `WingoBingo/src/utils/showRoom.ts` and the Player API's
 * `src/utils/showRoom.js`; change all copies together. Room names are never
 * built here: the Player API returns the room (`/live/active-room`,
 * `/live/viewer-token`).
 */

export type ParticipantRole =
  | "guest"
  | "viewer"
  | "monitor"
  | "hub"
  | "listener"
  | "cinema_publisher"
  | "emergency_publisher"
  | "ai_presenter"
  | "presenter"

const ROLE_PREFIXES: ReadonlyArray<readonly [string, ParticipantRole]> = [
  ["guest_", "guest"],
  ["viewer-", "viewer"],
  ["sub-", "viewer"],
  ["cinema-monitor", "monitor"],
  ["streaming-hub", "hub"],
  ["streaminghub", "hub"],
  ["overlay-listener-", "listener"],
  ["cinema-publisher-", "cinema_publisher"],
  ["admin-emergency", "emergency_publisher"],
  ["avatar-", "ai_presenter"],
  ["liveavatar-agent-", "ai_presenter"],
]

/** Unknown identities are the presenter (Studio's `pub-…` / `broadcaster`). */
export function participantRole(identity: string | null | undefined): ParticipantRole {
  const id = String(identity || "")
  for (const [prefix, role] of ROLE_PREFIXES) {
    if (id.startsWith(prefix)) return role
  }
  return "presenter"
}

/** The host itself: Studio presenter or AI presenter. */
export function isRealHost(identity: string | null | undefined): boolean {
  const role = participantRole(identity)
  return role === "presenter" || role === "ai_presenter"
}