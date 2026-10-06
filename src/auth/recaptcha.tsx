import { useCallback, useEffect, useRef, type ReactNode } from "react"
import { GoogleReCaptchaProvider, useGoogleReCaptcha } from "react-google-recaptcha-v3"
import { config } from "../config"

/**
 * Google reCAPTCHA v3, set up exactly as on wingobingo.tv
 * (WingoBingo/src/components/auth/AuthProviders.tsx and
 * src/hooks/auth/useRecaptchaToken.ts): same library, same site key, same
 * script options, same actions. The Player API verifies the token with
 * RECAPTCHA_V3_SECRET. Without a site key the link screen keeps the image captcha.
 */

export const recaptchaEnabled = Boolean(config?.recaptchaSiteKey)

/** Loads Google's script only where it is needed: the sign-in / sign-up screen. */
export function RecaptchaProvider({ children }: { children: ReactNode }) {
  if (!config?.recaptchaSiteKey) return <>{children}</>
  return (
    <GoogleReCaptchaProvider
      reCaptchaKey={config.recaptchaSiteKey}
      scriptProps={{ async: true, defer: true, appendTo: "head" }}
    >
      {children}
    </GoogleReCaptchaProvider>
  )
}

const WAIT_TIMEOUT_MS = 5000
const WAIT_INTERVAL_MS = 100

/**
 * A fresh token for `action`, or null when the script never became ready.
 * The script loads async, so a fast first submit waits briefly for it.
 */
export function useRecaptchaToken() {
  const { executeRecaptcha } = useGoogleReCaptcha()
  const executeRef = useRef(executeRecaptcha)

  useEffect(() => {
    executeRef.current = executeRecaptcha
  }, [executeRecaptcha])

  return useCallback(async (action: "login" | "register"): Promise<string | null> => {
    let execute = executeRef.current
    const start = Date.now()
    while (!execute && Date.now() - start < WAIT_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, WAIT_INTERVAL_MS))
      execute = executeRef.current
    }
    if (!execute) return null
    try {
      return await execute(action)
    } catch {
      return null
    }
  }, [])
}
