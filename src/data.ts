import { useQuery } from "@tanstack/react-query"
import { post, setDisplayCurrency } from "./api"
import {
  parseOwnedTickets,
  parseWingoGame,
  parseWingoGameResult,
  type OwnedTicket,
  type WingoGame,
  type WingoGameResult,
} from "./games/wingo"

/** Same endpoints and parameters as the website's hooks (useFetchNormalTournaments, useFetchBingoGames). */

export type Profile = {
  name?: string | null
  email?: string | null
  username?: string | null
  currency?: string | null
}

export type Wallet = {
  currency: string
  balance: number
  bonusBalance: number
  outstandingWagering: number
}

export type GameCard = {
  key: string
  kind: "bingo"
  gameId: string
  title: string
  imageUrl: string | null
  ticketPrice: unknown
  prizePool: unknown
  drawDate: unknown
  /** Site route segment for Bingo: live | offline. */
  bingoMode?: "live" | "offline"
}

export type TelegramStatus = {
  linked: boolean
  identity: { telegramUserId: string; username: string | null; firstName: string | null; linkedAt: string } | null
}

type Envelope<T> = { data?: T }

const IMAGE_RE = /^https:\/\//

function image(value: unknown): string | null {
  return typeof value === "string" && IMAGE_RE.test(value) ? value : null
}

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await post<Envelope<Profile>>("/getUser")
      const profile = res.data ?? {}
      setDisplayCurrency(profile.currency)
      return profile
    },
  })
}

export function useWallet(enabled: boolean) {
  return useQuery({
    queryKey: ["wallet"],
    enabled,
    queryFn: async () => {
      const res = await post<Envelope<Wallet>>("/getWalletBalance")
      if (!res.data) throw new Error("no_wallet")
      return res.data
    },
  })
}

async function fetchWingoList(body: Record<string, unknown>): Promise<WingoGame[]> {
  const res = await post<Envelope<{ tournaments?: unknown[] }>>("/wingo/getTournaments", { page: 1, count: 10, ...body })
  return (res.data?.tournaments ?? []).map(parseWingoGame).filter((g): g is WingoGame => g !== null)
}

const FEED_POLL_MS = 60_000

/**
 * The website's home feed for Wingo (`useHomeV2Feed`): normal games, special
 * shows, and the `mainlanding` featured shows, merged by game id.
 */
export function useWingoFeed(enabled: boolean) {
  const opts = { enabled, refetchInterval: FEED_POLL_MS, refetchOnWindowFocus: false } as const
  const normal = useQuery({ ...opts, queryKey: ["wingo", "normal"], queryFn: () => fetchWingoList({ type: "normal" }) })
  const special = useQuery({ ...opts, queryKey: ["wingo", "special"], queryFn: () => fetchWingoList({ type: "special" }) })
  const featured = useQuery({
    ...opts,
    queryKey: ["wingo", "featured"],
    queryFn: () => fetchWingoList({ type: "special", tags: "mainlanding" }),
  })

  const games = new Map<string, WingoGame>()
  for (const g of [...(normal.data ?? []), ...(special.data ?? [])]) if (!games.has(g.gameId)) games.set(g.gameId, g)
  for (const g of featured.data ?? []) {
    const known = games.get(g.gameId)
    games.set(g.gameId, known ? { ...known, featured: true } : { ...g, featured: true })
  }

  return {
    games: [...games.values()],
    isPending: normal.isPending && special.isPending,
    isError: normal.isError && special.isError,
    refetch: () => {
      void normal.refetch()
      void special.refetch()
      void featured.refetch()
    },
  }
}

export function wingoGameKey(gameId: string) {
  return ["wingo", "game", gameId] as const
}

export function wingoTicketsKey(gameId: string) {
  return ["wingo", "tickets", gameId] as const
}

/** One game, as the website's `useFetchSingleGameData`; null when it does not exist. */
export function useWingoGame(gameId: string, refetchInterval: number | false) {
  return useQuery({
    queryKey: wingoGameKey(gameId),
    refetchInterval,
    queryFn: async (): Promise<WingoGameResult | null> => {
      const res = await post<Envelope<unknown>>("/wingo/getTournaments", { gameId })
      return parseWingoGameResult(res.data, gameId)
    },
  })
}

/** This player's paid tickets for a game. */
export function useWingoTickets(gameId: string, enabled: boolean) {
  return useQuery({
    queryKey: wingoTicketsKey(gameId),
    enabled,
    queryFn: async (): Promise<OwnedTicket[]> => {
      const res = await post<Envelope<unknown>>("/wingo/getTickets", { tournamentId: gameId, isPaid: true })
      return parseOwnedTickets(res.data)
    },
  })
}

export function useBingoGames(enabled: boolean) {
  return useQuery({
    queryKey: ["bingo", "running"],
    enabled,
    queryFn: async (): Promise<GameCard[]> => {
      const modes = ["live", "offline"] as const
      const lists = await Promise.all(
        modes.map((mode) =>
          post<Envelope<{ games?: Record<string, unknown>[] }>>("/bingo/getGames", {
            drawType: mode,
            status: "running",
            page: 1,
            count: 10,
          }).then((res) =>
            (res.data?.games ?? []).map(
              (g): GameCard => ({
                key: `bingo-${String(g.gameId)}`,
                kind: "bingo",
                gameId: String(g.gameId),
                title: String(g.title ?? g.name ?? ""),
                imageUrl: image((g.assets as Record<string, unknown> | undefined)?.imageUrl),
                ticketPrice: g.ticketPrice,
                prizePool: g.totalPrizePool,
                drawDate: g.drawDate,
                bingoMode: mode,
              }),
            ),
          ),
        ),
      )
      return lists.flat()
    },
  })
}

export function useTelegramStatus() {
  return useQuery({
    queryKey: ["telegram-status"],
    queryFn: async (): Promise<TelegramStatus> => {
      const res = await post<{ linked?: boolean; identity?: TelegramStatus["identity"] }>("/auth/telegram/status")
      return { linked: res.linked === true, identity: res.identity ?? null }
    },
  })
}

/** Website page for a Bingo game, opened outside the Mini App (Bingo play is not in the app yet). */
export function bingoUrl(siteUrl: string, lang: string, game: GameCard): string {
  return `${siteUrl}/${lang}/bingo/${game.bingoMode ?? "live"}?gameId=${encodeURIComponent(game.gameId)}`
}
