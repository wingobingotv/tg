import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { ApiError, get, post, type ResultMessage } from "../api"
import { Alert, Button, Field, Logo } from "../components/ui"
import { config } from "../config"
import { currentLanguage } from "../i18n"
import { haptic, openExternal } from "../telegram"
import {
  authErrorCopy,
  connectCodeFromStartParam,
  connectPreviewFrom,
  formatConnectCodeInput,
  isCompleteConnectCode,
  stateFromLinkResponse,
  type AuthState,
} from "./authFlow"

type LinkRequired = Extract<AuthState, { kind: "link_required" }>
type Mode = "intro" | "login" | "register" | "google" | "confirm"
type Captcha = { key: string; image: string }

function useCaptcha() {
  const [captcha, setCaptcha] = useState<Captcha | null>(null)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const r = await get<{ success?: boolean; captchaKey?: unknown; image?: unknown }>("/captcha", { auth: false })
      const ok =
        r.success === true &&
        typeof r.captchaKey === "string" &&
        typeof r.image === "string" &&
        r.image.startsWith("data:image/png;base64,")
      setCaptcha(ok ? { key: r.captchaKey as string, image: r.image as string } : null)
      setFailed(!ok)
    } catch {
      setCaptcha(null)
      setFailed(true)
    }
  }, [])

  return { captcha, failed, refresh }
}

function errorCode(err: unknown): string {
  if (err instanceof ApiError && err.status === 429) return "rate_limited"
  if (err instanceof ApiError && err.status === 0) return "network"
  return ""
}

