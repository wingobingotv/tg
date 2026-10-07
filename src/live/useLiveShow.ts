import {
  ConnectionState,
  Room,
  RoomEvent,
  VideoQuality,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client"
import { useCallback, useEffect, useRef, useState } from "react"
import { post } from "../api"
import { config } from "../config"
import { trackDebug } from "../telemetry"
import {
  EMPTY_BOARD,
  decodeLiveMessage,
  nextBoard,
  programFromMetadata,
  type Board,
  type LiveEvent,
  type ProgramSource,
} from "./drawBoard"
import type { LiveConnection } from "./connection"
import { pickShowMedia } from "./hostMedia"

/**
 * Watch one game's show room, as the website's `/live/wingo/[gameId]` page:
 * the Player API names the room and mints a subscribe-only viewer token, the
 * host's (or cinema publisher's) video goes into one <video>, an on-air guest
 * into a second one, audio plays once the viewer allows it, and data messages
 * drive the drawn-number board and are handed to the video overlays.
 */

type Envelope<T> = { data?: T }
type ActiveRoom = { roomName?: string | null }
type ViewerToken = { token?: string; roomName?: string }

const RETRY_MS = [3_000, 6_000, 12_000, 20_000, 30_000]
/** While connected but nobody is on air, look again for the room that is. */
const REPROBE_MS = 15_000

function mobileQuality(): VideoQuality {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "") || window.innerWidth < 900
  return mobile ? VideoQuality.MEDIUM : VideoQuality.HIGH
}

