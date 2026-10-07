import { createContext, useContext } from "react"
import type { DepositMethod } from "./payments/deposit"

/** In-app screens. Game screens stack on top of the three tabs. */
export type Route =
  | { name: "home" }
  | { name: "winners" }
  | { name: "profile" }
  | { name: "wingo"; gameId: string }
  | { name: "live"; gameId: string }
  | { name: "winner"; gameId: string }
  | { name: "add-funds" }
  | { name: "deposit"; method: DepositMethod }
  | { name: "payment"; paymentId: string }

export type TabName = "home" | "winners" | "profile"

export function isTab(route: Route): route is { name: TabName } {
  return route.name === "home" || route.name === "winners" || route.name === "profile"
}

/** Same screen with the same subject (game, method or payment). */
export function sameRoute(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false
  if ("gameId" in a && "gameId" in b) return a.gameId === b.gameId
  if ("method" in a && "method" in b) return a.method === b.method
  if ("paymentId" in a && "paymentId" in b) return a.paymentId === b.paymentId
  return true
}

const START_ROUTE_RE = /^(wingo|live|winner)_(\d{1,12})$/
const START_PAYMENT_RE = /^pay_(\d{1,20})$/

/**
 * Deep links from the bot (`t.me/<bot>?startapp=wingo_4928`, `live_4928`,
 * `winner_4928`, `winners`) and the return from a card payment page
 * (`pay_<payment id>`). Only navigation: the parameter never grants access,
 * and a payment is shown only if it belongs to the signed-in player.
 */
export function routeFromStartParam(startParam: string | null | undefined): Route | null {
  const param = String(startParam ?? "")
  if (param === "winners") return { name: "winners" }
  const pay = START_PAYMENT_RE.exec(param)
  if (pay?.[1]) return { name: "payment", paymentId: pay[1] }
  const m = START_ROUTE_RE.exec(param)
  if (!m?.[1] || !m[2]) return null
  const name = m[1] === "live" ? "live" : m[1] === "winner" ? "winner" : "wingo"
  return { name, gameId: m[2] }
}

export type Navigator = {
  open(route: Route): void
  /** Swaps the current screen, so Back skips it (a form once its payment has started). */
  replace(route: Route): void
  back(): void
}

const NavContext = createContext<Navigator>({ open: () => undefined, replace: () => undefined, back: () => undefined })

export const NavProvider = NavContext.Provider

export function useNav(): Navigator {
  return useContext(NavContext)
}
