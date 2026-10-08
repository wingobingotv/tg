import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { getDisplayCurrency } from "../../api"
import { AmountField, DepositErrorNotice, useUsdRate } from "../../components/deposit"
import { Alert, Button, Spinner } from "../../components/ui"
import { useProfile } from "../../data"
import { formatMoney } from "../../format"
import { currentLanguage } from "../../i18n"
import { useNav } from "../../navigation"
import { cardFieldHelp, IDENTITY_FIELD_KEYS, normalizeCardField, validateCardField } from "../../payments/cardFields"
import {
  CARD_MINIMUM_USD,
  depositErrorKey,
  fetchCardOptions,
  fetchSavedDetails,
  minimumIn,
  parseAmount,
  quickAmounts,
  removeSavedDetails,
  startCardPayment,
  type CardField,
  type CardMethodOption,
} from "../../payments/deposit"
import { haptic, openExternal } from "../../telegram"

const SAVED_KEY = ["deposit", "card", "saved"] as const
const LTR_FIELDS = new Set(["phone", "email", "dob", "id_number", "additional_id_number"])

/**
 * Visa / Mastercard and the local methods of the player's country, as on the
 * website's card deposit. The provider's page opens inside Telegram; the
 * payment screen then follows the result.
 */
export function CardDeposit() {
  const { t } = useTranslation()
  const lang = currentLanguage()
  const nav = useNav()
  const queryClient = useQueryClient()
  const currency = getDisplayCurrency()
  const rate = useUsdRate(currency)
  const profile = useProfile()
  const options = useQuery({ queryKey: ["deposit", "card", "options"], staleTime: 60_000, queryFn: fetchCardOptions })
  const methodsActive = options.data?.active === true
  const saved = useQuery({ queryKey: SAVED_KEY, enabled: methodsActive, staleTime: 60_000, queryFn: fetchSavedDetails })

  const [method, setMethod] = useState<CardMethodOption | null>(null)
  const [amount, setAmount] = useState("")
  const [values, setValues] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitted, setSubmitted] = useState(false)
  const [savedHandled, setSavedHandled] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  const country = options.data?.country ?? null
  const fields = useMemo(() => method?.fields ?? [], [method])
  const minimum = rate.data ? minimumIn(options.data?.minimumUsd ?? CARD_MINIMUM_USD, rate.data) : null
  const money = (n: number) => formatMoney(n, currency, lang)

  const savedForMethod = method
    ? (saved.data ?? []).find((s) => s.provider === "riverpe" && s.methodKey === method.methodKey)
    : undefined
  const savedMethods = new Set((saved.data ?? []).filter((s) => s.provider === "riverpe").map((s) => s.methodKey))

  const errors = useMemo(() => {
    const out: Record<string, string> = {}
    for (const f of fields) {
      const e = validateCardField(t, f.key, values[f.key] ?? "", f.required, country, values)
      if (e) out[f.key] = e
    }
    return out
  }, [fields, values, country, t])

  const removeSaved = useMutation({
    mutationFn: () => removeSavedDetails(savedForMethod?.provider ?? "riverpe", savedForMethod?.methodKey ?? ""),
    onSuccess: () => {
      setSavedHandled(true)
      setNotice(t("Saved details removed"))
      void queryClient.invalidateQueries({ queryKey: SAVED_KEY })
    },
    onError: () => setNotice(t("Couldn't remove saved details. Please try again.")),
  })

  const pickMethod = (next: CardMethodOption | null) => {
    setMethod(next)
    setValues({})
    setTouched({})
    setSubmitted(false)
    setSavedHandled(false)
    setErrorKey(null)
    setNotice(null)
    setProblem(null)
  }

  if (options.isPending || rate.isPending) return <Spinner />

  if (options.isError) {
    return (
      <div className="stack">
        <DepositErrorNotice errorKey={depositErrorKey(options.error, "card")} />
        <Button variant="secondary" onClick={() => void options.refetch()}>
          {t("Try again")}
        </Button>
      </div>
    )
  }

  if (options.data.cardAvailable === false) {
    return (
      <section className="card">
        <h2 className="card-title">{t("Card payment is unavailable")}</h2>
        <p className="muted small">
          {t("Visa/Mastercard payments aren't available in your country right now. Please choose another deposit method.")}
        </p>
        <Button variant="secondary" onClick={nav.back}>
          {t("Back")}
        </Button>
      </section>
    )
  }

  if (methodsActive && !method) {
    return (
      <section className="stack" aria-labelledby="card-methods-title">
        <h2 id="card-methods-title" className="card-title">
          {t("Choose how to pay")}
        </h2>
        <p className="muted small">
          {t("Local payment methods available in {{country}}. Pick one to continue.", {
            country: options.data.countryLabel ?? options.data.country ?? "",
          })}
        </p>
        <div className="method-list">
          {options.data.methods.map((m) => (
            <button key={m.methodKey} type="button" className="method-row" onClick={() => pickMethod(m)}>
              <span className="method-text">
                <span className="method-title">{t(m.labelKey)}</span>
                {m.descriptionKey ? <span className="method-sub">{t(m.descriptionKey)}</span> : null}
                {savedMethods.has(m.methodKey) ? <span className="method-badge">{t("Saved details")}</span> : null}
              </span>
              <span className="method-chevron" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    )
  }

  const setField = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }))
  const payerFields = fields.filter((f) => !IDENTITY_FIELD_KEYS.has(f.key))
  const identityFields = fields.filter((f) => IDENTITY_FIELD_KEYS.has(f.key))
  const canFillFromProfile = Boolean(profile.data && fields.some((f) => ["first_name", "last_name", "email"].includes(f.key)))

  const fillFromProfile = () => {
    const p = profile.data
    if (!p) return
    const [first = "", ...rest] = (p.name ?? "").trim().split(/\s+/)
    const mine: Record<string, string> = { first_name: first, last_name: rest.join(" "), email: p.email ?? "" }
    setValues((v) => {
      const next = { ...v }
      for (const f of fields) if (mine[f.key]) next[f.key] = mine[f.key] ?? ""
      return next
    })
  }

  const applySaved = () => {
    if (!savedForMethod) return
    setValues((v) => {
      const next = { ...v }
      for (const f of fields) if (savedForMethod.fields[f.key]) next[f.key] = savedForMethod.fields[f.key] ?? ""
      return next
    })
    setSavedHandled(true)
  }

  const pay = async () => {
    if (inFlight.current) return
    setErrorKey(null)
    setNotice(null)
    setProblem(null)
    setSubmitted(true)
    const value = parseAmount(amount)
    if (minimum == null) {
      setErrorKey("rate_unavailable")
      return
    }
    if (value == null || value < minimum) {
      setProblem(t("At least {{amount}} is required", { amount: money(minimum) }))
      haptic("error")
      return
    }
    if (Object.keys(errors).length) {
      setProblem(t("Please check the highlighted fields"))
      haptic("error")
      return
    }
    const customer: Record<string, string> = {}
    const payload: Record<string, string> = {}
    for (const f of fields) {
      const v = normalizeCardField(f.key, values[f.key] ?? "", country)
      if (!v) continue
      if (f.scope === "payload") payload[f.key] = v
      else customer[f.key] = v
    }
    inFlight.current = true
    setBusy(true)
    try {
      const started = await startCardPayment({ amount: value, methodKey: method?.methodKey ?? null, customer, payload })
      if (started.paymentLink) openExternal(started.paymentLink)
      nav.replace({ name: "payment", paymentId: started.paymentId })
    } catch (err) {
      setErrorKey(depositErrorKey(err, "card"))
      haptic("error")
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const renderField = (f: CardField) => {
    const help = cardFieldHelp(t, f.key, country, values)
    const error = submitted || touched[f.key] ? errors[f.key] : ""
    const id = `card-field-${f.key}`
    const common = {
      id,
      className: "field-input",
      value: values[f.key] ?? "",
      required: f.required,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": `${id}-note`,
      onBlur: () => setTouched((x) => ({ ...x, [f.key]: true })),
    }
    return (
      <div key={f.key} className="field">
        <label className="field-label" htmlFor={id}>
          {t(f.labelKey)}
          {f.required ? (
            <span className="field-required" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
        {f.type === "select" ? (
          <select {...common} onChange={(e) => setField(f.key, e.target.value)}>
            <option value="">{t("Select…")}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
        ) : (
          <input
            {...common}
            type={f.type}
            dir={LTR_FIELDS.has(f.key) ? "ltr" : undefined}
            placeholder={help?.placeholder ?? (f.placeholderKey ? t(f.placeholderKey) : undefined)}
            inputMode={help?.inputMode}
            autoComplete={help?.autoComplete}
            max={help?.max}
            onChange={(e) => setField(f.key, e.target.value)}
          />
        )}
        <span id={`${id}-note`} className={error ? "field-error" : "field-hint"} role={error ? "alert" : undefined}>
          {error || help?.helper || ""}
        </span>
      </div>
    )
  }

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void pay()
      }}
    >
      {method ? (
        <div className="method-picked">
          <span className="method-text">
            <span className="method-title">{t(method.labelKey)}</span>
            {method.descriptionKey ? <span className="method-sub">{t(method.descriptionKey)}</span> : null}
          </span>
          <Button type="button" variant="link" onClick={() => pickMethod(null)}>
            {t("Change")}
          </Button>
        </div>
      ) : (
        <p className="muted small">{t("A secure card page opens inside Telegram. When you're done, you come back here to see the result.")}</p>
      )}

      <section className="card">
        <AmountField
          value={amount}
          onChange={setAmount}
          currency={currency}
          minimum={minimum}
          quick={rate.data ? quickAmounts(rate.data, minimum ?? 0) : []}
          hint={
            options.data.chargeCurrency === "IRR" && currency !== "IRR"
              ? t("Enter the amount in {{currency}}. Your card is charged in Iranian rial at today's exchange rate.", { currency })
              : undefined
          }
        />
        {minimum == null ? <DepositErrorNotice errorKey="rate_unavailable" /> : null}
      </section>

      {savedForMethod && !savedHandled ? (
        <section className="card card-accent" aria-labelledby="card-saved-title">
          <h3 id="card-saved-title" className="card-title">
            {t("Use the details you saved last time?")}
          </h3>
          {savedForMethod.fields.first_name || savedForMethod.fields.last_name ? (
            <p className="muted small">
              {t("Payer: {{name}}", {
                name: [savedForMethod.fields.first_name, savedForMethod.fields.last_name].filter(Boolean).join(" "),
              })}
            </p>
          ) : null}
          <div className="btn-row">
            <Button type="button" onClick={applySaved}>
              {t("Use saved details")}
            </Button>
            <Button type="button" variant="secondary" busy={removeSaved.isPending} onClick={() => removeSaved.mutate()}>
              {t("Remove")}
            </Button>
          </div>
        </section>
      ) : null}

      {payerFields.length ? (
        <section className="card" aria-labelledby="card-payer-title">
          <div className="card-head">
            <h3 id="card-payer-title" className="card-title">
              {t("Payer details")}
            </h3>
            {canFillFromProfile ? (
              <Button type="button" variant="link" onClick={fillFromProfile}>
                {t("I'm the payer — use my details")}
              </Button>
            ) : null}
          </div>
          <p className="muted small">
            {t("Enter the details of the person who owns the account you pay from, exactly as on their ID. It doesn't have to be you.")}
          </p>
          {payerFields.map(renderField)}
        </section>
      ) : null}

      {identityFields.length ? (
        <section className="card" aria-labelledby="card-id-title">
          <h3 id="card-id-title" className="card-title">
            {t("Payer's ID")}
          </h3>
          <p className="muted small">{t("The bank checks these against its records, so type them exactly as printed.")}</p>
          {identityFields.map(renderField)}
        </section>
      ) : null}

      {method && fields.length ? (
        <p className="muted small">{t("These details are saved encrypted for your next payment. You can remove them at any time.")}</p>
      ) : null}

      {errorKey ? <DepositErrorNotice errorKey={errorKey} /> : null}
      {problem ? <Alert tone="error">{problem}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}

      <Button type="submit" busy={busy} disabled={minimum == null}>
        {method ? t("Continue to payment") : t("Pay")}
      </Button>
    </form>
  )
}
