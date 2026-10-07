import type { TFunction } from "i18next"
import {
  getCountryCallingCode,
  getExampleNumber,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js"
import examples from "libphonenumber-js/mobile/examples"

/**
 * Typing help and validation for the payer fields of a card / local-method
 * deposit. Same rules and copy as the website's `riverpeFieldRules.ts`; the
 * field keys come from the Player API catalog.
 */

export type FieldHelp = {
  helper: string
  placeholder?: string
  inputMode?: "numeric" | "tel" | "text" | "email"
  max?: string
  autoComplete?: string
}

/** Document fields, shown in their own section below the payer's details. */
export const IDENTITY_FIELD_KEYS = new Set(["id_type", "id_number", "additional_id_number"])

const NAME_RE = /^[\p{L}][\p{L}\p{M}' .-]{0,49}$/u
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function countryCode(country: string | null): CountryCode | undefined {
  const code = String(country ?? "").trim().toUpperCase()
  return isSupportedCountry(code) ? code : undefined
}

function toLatinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
}

/** E.164 for a valid number in `country`, or null. */
export function toE164(raw: string, country: string | null): string | null {
  let value = toLatinDigits(raw).trim().replace(/[\s\-().]/g, "")
  if (value.startsWith("00")) value = `+${value.slice(2)}`
  if (!value || !/^\+?\d+$/.test(value)) return null
  const parsed = parsePhoneNumberFromString(value, countryCode(country))
  return parsed && parsed.isValid() ? parsed.number : null
}

function phoneExample(country: string | null): string | null {
  const cc = countryCode(country)
  if (!cc) return null
  const example = getExampleNumber(cc, examples)
  return example ? example.formatInternational().replace(`+${getCountryCallingCode(cc)}`, "").trim() : null
}

/** What the payment provider receives: phone in E.164, everything else trimmed. */
export function normalizeCardField(key: string, value: string, country: string | null): string {
  const trimmed = toLatinDigits(value).trim()
  if (key !== "phone" || !trimmed) return trimmed
  return toE164(trimmed, country) ?? trimmed
}

export function latestAdultDob(now = new Date()): string {
  const d = new Date(now)
  d.setFullYear(d.getFullYear() - 18)
  return d.toISOString().slice(0, 10)
}

const isNigeria = (country: string | null) => String(country || "").toUpperCase() === "NG"

export function cardFieldHelp(t: TFunction, key: string, country: string | null, values: Record<string, string>): FieldHelp | null {
  switch (key) {
    case "first_name":
      return { helper: t("The payer's name exactly as on their ID and bank account."), autoComplete: "given-name" }
    case "last_name":
      return { helper: t("The payer's name exactly as on their ID and bank account."), autoComplete: "family-name" }
    case "email":
      return { helper: t("The payer's email address."), placeholder: "name@example.com", inputMode: "email", autoComplete: "email" }
    case "phone": {
      const example = phoneExample(country)
      return example
        ? { helper: t("The payer's mobile number, with or without the country code."), placeholder: example, inputMode: "tel", autoComplete: "tel" }
        : { helper: t("Include your country code, e.g. +44 7700 900123."), placeholder: "+44 7700 900123", inputMode: "tel", autoComplete: "tel" }
    }
    case "dob":
      return { helper: t("As shown on the payer's ID. They must be 18 or older."), max: latestAdultDob() }
    case "address":
      return {
        helper: t("The payer's home address as registered with their bank: house number, street, city and state."),
        placeholder: t("e.g. 12 Allen Avenue, Ikeja, Lagos"),
        autoComplete: "street-address",
      }
    case "id_type":
      return { helper: t("Choose the document whose number you enter below.") }
    case "id_number":
      if (!isNigeria(country)) return { helper: t("Exactly as printed on the document.") }
      switch (values.id_type) {
        case "nationalId":
          return {
            helper: t("The payer's 11-digit NIN, shown on their NIN slip or in the NIMC app."),
            placeholder: "12345678901",
            inputMode: "numeric",
          }
        case "passport":
          return { helper: t("As printed on the passport, e.g. A12345678."), placeholder: "A12345678" }
        case "license":
          return { helper: t("Exactly as printed on the driver's licence.") }
        case "votersCard":
          return { helper: t("The VIN printed on the voter's card.") }
        default:
          return { helper: t("Choose an ID type first.") }
      }
    case "additional_id_number":
      return {
        helper: t("The payer's 11-digit Bank Verification Number. Dialling *565*0# from the phone linked to their bank shows it."),
        placeholder: "22212345678",
        inputMode: "numeric",
      }
    default:
      return null
  }
}

/** Inline error for a filled or required field, or "" when it is valid. */
export function validateCardField(
  t: TFunction,
  key: string,
  rawValue: string,
  required: boolean,
  country: string | null,
  values: Record<string, string>,
  now = new Date(),
): string {
  const value = toLatinDigits(rawValue).trim()
  if (!value) return required ? t("This field is required") : ""

  switch (key) {
    case "first_name":
    case "last_name":
      return NAME_RE.test(value) ? "" : t("Use letters only, as written on the payer's ID")
    case "email":
      return EMAIL_RE.test(value) ? "" : t("The entered email is not valid")
    case "phone": {
      if (toE164(value, country)) return ""
      const example = phoneExample(country)
      return example
        ? t("Enter a valid mobile number, e.g. {{example}}", { example })
        : t("Enter a valid mobile number with your country code")
    }
    case "dob": {
      const date = new Date(value)
      if (Number.isNaN(date.getTime()) || date.getFullYear() < 1900) return t("Enter a valid date of birth")
      if (value > latestAdultDob(now)) return t("The payer must be at least 18 years old")
      return ""
    }
    case "address":
      return value.length < 10 || !/[a-zA-Z\u0600-\u06FF]/.test(value) ? t("Enter the full address, including street and city") : ""
    case "id_number":
      if (!isNigeria(country)) return value.length < 4 ? t("Enter the number exactly as printed on your document") : ""
      if (values.id_type === "nationalId") return /^\d{11}$/.test(value) ? "" : t("NIN must be exactly 11 digits")
      return /^[A-Za-z0-9 -]{6,25}$/.test(value) ? "" : t("Enter the number exactly as printed on your document")
    case "additional_id_number":
      return /^\d{11}$/.test(value) ? "" : t("BVN must be exactly 11 digits")
    default:
      return ""
  }
}
