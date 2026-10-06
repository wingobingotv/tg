#!/usr/bin/env node
/**
 * Native-tone translation with OpenAI.
 *
 * English is the source. Each string is rewritten the way a native copywriter
 * for that market would write it — meaning and context, not word by word. The
 * current translation is sent as a reference, so good copy is kept and stiff
 * copy is improved. Placeholders, HTML tags and brand names are checked; a
 * string that fails keeps its current value.
 *
 * What to translate comes from `i18n-native.config.json` in the repo root:
 *   { "languages": ["ar","fa","fr"],
 *     "sets": [ { "source": "locales/en", "target": "locales/{lang}", "kind": "ui" },
 *               { "source": "content/legal/en", "target": "content/legal/{lang}", "kind": "legal" } ] }
 * Every *.json in `source` maps to the same file name in `target`. Files may be
 * flat ({ key: text }) or nested; only string leaves are translated. A set with
 * `"output": ".i18n-cache/x/{lang}"` reads the committed `target` as the
 * reference and writes the result to `output` instead, so a git checkout that
 * is mounted into a container never gets local changes.
 *
 * Same file in WingoBingo, backend and wingobingiadminapi — keep them in sync.
 *
 * Runs automatically on deploy (`--build`): in the WingoBingo Docker build, and
 * at container start in the API repos. Translations are cached by English text
 * in I18N_CACHE_DIR, so only new or changed English strings reach OpenAI. With
 * `--build` nothing ever fails — a missing key or an OpenAI error keeps the
 * committed copy.
 *
 * Key: OPENAI_API_KEY (env), /run/secrets/openai_api_key, or `.env.local` /
 * `.env` in the repo root. Model: OPENAI_TRANSLATE_MODEL (default gpt-4o).
 * Bump PROMPT_VERSION to re-translate everything with a changed brief.
 *
 * Usage:
 *   node scripts/i18n-native-translate.mjs                    # every set, every language
 *   node scripts/i18n-native-translate.mjs --lang fa --file more.json
 *   node scripts/i18n-native-translate.mjs --dry-run          # print, write nothing
 *   node scripts/i18n-native-translate.mjs --build            # Docker build step
 */

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PROMPT_VERSION = "1"
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const CONFIG_FILE = path.join(ROOT, "i18n-native.config.json")

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const opt = name => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const BUILD = flag("--build")
const DRY_RUN = flag("--dry-run")
const ONLY_LANGS = opt("--lang")?.split(",").map(s => s.trim()).filter(Boolean)
const ONLY_FILE = opt("--file")
const CONCURRENCY = Number(process.env.I18N_CONCURRENCY || 6)
const BUDGET_MS = Number(process.env.I18N_BUILD_BUDGET_MIN || 45) * 60_000
const CACHE_DIR = process.env.I18N_CACHE_DIR || path.join(ROOT, ".i18n-cache")
const startedAt = Date.now()

/** Brand and product names that must stay unchanged when the source has them. */
const PROTECTED_TERMS = ["WingoBingo", "USDT", "TRC-20", "TRC20", "Visa", "Mastercard", "PayPal", "Google", "Middle Kang B.V."]

const PRODUCT = `WingoBingo is an online entertainment platform: live-streamed bingo rooms with a host, Wingo lottery-style number draws, quizzes and tournaments with cash prizes. Players top up a wallet (crypto, cards, local payment methods), buy tickets, win prizes and withdraw to their wallet or bank. There are referrals, bonuses, support tickets and responsible-gambling tools. Text appears in a mobile-first web app (buttons, labels, errors, toasts, onboarding, help and policy pages) and in emails.`

