import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { post, setDisplayCurrency } from "./api"
import {
  parseDrawDays,
  parseWinnerDetail,
  parseWinnersPage,
  type WinnerDetailResult,
  type WinnerEventType,
} from "./games/winners"
import {
  parseOwnedTickets,
  parseWingoGame,
  parseWingoGameResult,
  type OwnedTicket,
  type WingoGame,
  type WingoGameResult,
} from "./games/wingo"

/** Same endpoints and parameters as the website's hooks (useFetchNormalTournaments, winners archive). */

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

export type TelegramStatus = {
  linked: boolean
  identity: { telegramUserId: string; username: string | null; firstName: string | null; linkedAt: string } | null
}

type Envelope<T> = { data?: T }

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
export function useWingoGame(
  gameId: string,
  refetchInterval: number | false | ((data: WingoGameResult | null | undefined) => number | false),
) {
  return useQuery({
    queryKey: wingoGameKey(gameId),
    refetchInterval: typeof refetchInterval === "function" ? (query) => refetchInterval(query.state.data) : refetchInterval,
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

export type WinnersFilters = { eventType: WinnerEventType; date: number | null; gameId: string }

const WINNERS_PAGE = 10

/** Website `useGetRecentWinnersPreview`: `/wingo/getWinners`, 10 per page, filters only when set. */
export function useWingoWinners(filters: WinnersFilters) {
  const gameId = /^\d+$/.test(filters.gameId) ? filters.gameId : undefined
  return useInfiniteQuery({
    queryKey: ["wingo", "winners", filters.eventType, filters.date ?? "all", gameId ?? ""],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const res = await post<unknown>("/wingo/getWinners", {
        page: pageParam,
        count: WINNERS_PAGE,
        ...(filters.date ? { date: filters.date } : {}),
        ...(gameId ? { gameId } : {}),
        ...(filters.eventType !== "all" ? { eventType: filters.eventType } : {}),
      })
      return parseWinnersPage(res)
    },
    getNextPageParam: (last, pages) => (last.items.length < WINNERS_PAGE ? undefined : pages.length + 1),
  })
}

/** Website `useGetDrawTimes("wingo", eventType)`: the days that had a draw. */
export function useDrawDays(eventType: WinnerEventType) {
  return useQuery({
    queryKey: ["wingo", "draw-days", eventType],
    queryFn: async () => {
      const res = await post<Envelope<unknown>>("/getDrawTimes", {
        type: "wingo",
        ...(eventType !== "all" ? { eventType } : {}),
      })
      return parseDrawDays(res.data)
    },
  })
}

export function winnerDetailKey(gameId: string) {
  return ["wingo", "winner", gameId] as const
}

/** One finished draw, as the website's winners detail page loads it. */
export function useWinnerDetail(gameId: string) {
  return useQuery({
    queryKey: winnerDetailKey(gameId),
    queryFn: async (): Promise<WinnerDetailResult | null> => {
      const res = await post<Envelope<unknown>>("/getGameDetails", { gameId, gameType: "Wingo" })
      return parseWinnerDetail(res.data, gameId)
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