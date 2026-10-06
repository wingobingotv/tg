import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react"

export function Logo({ size = 40 }: { size?: number }) {
  return <img className="logo" src="/favicon.svg" width={size} height={size} alt="WingoBingo" />
}

export function Button({
  variant = "primary",
  busy = false,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "link"; busy?: boolean }) {
  return (
    <button {...rest} className={`btn btn-${variant}`} disabled={rest.disabled || busy} aria-busy={busy || undefined}>
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  )
}

export function Field({
  label,
  hint,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input {...input} className="field-input" />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function Alert({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  return (
    <p className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  )
}

export function Spinner() {
  return <span className="spinner spinner-lg" aria-hidden="true" />
}
