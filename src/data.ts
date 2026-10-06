import { useQuery } from "@tanstack/react-query"
import { post, setDisplayCurrency } from "./api"

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
  kind: "wingo" | "bingo"
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

export function useWingoGames(enabled: boolean) {
  return useQuery({
    queryKey: ["wingo", "normal"],
    enabled,
    queryFn: async (): Promise<GameCard[]> => {
      const res = await post<Envelope<{ tournaments?: Record<string, unknown>[] }>>("/wingo/getTournaments", {
        type: "normal",
        page: 1,
        count: 10,
      })
      return (res.data?.tournaments ?? []).map((g) => ({
        key: `wingo-${String(g.gameId)}`,
        kind: "wingo",
        gameId: String(g.gameId),
        title: String(g.name ?? g.title ?? ""),
        imageUrl: image(g.mobileImageUrl),
        ticketPrice: g.ticketPrice,
        prizePool: g.totalPrizePool,
        drawDate: g.drawDate,
      }))
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

/** Website page for a game, opened outside the Mini App until ticket purchase ships here. */
export function gameUrl(siteUrl: string, lang: string, game: GameCard): string {
  const id = encodeURIComponent(game.gameId)
  if (game.kind === "wingo") return `${siteUrl}/${lang}/wingo/${id}`
  return `${siteUrl}/${lang}/bingo/${game.bingoMode ?? "live"}?gameId=${id}`
}