export function useLiveShow(args: {
  gameId: string
  enabled: boolean
  mainCount: number
  onFinalized: () => void
  /** Every decoded data message, before the board applies it. */
  onEvent?: (event: LiveEvent) => void
}) {
  const { gameId, enabled, mainCount } = args
  const livekitUrl = config?.livekitUrl ?? ""
  const active = enabled && Boolean(livekitUrl)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const guestVideoRef = useRef<HTMLVideoElement | null>(null)
  const audioRootRef = useRef<HTMLDivElement | null>(null)
  const roomRef = useRef<Room | null>(null)
  const onFinalizedRef = useRef(args.onFinalized)
  const onEventRef = useRef(args.onEvent)
  const mutedRef = useRef(false)
  useEffect(() => {
    onFinalizedRef.current = args.onFinalized
    onEventRef.current = args.onEvent
  }, [args.onFinalized, args.onEvent])

  const [connection, setConnection] = useState<LiveConnection>(active ? "connecting" : "off")
  const [hasVideo, setHasVideo] = useState(false)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [muted, setMutedState] = useState(false)
  const [guest, setGuest] = useState<{ identity: string; name: string } | null>(null)
  const [board, setBoard] = useState<Board>(EMPTY_BOARD)

  useEffect(() => {
    if (!active) {
      setConnection("off")
      return
    }
    let disposed = false
    let attempt = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let probeTimer: ReturnType<typeof setInterval> | undefined
    let source: ProgramSource = "INFLUENCER_LIVE"
    let version = 0
    let videoTrack: RemoteTrack | null = null
    let guestTrack: RemoteTrack | null = null
    const audioEls = new Map<string, HTMLMediaElement>()

    const detachVideo = () => {
      const el = videoRef.current
      if (videoTrack && el) videoTrack.detach(el)
      videoTrack = null
    }

    const detachGuest = () => {
      const el = guestVideoRef.current
      if (guestTrack && el) guestTrack.detach(el)
      guestTrack = null
    }

    const sync = (room: Room) => {
      const media = pickShowMedia<RemoteTrackPublication>(room, source)
      for (const pub of media.subscribe) {
        try {
          pub.setSubscribed(true)
        } catch {
          /* publication left */
        }
      }

      const el = videoRef.current
      const next = (media.video?.track as RemoteTrack | undefined) ?? null
      if (el && next && next !== videoTrack) {
        detachVideo()
        try {
          media.video?.setVideoQuality(mobileQuality())
        } catch {
          /* simulcast layer not ready */
        }
        next.attach(el)
        el.muted = true
        void el.play().catch(() => {})
        videoTrack = next
      } else if (!next && videoTrack) {
        detachVideo()
      }
      setHasVideo(Boolean(next) && !(media.video?.isMuted ?? true))

      const guestNext = (media.guest?.video.track as RemoteTrack | undefined) ?? null
      const guestEl = guestVideoRef.current
      if (guestNext !== guestTrack) detachGuest()
      if (guestNext && guestEl && guestNext !== guestTrack) {
        guestNext.attach(guestEl)
        guestEl.muted = true
        void guestEl.play().catch(() => {})
        guestTrack = guestNext
      }
      const nextGuest = media.guest && guestNext ? { identity: media.guest.identity, name: media.guest.name } : null
      setGuest((prev) => (prev?.identity === nextGuest?.identity && prev?.name === nextGuest?.name ? prev : nextGuest))

      const wanted = new Set<string>()
      for (const pub of media.audio) {
        const track = pub.track as RemoteTrack | undefined
        if (!track?.sid) continue
        wanted.add(track.sid)
        if (audioEls.has(track.sid)) continue
        const audioEl = track.attach()
        audioEl.muted = mutedRef.current
        audioRootRef.current?.appendChild(audioEl)
        audioEls.set(track.sid, audioEl)
      }
      for (const [sid, audioEl] of audioEls) {
        if (wanted.has(sid)) continue
        audioEl.remove()
        audioEls.delete(sid)
      }

      setConnection(next ? "live" : "waiting")
    }

    const teardown = () => {
      clearInterval(probeTimer)
      detachVideo()
      detachGuest()
      setGuest(null)
      for (const audioEl of audioEls.values()) audioEl.remove()
      audioEls.clear()
      const room = roomRef.current
      roomRef.current = null
      if (room) void room.disconnect()
    }

    const scheduleRetry = () => {
      if (disposed) return
      const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 30_000
      attempt += 1
      setConnection("reconnecting")
      retryTimer = setTimeout(() => void connect(), delay)
    }

    const findRoom = async (): Promise<string | null> => {
      const res = await post<Envelope<ActiveRoom>>("/live/active-room", { gameId, gameType: "wingo" })
      return typeof res.data?.roomName === "string" ? res.data.roomName : null
    }

    const connect = async (preferredRoom?: string | null) => {
      if (disposed) return
      teardown()
      setConnection(attempt === 0 ? "connecting" : "reconnecting")
      try {
        const roomName = preferredRoom === undefined ? await findRoom() : preferredRoom
        const minted = await post<Envelope<ViewerToken>>("/live/viewer-token", {
          gameId,
          gameType: "wingo",
          ...(roomName ? { roomName } : {}),
        })
        const token = minted.data?.token
        const joined = minted.data?.roomName ?? null
        if (!token || disposed) {
          if (!token) scheduleRetry()
          return
        }

        const room = new Room({ adaptiveStream: false, dynacast: false })
        roomRef.current = room
        const resync = () => {
          if (roomRef.current === room) sync(room)
        }

        room
          .on(RoomEvent.TrackSubscribed, resync)
          .on(RoomEvent.TrackUnsubscribed, resync)
          .on(RoomEvent.TrackPublished, resync)
          .on(RoomEvent.TrackUnpublished, resync)
          .on(RoomEvent.TrackMuted, resync)
          .on(RoomEvent.TrackUnmuted, resync)
          .on(RoomEvent.ParticipantConnected, resync)
          .on(RoomEvent.ParticipantDisconnected, resync)
          .on(RoomEvent.Reconnecting, () => setConnection("reconnecting"))
          .on(RoomEvent.Reconnected, resync)
          .on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!room.canPlaybackAudio))
          .on(RoomEvent.RoomMetadataChanged, (metadata: string) => {
            const program = programFromMetadata(metadata)
            if (program && program.version > version) {
              source = program.source
              version = program.version
              resync()
            }
          })
          .on(RoomEvent.DataReceived, (payload: Uint8Array) => {
            const event = decodeLiveMessage(payload)
            if (!event) return
            onEventRef.current?.(event)
            if (event.kind === "ball" || event.kind === "history" || event.kind === "clear") {
              setBoard((b) => nextBoard(b, event, mainCount))
            } else if (event.kind === "finalized") {
              onFinalizedRef.current()
            } else if (event.kind === "program" && event.version > version) {
              source = event.source
              version = event.version
              resync()
            }
          })
          .on(RoomEvent.Disconnected, () => {
            if (roomRef.current !== room || disposed) return
            trackDebug("stream.room", "warn", "viewer disconnected", { gameId, room: joined }, joined ?? gameId)
            scheduleRetry()
          })

        await room.connect(livekitUrl, token, { autoSubscribe: true })
        if (disposed || roomRef.current !== room) {
          void room.disconnect()
          return
        }
        attempt = 0
        const program = programFromMetadata(room.metadata)
        if (program) {
          source = program.source
          version = program.version
        }
        setAudioBlocked(!room.canPlaybackAudio)
        sync(room)
        trackDebug("stream.room", "info", "viewer connected", { gameId, room: joined }, joined ?? gameId)

        probeTimer = setInterval(() => {
          if (roomRef.current !== room || room.state !== ConnectionState.Connected || videoTrack) return
          void findRoom()
            .then((onAir) => {
              if (onAir && onAir !== joined && roomRef.current === room) void connect(onAir)
            })
            .catch(() => {})
        }, REPROBE_MS)
      } catch (err) {
        if (disposed) return
        const status = err && typeof err === "object" && "status" in err ? Number((err as { status: unknown }).status) : 0
        trackDebug("stream.room", "error", "viewer connect failed", { gameId, status }, gameId)
        if (status === 403 || status === 503) {
          teardown()
          setConnection("unavailable")
          return
        }
        scheduleRetry()
      }
    }

    void connect()

    const onVisible = () => {
      if (document.visibilityState !== "visible") return
      const el = videoRef.current
      if (el && videoTrack) void el.play().catch(() => {})
      const guestEl = guestVideoRef.current
      if (guestEl && guestTrack) void guestEl.play().catch(() => {})
      const room = roomRef.current
      if (room) sync(room)
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      disposed = true
      clearTimeout(retryTimer)
      document.removeEventListener("visibilitychange", onVisible)
      teardown()
    }
  }, [active, gameId, livekitUrl, mainCount])

  /** Must run inside a tap: browsers only start sound after a user gesture. */
  const enableAudio = useCallback(() => {
    const room = roomRef.current
    if (!room) return
    void room
      .startAudio()
      .then(() => setAudioBlocked(!room.canPlaybackAudio))
      .catch(() => setAudioBlocked(true))
    void videoRef.current?.play().catch(() => {})
  }, [])

  /** The player's mute switch: every show audio element, current and future. */
  const setMuted = useCallback((next: boolean) => {
    mutedRef.current = next
    setMutedState(next)
    for (const el of audioRootRef.current?.querySelectorAll("audio") ?? []) el.muted = next
  }, [])

  return {
    connection,
    hasVideo,
    audioBlocked,
    enableAudio,
    muted,
    setMuted,
    guest,
    board,
    videoRef,
    guestVideoRef,
    audioRootRef,
  }
}
