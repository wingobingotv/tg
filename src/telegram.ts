/**
 * Thin typed wrapper over https://telegram.org/js/telegram-web-app.js.
 *
 * Only `initData` (the signed raw string) is ever sent to the server.
 * `initDataUnsafe` is unsigned: it is read only for display hints, such as the
 * language and whether a stored session belongs to the same Telegram user.
 */

type TelegramUserHint = {
  id?: number
  first_name?: string
  language_code?: string
}

/** What Telegram's invoice sheet reports when it closes. A hint only, never proof of payment. */
export type InvoiceStatus = "paid" | "cancelled" | "failed" | "pending"

type BackButton = {
  show(): void
  hide(): void
  onClick(cb: () => void): void
  offClick(cb: () => void): void
}

export type TelegramWebApp = {
  initData: string
  initDataUnsafe: { user?: TelegramUserHint; start_param?: string }
  version: string
  platform: string
  ready(): void
  expand(): void
  close(): void
  isVersionAtLeast(version: string): boolean
  setHeaderColor?(color: string): void
  setBackgroundColor?(color: string): void
  setBottomBarColor?(color: string): void
  openLink(url: string, options?: { try_instant_view?: boolean }): void
  openTelegramLink(url: string): void
  showConfirm?(message: string, cb: (ok: boolean) => void): void
  openInvoice?(url: string, cb?: (status: InvoiceStatus) => void): void
  onEvent(event: string, cb: () => void): void
  offEvent(event: string, cb: () => void): void
  BackButton?: BackButton
  HapticFeedback?: { notificationOccurred(type: "error" | "success" | "warning"): void }
}

const BRAND_BG = "#0c0a09"

/** The WebApp object, only when the page really runs inside Telegram. */
export function getWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null
  const app = window.Telegram?.WebApp
  if (!app || typeof app.initData !== "string" || app.initData.length === 0) return null
  return app
}

export function initWebApp(app: TelegramWebApp): void {
  try {
    app.ready()
    app.expand()
  } catch {
    // Older clients lack some methods; the app still works without them.
  }
  setChromeColor(app, BRAND_BG)
}

/** Telegram's own header, background and bottom bar, matched to the page. */
export function setChromeColor(app: TelegramWebApp | null, color: string): void {
  if (!app) return
  try {
    if (app.isVersionAtLeast("6.1")) {
      app.setHeaderColor?.(color)
      app.setBackgroundColor?.(color)
    }
    if (app.isVersionAtLeast("7.10")) app.setBottomBarColor?.(color)
  } catch {
    // Older clients lack some methods; the app still works without them.
  }
}

export function telegramUserIdHint(app: TelegramWebApp | null): number | null {
  const id = app?.initDataUnsafe?.user?.id
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null
}

export function telegramLanguageHint(app: TelegramWebApp | null): string {
  return app?.initDataUnsafe?.user?.language_code?.toLowerCase() ?? ""
}

export function openExternal(url: string): void {
  const app = getWebApp()
  if (app) app.openLink(url)
  else window.open(url, "_blank", "noopener,noreferrer")
}

/**
 * Opens Telegram's payment sheet for an invoice link and resolves with what
 * the sheet reported. Older clients without `openInvoice` open the link
 * instead and resolve "pending": the server decides what happened either way.
 */
export function openInvoice(url: string): Promise<InvoiceStatus> {
  const app = getWebApp()
  if (app?.openInvoice && app.isVersionAtLeast("6.1")) {
    return new Promise((resolve) => {
      try {
        app.openInvoice?.(url, (status) => resolve(status))
      } catch {
        resolve("failed")
      }
    })
  }
  if (app) app.openTelegramLink(url)
  else window.open(url, "_blank", "noopener,noreferrer")
  return Promise.resolve("pending")
}

export function confirmAction(message: string): Promise<boolean> {
  const app = getWebApp()
  if (app?.showConfirm && app.isVersionAtLeast("6.2")) {
    return new Promise((resolve) => app.showConfirm?.(message, resolve))
  }
  return Promise.resolve(window.confirm(message))
}

export function haptic(type: "error" | "success" | "warning"): void {
  try {
    const app = getWebApp()
    if (app?.isVersionAtLeast("6.1")) app.HapticFeedback?.notificationOccurred(type)
  } catch {
    // Haptics are a nicety only.
  }
}
