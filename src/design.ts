import { useSyncExternalStore } from "react"
import { post } from "./api"
import { getWebApp, setChromeColor, telegramUserIdHint } from "./telegram"

/**
 * Mini App look: "a" is the original, "b" the iGaming one. The Player API
 * decides per Telegram user (Admin → Telegram → Mini App Design). B is a
 * stylesheet scoped to `html[data-design="b"]` plus a few B-only elements, so
 * A renders exactly as before.
 */
export type Design = "a" | "b"

const STORAGE_KEY = "wb.tg.design"
const CHROME: Record<Design, string> = { a: "#0c0a09", b: "#0a0618" }

export function parseDesign(value: unknown): Design | null {
  return value === "a" || value === "b" ? value : null
}

/** The `data.design` of a /telegram/miniapp/design response, or null. */
export function designFromResponse(res: unknown): Design | null {
  if (!res || typeof res !== "object") return null
  const data = (res as { data?: unknown }).data
  if (!data || typeof data !== "object") return null
  return parseDesign((data as { design?: unknown }).design)
}

function readCached(): Design {
  try {
    return parseDesign(window.localStorage.getItem(STORAGE_KEY)) ?? "a"
  } catch {
    return "a"
  }
}

function writeCached(design: Design): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, design)
  } catch {
    // Storage blocked: the design still applies for this open.
  }
}

let current: Design = "a"
const listeners = new Set<() => void>()

function apply(design: Design): void {
  current = design
  document.documentElement.dataset.design = design
  setChromeColor(getWebApp(), CHROME[design])
  listeners.forEach((l) => l())
}

/**
 * Before the first render: the last design this player saw, so there is no
 * flash. Then the server's answer, which wins and is remembered for next time.
 */
export function initDesign(): void {
  apply(readCached())
  const tgUserId = telegramUserIdHint(getWebApp())
  post<unknown>("/telegram/miniapp/design", tgUserId ? { telegramUserId: String(tgUserId) } : {}, { auth: false })
    .then((res) => {
      const design = designFromResponse(res)
      if (!design) return
      writeCached(design)
      if (design !== current) apply(design)
    })
    .catch(() => {
      // The API client already reported it; the cached design stays.
    })
}

export function useDesign(): Design {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
    () => current,
  )
}
