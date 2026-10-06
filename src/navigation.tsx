import { createContext, useContext } from "react"

/** In-app screens. Game screens stack on top of the three tabs. */
export type Route =
  | { name: "home" }
  | { name: "winners" }
  | { name: "profile" }
  | { name: "wingo"; gameId: string }
  | { name: "live"; gameId: string }
  | { name: "winner"; gameId: string }

export type TabName = "home" | "winners" | "profile"

export function isTab(route: Route): route is { name: TabName } {
  return route.name === "home" || route.name === "winners" || route.name === "profile"
}

const START_ROUTE_RE = /^(wingo|live|winner)_(\d{1,12})$/

/**
 * Deep links from the bot (`t.me/<bot>?startapp=wingo_4928`, `live_4928`,
 * `winner_4928`, `winners`). Only navigation: the parameter never grants access.
 */
export function routeFromStartParam(startParam: string | null | undefined): Route | null {
  const param = String(startParam ?? "")
  if (param === "winners") return { name: "winners" }
  const m = START_ROUTE_RE.exec(param)
  if (!m?.[1] || !m[2]) return null
  const name = m[1] === "live" ? "live" : m[1] === "winner" ? "winner" : "wingo"
  return { name, gameId: m[2] }
}

export type Navigator = {
  open(route: Route): void
  back(): void
}

const NavContext = createContext<Navigator>({ open: () => undefined, back: () => undefined })

export const NavProvider = NavContext.Provider

export function useNav(): Navigator {
  return useContext(NavContext)
}