export function LinkScreen({ state, onLinked }: { state: LinkRequired; onLinked: (next: AuthState) => void }) {
  const { t } = useTranslation()
  // Opened from the website's "Open Telegram" button after a Google sign-in.
  const [linkedCode] = useState(() => connectCodeFromStartParam(state.startParam))
  const [mode, setMode] = useState<Mode>(linkedCode ? "google" : "intro")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [errorKey, setErrorKey] = useState("")
  const [notice, setNotice] = useState("")
  const { captcha, failed: captchaFailed, refresh: refreshCaptcha } = useCaptcha()

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [userName, setUserName] = useState("")
  const [password, setPassword] = useState("")
  const [password2, setPassword2] = useState("")
  const [code, setCode] = useState("")
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [connectCode, setConnectCode] = useState(linkedCode ?? "")
  const [maskedEmail, setMaskedEmail] = useState("")

  const needsCaptcha = mode === "login" || mode === "register"
  useEffect(() => {
    if (needsCaptcha) void refreshCaptcha()
  }, [needsCaptcha, refreshCaptcha])

  const ticketExpired = () => state.linkTicketExpiresAt !== null && Date.now() >= state.linkTicketExpiresAt

  const fail = (codeOrEmpty: unknown) => {
    setError(t(authErrorCopy(codeOrEmpty)))
    setErrorKey(typeof codeOrEmpty === "string" ? codeOrEmpty : "")
    haptic("error")
    setCode("")
    if (needsCaptcha) void refreshCaptcha()
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setError("")
    setErrorKey("")
    setNotice("")
    setCode("")
  }

  const openGoogleSignIn = () => openExternal(`${config?.siteUrl ?? ""}/${currentLanguage()}/connect-telegram`)

  /** Without `confirm` the Player API only says which account the code belongs to. */
  const checkConnectCode = async (value: string) => {
    if (busy) return
    if (ticketExpired()) {
      setError(t(authErrorCopy("link_ticket_invalid")))
      return
    }
    setBusy(true)
    setError("")
    setErrorKey("")
    try {
      const res = await post<ResultMessage>(
        "/auth/telegram/connect",
        { linkTicket: state.linkTicket, code: value },
        { auth: false },
      )
      const preview = connectPreviewFrom(res)
      if (preview) {
        setMaskedEmail(preview.maskedEmail)
        setMode("confirm")
        return
      }
      fail(res.message)
    } catch (err) {
      fail(errorCode(err))
    } finally {
      setBusy(false)
    }
  }

  // Latest handler for the one-time deep-link check below.
  const checkRef = useRef(checkConnectCode)
  useEffect(() => {
    checkRef.current = checkConnectCode
  })
  useEffect(() => {
    if (linkedCode) void checkRef.current(linkedCode)
  }, [linkedCode])

  const submitConnectCode = (e: FormEvent) => {
    e.preventDefault()
    if (!isCompleteConnectCode(connectCode)) {
      setError(t("Enter the 8-character code from the browser."))
      return
    }
    void checkConnectCode(connectCode)
  }

  const confirmConnect = async () => {
    if (busy) return
    if (ticketExpired()) {
      setError(t(authErrorCopy("link_ticket_invalid")))
      return
    }
    setBusy(true)
    setError("")
    try {
      const res = await post<ResultMessage>(
        "/auth/telegram/connect",
        { linkTicket: state.linkTicket, code: connectCode, confirm: true },
        { auth: false },
      )
      const next = stateFromLinkResponse(res)
      if (next) {
        haptic("success")
        onLinked(next)
        return
      }
      setMode("google")
      setConnectCode("")
      fail(res.message)
    } catch (err) {
      fail(errorCode(err))
    } finally {
      setBusy(false)
    }
  }

  const submitLogin = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (ticketExpired()) {
      setError(t(authErrorCopy("link_ticket_invalid")))
      return
    }
    setBusy(true)
    setError("")
    try {
      const login = await post<ResultMessage & { userAuth?: unknown }>(
        "/user/login",
        { login: email.trim(), password, type: "2", captcha: code.trim().toUpperCase(), captchaKey: captcha?.key ?? "" },
        { auth: false },
      )
      if (login.success !== true || typeof login.userAuth !== "string") {
        fail(login.message)
        return
      }
      const emailSession = login.userAuth
      const linkRes = await post<ResultMessage>("/auth/telegram/link", { linkTicket: state.linkTicket }, { token: emailSession })
      const next = stateFromLinkResponse(linkRes)
      if (next) {
        haptic("success")
        onLinked(next)
        return
      }
      // The email session was only needed to prove the account.
      void post("/user/logout", {}, { token: emailSession }).catch(() => undefined)
      fail(linkRes.message)
    } catch (err) {
      fail(errorCode(err))
    } finally {
      setBusy(false)
    }
  }

  const submitRegister = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!acceptTerms) {
      setError(t("Please accept the terms and conditions"))
      return
    }
    setBusy(true)
    setError("")
    try {
      const res = await post<ResultMessage>(
        "/user/register",
        {
          name: name.trim(),
          email: email.trim(),
          userName: userName.trim(),
          password1: password,
          password2,
          captcha: code.trim().toUpperCase(),
          captchaKey: captcha?.key ?? "",
        },
        { auth: false },
      )
      if (res.success !== true) {
        fail(res.message)
        return
      }
      haptic("success")
      setMode("login")
      setPassword2("")
      setCode("")
      setNotice(t("Your account is ready. Sign in to connect Telegram."))
    } catch (err) {
      fail(errorCode(err))
    } finally {
      setBusy(false)
    }
  }

  const forgotPassword = () => openExternal(`${config?.siteUrl ?? ""}/${currentLanguage()}/forgot-password`)

  const captchaField = (
    <div className="captcha">
      <div className="captcha-row">
        {captcha ? (
          <img className="captcha-image" src={captcha.image} width={120} height={30} alt={t("Security code")} />
        ) : (
          <span className="captcha-image captcha-empty">{captchaFailed ? t("Could not load") : "…"}</span>
        )}
        <Button type="button" variant="link" onClick={() => void refreshCaptcha()}>
          {t("New code")}
        </Button>
      </div>
      <Field
        label={t("Security code")}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 5))}
        autoComplete="off"
        autoCapitalize="characters"
        inputMode="text"
        dir="ltr"
        required
        minLength={5}
        maxLength={5}
      />
    </div>
  )

  if (mode === "intro") {
    const who = state.firstName || state.username
    return (
      <main className="link-screen">
        <Logo size={56} />
        <h1>{who ? t("Hi {{name}}!", { name: who }) : t("Welcome to WingoBingo")}</h1>
        <p className="muted">
          {t("Connect your WingoBingo account once. After that, Telegram opens your account directly.")}
        </p>
        <div className="stack">
          <Button onClick={() => switchMode("google")}>{t("Continue with Google")}</Button>
          <Button variant="secondary" onClick={() => switchMode("login")}>
            {t("Sign in with email")}
          </Button>
          <Button variant="secondary" onClick={() => switchMode("register")}>
            {t("Create an account")}
          </Button>
        </div>
      </main>
    )
  }

  if (mode === "google") {
    return (
      <main className="link-screen">
        <Logo size={44} />
        <h1>{t("Continue with Google")}</h1>
        <p className="muted">
          {t("Google sign-in does not work inside Telegram, so it opens in your browser.")}
        </p>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <ol className="steps">
          <li>{t("Open the browser and sign in with Google.")}</li>
          <li>{t("Tap “Open Telegram” there, or type the code it shows below.")}</li>
        </ol>
        <form className="stack" onSubmit={submitConnectCode} noValidate>
          <Button type="button" onClick={openGoogleSignIn}>
            {t("Open the browser")}
          </Button>
          <Field
            label={t("Code from the browser")}
            value={connectCode}
            onChange={(e) => setConnectCode(formatConnectCodeInput(e.target.value))}
            placeholder="ABCD-EFGH"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            inputMode="text"
            dir="ltr"
            maxLength={9}
          />
          <Button type="submit" variant="secondary" busy={busy}>
            {t("Continue")}
          </Button>
          <Button type="button" variant="link" onClick={() => switchMode("intro")}>
            {t("Back")}
          </Button>
        </form>
      </main>
    )
  }

  if (mode === "confirm") {
    return (
      <main className="link-screen">
        <Logo size={44} />
        <h1>{t("Connect this account?")}</h1>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <p className="confirm-account" dir="ltr">
          {maskedEmail}
        </p>
        <p className="muted">{t("From now on, Telegram opens this WingoBingo account directly.")}</p>
        <Alert tone="info">{t("Only continue if you just signed in to this account in your own browser.")}</Alert>
        <div className="stack">
          <Button busy={busy} onClick={() => void confirmConnect()}>
            {t("Connect")}
          </Button>
          <Button
            variant="link"
            onClick={() => {
              setConnectCode("")
              switchMode("google")
            }}
          >
            {t("This is not my account")}
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="link-screen">
      <Logo size={44} />
      <h1>{mode === "login" ? t("Sign in to connect Telegram") : t("Create your account")}</h1>
      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {errorKey === "use_google_login" ? (
        <Button type="button" onClick={() => switchMode("google")}>
          {t("Continue with Google")}
        </Button>
      ) : null}

      {mode === "login" ? (
        <form className="stack" onSubmit={(e) => void submitLogin(e)} noValidate>
          <Field
            label={t("Email")}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            dir="ltr"
            required
            maxLength={70}
          />
          <Field
            label={t("Password")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            dir="ltr"
            required
            maxLength={50}
          />
          {captchaField}
          <Button type="submit" busy={busy}>
            {t("Sign in and connect")}
          </Button>
          <Button type="button" variant="link" onClick={forgotPassword}>
            {t("Forgot password?")}
          </Button>
          <Button type="button" variant="link" onClick={() => switchMode("register")}>
            {t("No account yet? Create one")}
          </Button>
        </form>
      ) : (
        <form className="stack" onSubmit={(e) => void submitRegister(e)} noValidate>
          <Field label={t("Name")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={100} />
          <Field
            label={t("Email")}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            dir="ltr"
            required
            maxLength={70}
          />
          <Field
            label={t("Username")}
            value={userName}
            onChange={(e) => setUserName(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 30))}
            autoComplete="username"
            dir="ltr"
            required
            hint={t("English letters and digits only")}
          />
          <Field
            label={t("Password")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            dir="ltr"
            required
            minLength={8}
            maxLength={50}
            hint={t("At least 8 characters")}
          />
          <Field
            label={t("Repeat password")}
            type="password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            autoComplete="new-password"
            dir="ltr"
            required
            maxLength={50}
          />
          {captchaField}
          <label className="terms">
            <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
            <span>{t("terms_checkbox_text")}</span>
          </label>
          <Button type="submit" busy={busy}>
            {t("Create account")}
          </Button>
          <Button type="button" variant="link" onClick={() => switchMode("login")}>
            {t("Already have an account? Sign in")}
          </Button>
        </form>
      )}
    </main>
  )
}