const LANGUAGE_BRIEFS = {
  ar: `Arabic. Write as a native Arabic copywriter for a consumer gaming/fintech app. Use clear, warm Modern Standard Arabic that reads naturally to players across the Gulf, Levant and Egypt — never stiff, bureaucratic or a literal calque of English. Use the terms Arabic players actually see in popular apps (e.g. "محفظة", "إيداع", "سحب", "تذكرة"). Address the player directly in a friendly, respectful way.`,
  fa: `Persian (Farsi, Iran). Write as a native Iranian copywriter for a popular consumer app (the tone of apps like Snapp or Digikala): natural, friendly and polite written Persian — not a word-by-word translation, not archaic or overly formal, not slang. Use the half-space (ZWNJ, U+200C) correctly (e.g. "می‌شود", "درخواست‌ها"). Use the words Iranian users expect ("کیف پول", "واریز", "برداشت", "بلیت"). Address the player with "شما".`,
  fr: `French (France). Write as a native French copywriter for a consumer gaming/fintech app: natural, fluent, friendly French as used in well-known French apps — not a literal translation. Use "vous". Follow French typography: a non-breaking space (U+00A0) before ; : ! ? and inside « ». Prefer the terms French players know ("portefeuille", "dépôt", "retrait", "ticket").`,
}

const KIND_RULES = {
  ui: `These are app UI strings. Keep them about as short as the English: buttons and labels stay short, no added explanations.`,
  legal: `These are paragraphs of a legal policy (terms, AML, KYC, privacy, responsible gambling, payouts, complaints). Keep the exact legal meaning: every party, obligation, right, condition, exception, amount, age, time limit and reference must survive unchanged. Use the register a native lawyer would use for a consumer-facing policy in that language — precise but readable, not a word-by-word calque. Never shorten or summarise.`,
  email: `These are transactional email texts. Warm, clear and trustworthy, as a well-known app in that market would write to its customers.`,
}

const SYSTEM_PROMPT = (lang, kind) => `You localise copy for WingoBingo.

${PRODUCT}

Target: ${LANGUAGE_BRIEFS[lang]}

${KIND_RULES[kind] || KIND_RULES.ui}

Rules:
- Translate the meaning and intent in context, the way a native speaker would naturally say it. Never translate word by word. Reorder, merge or split clauses when it reads better.
- Each item gives the English source, the file it belongs to, nearby strings for context, and the current translation (may be empty or poor). Keep the current translation when it is already natural and correct; otherwise rewrite it.
- Keep every placeholder exactly as written ({{name}}, {{count}}, {0}, %s, $t(...)), every HTML tag and attribute, line breaks, emojis, URLs, emails, numbers, currency codes and amounts.
- Keep these names unchanged: ${PROTECTED_TERMS.join(", ")}.
- Do not add or remove information.

Reply with JSON only: {"<id>": "<translation>", ...} with one entry per input id.`

// ---------------------------------------------------------------------------

const log = (...m) => console.log("[i18n-native]", ...m)
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"))
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n")
  fs.renameSync(tmp, file)
}

function loadApiKey() {
  if (process.env.OPENAI_API_KEY?.trim()) return process.env.OPENAI_API_KEY.trim()
  const secret = "/run/secrets/openai_api_key"
  if (fs.existsSync(secret)) {
    const v = fs.readFileSync(secret, "utf8").trim()
    if (v) return v
  }
  for (const file of [".env.local", ".env"]) {
    const p = path.join(ROOT, file)
    if (!fs.existsSync(p)) continue
    const line = fs
      .readFileSync(p, "utf8")
      .split(/\r?\n/)
      .find(l => /^\s*OPENAI_API_KEY\s*=/.test(l))
    const v = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "")
    if (v) return v
  }
  return ""
}

const tokens = (s, re) => (String(s).match(re) || []).sort().join("\u0000")
const PLACEHOLDER_RE = /\{\{[^}]+\}\}|\{\d+\}|%[sd]|\$t\([^)]*\)/g
const TAG_RE = /<\/?[a-zA-Z][^>]*>/g

/** Why a translation cannot be used, or null when it is safe. */
function problem(source, out) {
  if (typeof out !== "string" || !out.trim()) return "empty"
  if (tokens(source, PLACEHOLDER_RE) !== tokens(out, PLACEHOLDER_RE)) return "placeholders differ"
  if (tokens(source, TAG_RE).replace(/\s+/g, "") !== tokens(out, TAG_RE).replace(/\s+/g, "")) {
    return "HTML tags differ"
  }
  for (const term of PROTECTED_TERMS) {
    if (source.includes(term) && !out.includes(term)) return `"${term}" was changed`
  }
  return null
}

