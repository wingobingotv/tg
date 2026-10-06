import { createContext, useContext } from "react"

/** In-app screens. Game screens stack on top of the two tabs. */
export type Route =
  | { name: "home" }
  | { name: "profile" }
  | { name: "wingo"; gameId: string }
  | { name: "live"; gameId: string }

const START_ROUTE_RE = /^(wingo|live)_(\d{1,12})$/

/**
 * Deep links from the bot (`t.me/<bot>?startapp=wingo_4928` / `live_4928`).
 * Only navigation: the parameter never grants access to anything.
 */
export function routeFromStartParam(startParam: string | null | undefined): Route | null {
  const m = START_ROUTE_RE.exec(String(startParam ?? ""))
  if (!m?.[1] || !m[2]) return null
  return m[1] === "live" ? { name: "live", gameId: m[2] } : { name: "wingo", gameId: m[2] }
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
