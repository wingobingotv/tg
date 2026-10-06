import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import ar from "../locales/ar/translation.json"
import en from "../locales/en/translation.json"
import fa from "../locales/fa/translation.json"
import fr from "../locales/fr/translation.json"
import { isLanguage, type Language } from "./config"

const LANG_KEY = "wb.tg.lang"
const RTL: readonly Language[] = ["ar", "fa"]

export function isRtl(lang: Language): boolean {
  return RTL.includes(lang)
}

/** Saved choice, then the Telegram client language, then the .env default. */
export function pickLanguage(saved: unknown, telegramHint: string, fallback: Language): Language {
  if (isLanguage(saved)) return saved
  const base = telegramHint.split("-")[0]
  return isLanguage(base) ? base : fallback
}

function readSaved(): string | null {
  try {
    return window.localStorage.getItem(LANG_KEY)
  } catch {
    return null
  }
}

function applyDocument(lang: Language): void {
  document.documentElement.lang = lang
  document.documentElement.dir = isRtl(lang) ? "rtl" : "ltr"
}

export function initI18n(telegramHint: string, fallback: Language): Language {
  const lang = pickLanguage(readSaved(), telegramHint, fallback)
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
      fa: { translation: fa },
      fr: { translation: fr },
    },
    lng: lang,
    fallbackLng: "en",
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  })
  applyDocument(lang)
  return lang
}

export function changeLanguage(lang: Language): void {
  try {
    window.localStorage.setItem(LANG_KEY, lang)
  } catch {
    // The choice still applies for this open.
  }
  void i18n.changeLanguage(lang)
  applyDocument(lang)
}

export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : "en"
}

export default i18n