/** [[path, value]] for every string leaf; paths are JSON arrays of keys. */
function leaves(node, trail = [], out = []) {
  if (typeof node === "string") out.push([trail, node])
  else if (Array.isArray(node)) node.forEach((v, i) => leaves(v, [...trail, i], out))
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) leaves(v, [...trail, k], out)
  return out
}

const getPath = (node, trail) => trail.reduce((n, k) => (n == null ? undefined : n[k]), node)

/** Deep copy of `source` with string leaves replaced by `pick(path, en)`. */
function rebuild(source, pick, trail = []) {
  if (typeof source === "string") return pick(trail, source)
  if (Array.isArray(source)) return source.map((v, i) => rebuild(v, pick, [...trail, i]))
  if (source && typeof source === "object") {
    return Object.fromEntries(Object.entries(source).map(([k, v]) => [k, rebuild(v, pick, [...trail, k])]))
  }
  return source
}

// --- cache -----------------------------------------------------------------

const CACHE_FILE = path.join(CACHE_DIR, `translations-v${PROMPT_VERSION}.json`)
let cache = {}
try {
  cache = fs.existsSync(CACHE_FILE) ? readJson(CACHE_FILE) : {}
} catch {
  cache = {}
}
const cacheKey = (lang, kind, en) => crypto.createHash("sha256").update(`${lang}\u0000${kind}\u0000${en}`).digest("hex")
const saveCache = () => {
  if (DRY_RUN) return
  try {
    writeJson(CACHE_FILE, cache)
  } catch (e) {
    log(`could not write cache: ${e.message}`)
  }
}

// --- OpenAI ----------------------------------------------------------------

async function callModel(apiKey, lang, kind, items) {
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")
  const body = {
    model: process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o",
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT(lang, kind) },
      { role: "user", content: JSON.stringify(items) },
    ],
  }
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    })
    if (res.ok) {
      const data = await res.json()
      return JSON.parse(data.choices?.[0]?.message?.content || "{}")
    }
    const retryable = res.status === 429 || res.status >= 500
    if (!retryable || attempt >= 5) {
      throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }
    await new Promise(r => setTimeout(r, 2000 * 2 ** (attempt - 1)))
  }
}

/** Translate one batch; validated results go straight into the cache. */
async function translateBatch(apiKey, lang, kind, batch, rejected) {
  let pending = batch
  for (let pass = 1; pass <= 2 && pending.length; pass += 1) {
    const items = pending.map(item => ({
      id: item.id,
      file: item.file,
      en: item.en,
      current: item.current,
      context: item.context,
      ...(item.previousAttemptProblem ? { previousAttemptProblem: item.previousAttemptProblem } : {}),
    }))
    const reply = await callModel(apiKey, lang, kind, items)
    const retry = []
    for (const item of pending) {
      const out = reply[item.id]
      const why = problem(item.en, out)
      if (!why) cache[item.key] = out
      else if (pass === 1) retry.push({ ...item, previousAttemptProblem: why })
      else rejected.push({ file: item.file, en: item.en, reason: why })
    }
    pending = retry
  }
}

async function runPool(tasks) {
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++]
      if (Date.now() - startedAt > BUDGET_MS) return
      try {
        await task()
      } catch (e) {
        log(`batch failed: ${e.message}`)
      }
      done += 1
      if (done % 10 === 0 || done === tasks.length) {
        saveCache()
        log(`${done}/${tasks.length} batches`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker))
  saveCache()
}

