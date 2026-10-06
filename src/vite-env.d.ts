/// <reference types="vite/client" />

import type { TelegramWebApp } from "./telegram"

declare global {
  interface Window {
    __WINGOBINGO_CONFIG__?: Record<string, unknown>
    Telegram?: { WebApp?: TelegramWebApp }
  }
}
