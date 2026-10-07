import type { ProgramSource } from "./drawBoard"
import { isRealHost, participantRole } from "./showRoom"

/**
 * Which tracks the viewer shows and plays, decided as the website's
 * `utils/livekitHostMedia.ts` does: the cinema publisher while the program
 * source is CINEMATIC and it has video, otherwise the presenter / AI
 * presenter, preferring an unmuted camera. Structural types keep this free of
 * the LiveKit SDK so it can be unit tested.
 */

export type TrackLike = { sid?: string; kind: string; isMuted: boolean }

export type PublicationLike = {
  kind: string
  source: string
  isMuted: boolean
  isSubscribed: boolean
  track?: TrackLike
}

export type ShowMedia<P extends PublicationLike> = {
  /** The one video publication to show, null when there is none yet. */
  video: P | null
  /** Audio publications to play: the chosen source plus on-air guests. */
  audio: P[]
  /** Publications to make sure we are subscribed to. */
  subscribe: P[]
  hasHost: boolean
  /** An on-air guest beside the presenter (website split view), when one has video. */
  guest: { identity: string; name: string; video: P } | null
}

type ParticipantLike<P> = { identity: string; name?: string; trackPublications: Map<string, P> }

/** Website: participant name, else the identity without its `guest_` prefix. */
export function guestDisplayName(p: { identity: string; name?: string }): string {
  return p.name?.trim() || p.identity.replace(/^guest_/, "") || "Guest"
}

const isVideoPub = (p: PublicationLike) =>
  p.kind === "video" || (p.kind !== "audio" && (p.source === "camera" || p.source === "screen_share"))

const isAudioPub = (p: PublicationLike) => p.kind === "audio" || p.source === "microphone"

function videoScore(p: PublicationLike): number {
  let s = 0
  if (!p.isMuted) s += 4
  if (p.source === "camera") s += 2
  if (p.source === "screen_share") s += 1
  if (p.track && !p.track.isMuted) s += 2
  return s
}

export function pickShowMedia<P extends PublicationLike>(
  room: { remoteParticipants: Map<string, ParticipantLike<P>> },
  source: ProgramSource,
): ShowMedia<P> {
  const participants = [...room.remoteParticipants.values()]
  const pubsOf = (match: (identity: string) => boolean) =>
    participants.filter((p) => match(p.identity)).map((p) => [...p.trackPublications.values()])

  const firstVideo = (lists: P[][], ranked: boolean): P | null => {
    for (const pubs of lists) {
      const videos = pubs.filter(isVideoPub)
      const ordered = ranked ? [...videos].sort((a, b) => videoScore(b) - videoScore(a)) : videos
      const withTrack = ordered.find((p) => p.track?.kind === "video")
      if (withTrack) return withTrack
    }
    return null
  }

  const cinema = pubsOf((id) => participantRole(id) === "cinema_publisher")
  const hosts = pubsOf(isRealHost)
  const guests = pubsOf((id) => participantRole(id) === "guest")

  const cinemaVideo = source === "CINEMATIC" ? firstVideo(cinema, false) : null
  const chosen = cinemaVideo ? cinema : hosts
  const video = cinemaVideo ?? firstVideo(hosts, true)

  const audio = [...chosen, ...guests].flat().filter((p) => isAudioPub(p) && p.track?.kind === "audio")
  const subscribe = [...chosen, ...guests].flat().filter((p) => !p.isSubscribed && (isVideoPub(p) || isAudioPub(p)))

  let guest: ShowMedia<P>["guest"] = null
  if (video && !cinemaVideo) {
    for (const p of participants) {
      if (participantRole(p.identity) !== "guest") continue
      const guestVideo = firstVideo([[...p.trackPublications.values()]], true)
      if (guestVideo && !guestVideo.isMuted) {
        guest = { identity: p.identity, name: guestDisplayName(p), video: guestVideo }
        break
      }
    }
  }

  return { video, audio, subscribe, hasHost: hosts.length > 0 || cinema.length > 0, guest }
}