// --- main ------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(CONFIG_FILE)) throw new Error(`Missing ${path.basename(CONFIG_FILE)}`)
  const config = readJson(CONFIG_FILE)
  const languages = (ONLY_LANGS || config.languages || []).filter(l => {
    if (LANGUAGE_BRIEFS[l]) return true
    log(`no language brief for "${l}", skipped`)
    return false
  })

  // Every file pair in every set.
  const jobs = []
  for (const set of config.sets || []) {
    const sourceDir = path.join(ROOT, set.source)
    if (!fs.existsSync(sourceDir)) continue
    for (const name of fs.readdirSync(sourceDir).filter(f => f.endsWith(".json")).sort()) {
      if (ONLY_FILE && name !== ONLY_FILE) continue
      for (const lang of languages) {
        jobs.push({
          kind: set.kind || "ui",
          lang,
          name,
          label: `${set.target.replace("{lang}", lang)}/${name}`,
          sourceFile: path.join(sourceDir, name),
          targetFile: path.join(ROOT, set.target.replace("{lang}", lang), name),
          outputFile: path.join(ROOT, (set.output || set.target).replace("{lang}", lang), name),
        })
      }
    }
  }

  // Strings not in the cache yet, batched per language + kind.
  const queued = new Map()
  for (const job of jobs) {
    job.source = readJson(job.sourceFile)
    job.target = fs.existsSync(job.targetFile) ? readJson(job.targetFile) : {}
    job.previous =
      job.outputFile !== job.targetFile && fs.existsSync(job.outputFile) ? readJson(job.outputFile) : job.target
    const list = leaves(job.source)
    list.forEach(([trail, en], idx) => {
      if (!en.trim()) return
      const key = cacheKey(job.lang, job.kind, en)
      if (cache[key] != null || queued.has(key)) return
      const current = getPath(job.target, trail)
      queued.set(key, {
        key,
        lang: job.lang,
        kind: job.kind,
        file: job.label,
        en,
        current: typeof current === "string" ? current : "",
        context: list.slice(Math.max(0, idx - 2), idx + 3).filter((_, i) => i !== Math.min(idx, 2)).map(([, v]) => v),
      })
    })
  }

  const apiKey = loadApiKey()
  const rejected = []
  if (queued.size && !apiKey) {
    log(`${queued.size} string(s) need translating but OPENAI_API_KEY is not set; keeping current copy.`)
  } else if (queued.size) {
    const groups = new Map()
    for (const item of queued.values()) {
      const g = `${item.lang}|${item.kind}`
      if (!groups.has(g)) groups.set(g, [])
      groups.get(g).push(item)
    }
    const tasks = []
    for (const [g, items] of groups) {
      const [lang, kind] = g.split("|")
      const size = kind === "legal" ? 8 : 30
      for (let i = 0; i < items.length; i += size) {
        const batch = items.slice(i, i + size).map((it, n) => ({ ...it, id: String(n) }))
        tasks.push(() => translateBatch(apiKey, lang, kind, batch, rejected))
      }
    }
    log(`translating ${queued.size} string(s) in ${tasks.length} batch(es), model ${process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o"}`)
    await runPool(tasks)
    if (Date.now() - startedAt > BUDGET_MS) log("time budget reached; the rest continues on the next build")
  }

  // Write every target from the cache (current copy where there is no entry).
  let changed = 0
  const legalChanges = []
  for (const job of jobs) {
    const next = rebuild(job.source, (trail, en) => {
      const current = getPath(job.target, trail)
      const hit = cache[cacheKey(job.lang, job.kind, en)]
      const value = hit ?? (typeof current === "string" ? current : en)
      if (hit != null && hit !== getPath(job.previous, trail)) {
        changed += 1
        if (job.kind === "legal") legalChanges.push(`${job.label} ${JSON.stringify(trail)}`)
      }
      return value
    })
    // Keys only the target has (plural forms such as Arabic `_two` / `_few`).
    if (job.kind !== "legal" && job.target && typeof job.target === "object" && !Array.isArray(job.target)) {
      for (const k of Object.keys(job.target)) if (!(k in next)) next[k] = job.target[k]
    }
    if (DRY_RUN) continue
    writeJson(job.outputFile, next)
  }

  log(`${DRY_RUN ? "would change" : "changed"} ${changed} string(s) across ${jobs.length} file(s)`)
  if (legalChanges.length) {
    log(`legal paragraphs rewritten (${legalChanges.length}) — for native/legal review:`)
    for (const c of legalChanges) log(`  ${c}`)
  }
  if (rejected.length) {
    log(`kept the current copy for ${rejected.length} string(s) that failed the checks:`)
    for (const r of rejected) log(`  ${r.file}: ${JSON.stringify(r.en.slice(0, 80))} — ${r.reason}`)
  }
}

main().catch(err => {
  log(err.message || err)
  process.exit(BUILD ? 0 : 1)
})
