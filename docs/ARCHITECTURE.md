# WingoBingo Telegram Mini App — Architecture

Status: **design, awaiting owner decisions** (section 9). Nothing here is deployed.

## 1. Shape

```
Telegram user
  → WingoBingo bot (webhook → Player API `backend`)
  → Mini App (this repo: static SPA on its own domain)
  → Player API `backend`        ← single source of truth: users, sessions, wallet,
                                  tickets, payments, referrals
  → shared MySQL (Prisma)       ← same database as the website
Admin Panel → Admin API → shared MySQL (Telegram settings, reports, audit)
Admin API → Player API internal endpoints (bot health, Stars quotes, refunds)
```

- **No new wallet, game engine, ticket store, user table or referral ledger.** The Mini App is
  one more client of the Player API, exactly like `WingoBingo`.
- **The bot token lives only in the Player API environment** (`TELEGRAM_BOT_TOKEN`). It is
  needed to check `initData`, create Stars invoices, answer pre-checkout queries and send
  messages. The Admin API never holds it; it asks the Player API through the existing
  internal-call pattern (`X-Internal-Key: PLAYER_API_INTERNAL_KEY`, as for
  `/internal/riverpe/payments/:id/verify`).

## 2. Which repo owns what

| Concern | Repo | Why |
|---|---|---|
| `initData` validation, Telegram sessions, account linking | `backend` | Owns `users` and `sessions` and issues sessions today (`Helpers.generateSession` + `UserService.createSessionWithType`) |
| Bot webhook (`/start`, pre-checkout, successful payment, refunds) | `backend` | Payment confirmation must reach the credit path (`PaymentService._creditDepositOnce`) |
| `TelegramStarsProvider` and the pricing engine | `backend` | One engine; the Admin preview calls it through an internal endpoint instead of a second copy |
| `telegram_identities`, `telegram_star_payments`, initData replay log | `backend` migrations | The repo that writes the table owns it (migration-safety rule) |
| `telegram_*_settings` singletons, product overrides, notification templates | `wingobingiadminapi` migrations | Admin-managed config, same as `riverpe_settings`; the Player API reads them |
| Admin → Telegram pages | `wingibingoadminpanel` | New `telegram` menu and permission keys |
| Mini App | new repo `wingobingo-telegram` | Separate client |

## 3. Mini App client

- **Stack:** Vite + React + TypeScript, built to static files and served by nginx in Docker.
  Next.js server features are not needed, and a static SPA keeps the bundle and cold start
  small for Telegram's WebView.
- **Telegram SDK:** the official `telegram-web-app.js`. Wrapped so that optional calls (haptics,
  cloud storage, theme) can fail without breaking auth, play or payment.
- **Data:** TanStack Query against the Player API, with the same request shape as
  `WingoBingo/src/app/api/apiRequest.ts` (POST, raw `Authorization`, `metadata.currency`).
- **Resume:** on Telegram `activated` / `visibilitychange`, refetch the balance, the open game
  and any pending payment. Never trust cached money or game state after a resume.
- **Brand and RTL:** WingoBingo tokens from `WingoBingo/src/app/globals.css` (`--home-*`,
  accent `#f7941d`), Vazirmatn for fa/ar and Roboto otherwise, logo assets from
  `WingoBingo/public`. Logical CSS properties only; `dir="ltr"` only on numbers, clocks and codes.
- **i18n:** en / ar / fa / fr, with `t("English text")` keys like the site. Native-tone copy comes
  from `scripts/i18n-native-translate.mjs`, the same script as in the other repos.

## 4. Authentication and linking

Telegram is a second identity on an existing email account. Never a separate user.

1. The Mini App sends raw `Telegram.WebApp.initData` to `POST /auth/telegram/session`.
2. The Player API validates it:
   - HMAC-SHA256 with `secret = HMAC_SHA256("WebAppData", bot_token)`, compared in constant time;
   - `auth_date` within the configured maximum age;
   - bot id and `start_param` taken from the signed data only;
   - the `initData` hash recorded as used, so a hash can mint a session once (replay protection).
   `initDataUnsafe` is never read on the server.
3. **Linked identity:** mint a session exactly like `/user/login` and return `userAuth`.
4. **Not linked:** return `link_required` plus a short-lived, single-use link ticket. The
   ticket is server-stored and bound to the Telegram user id.
5. The player logs in with email and password (existing `/user/login`, with the website's
   reCAPTCHA v3, or the image captcha when no site key is set) or
   registers (existing `/user/register`, then login). Then `POST /auth/telegram/link`
   `{linkTicket}` with that session links the two identities.
6. Linking refuses:
   - a Telegram id already linked to another account;
   - an account already linked to another Telegram id, unless the relink policy allows it.
   Every link, unlink and refusal is recorded.
7. **Sessions:** Telegram-minted sessions get their own `sessionType`, with an enforced maximum
   age and a logout endpoint. Today player sessions never expire.
8. There is no mock or bypass mode. A development bot uses its own token, never a fake check.

## 5. Telegram Stars

### Flow

1. The Mini App asks `POST /payments/telegram-stars/quote` for a product id (wallet top-up amount,
   or a ticket purchase).
2. The server checks everything before showing a price:
   - a valid Telegram-minted session (Stars are refused for web sessions);
   - global, environment and product flags;
   - country rules;
   - account status.
   It then prices the product (section 6) and stores a quote.
3. `POST /payments/telegram-stars/invoice` `{quoteId}`:
   - creates a `v2_payments` row (`type: telegram_stars`, status `created`);
   - writes a `telegram_star_payments` row with the quote frozen into it;
   - calls `createInvoiceLink` (currency `XTR`, empty provider token), with a payload equal to
     the payment id.
4. The Mini App calls `Telegram.WebApp.openInvoice(link)`. The callback only triggers a refetch;
   it is never treated as proof of payment.
5. **Pre-checkout query (bot webhook):**
   - check that the payload matches a live quote, the amount and currency match, the quote has
     not expired, and the user is still allowed to pay;
   - answer within Telegram's time limit.
6. **Successful payment (bot webhook):**
   - match `telegram_payment_charge_id` and the payload;
   - insert it under a unique constraint, so a duplicate webhook is a no-op;
   - credit through `PaymentService._creditDepositOnce` (status compare-and-set plus the
     `balanceCredited` flag), the same path card deposits use.
7. **Refunds:** an admin action with the Stars Refund permission calls `refundStarPayment`,
   reverses the ledger entry and writes an audit record.

### What is stored with every Stars payment

- Star amount and the quote id.
- Base price and currency.
- Gross value per Star, settlement loss, safety margin, rounding strategy and increment.
- Rate source and rate timestamp.
- Expected gross, expected net and the settings version.
- Telegram user id and charge id.
- Later: settled revenue for reconciliation.

Historical rows never recompute from current settings.

## 6. Stars pricing engine

- **Location:** a pure module in `backend`. It reads no clock or database itself; settings are
  passed in.
- **Formula:**

  ```
  required_net     = base_price × (1 + safety_margin)
  gross_multiplier = 1 / (1 − settlement_loss)          settlement_loss < 1
  required_gross   = required_net × gross_multiplier
  stars_raw        = required_gross / gross_value_per_star
  stars            = round(stars_raw, strategy, increment), then clamp to min/max
  expected_net     = stars × gross_value_per_star × (1 − settlement_loss)
  ```

  Example: $10 at 30% loss gives a required gross of 14.285714 (not 13). The effective markup is
  42.86%.
- **Rounding:** up (default), down, nearest, up to 5, up to 10, or a custom increment.
  - Any result whose expected net falls below `base_price` is flagged.
  - Such a result is refused unless the product explicitly allows it.
- **Naming trap:**
  - The brief calls the Star value both "net value per Star" and "accounting value".
  - The engine uses **gross** value per Star and applies the loss once.
  - If an admin enters a value that is already net of Telegram's cut, the loss must be 0.
  - The admin preview says this in plain words.
- **Precision:** integer micro-units for money and exact rounding. No float drift.
- **Product overrides** (validity window, enabled, custom loss, fixed Stars amount, min/max,
  campaign price) are resolved server-side. The client sends only a product id.

## 7. Admin → Telegram

**Built so far (DEV-111):**

- **Pages:** Overview, Linked Accounts, Sign-in Activity, Sign-in Settings and Bot, plus a
  Telegram tab on the player dossier.
- **Permission:** one `telegram` module. Unlinking also accepts `users`. The module is not in
  any role preset, so only admins see it until a role is granted it.
- **Admin API routes:** `/telegram-admin/*`. Bot reads and writes, and unlinking, go to the
  Player API's `/internal/telegram/*` with `X-Internal-Key` (`PLAYER_API_INTERNAL_KEY`).
- **Audit:** `admin_logs` type 25 is "Telegram unlinked" and type 26 is "Telegram settings
  changed". Both appear on the dossier's admin log. The `telegram_config_audit` table below is
  still planned for the Stars work.
- **Bot token:** the bot card shows only whether it is set, never any part of it.
- **Not built yet:** TOTP step-up for bot changes.

**Planned:**

- **Pages:** Overview, Bot Settings, Mini App Settings, Authentication, Stars (General, Pricing
  with live preview, Products, Profitability), Notifications (events and templates),
  Referrals, Collectibles, Security, Logs.
- **Permissions** (added to `PERMISSION_CATALOG` in both the API and the panel):
  - `telegram`, `telegram.manage`
  - `telegram.stars`, `telegram.stars.pricing`, `telegram.stars.refund`
  - `telegram.bot`, `telegram.notifications`, `telegram.security`
  Nested keys follow `permissionCovers`.
- **Step-up for critical changes:** Stars pricing, bot settings and refunds need a fresh admin
  TOTP code (`verifyTotpCode` exists; a step-up guard is new).
- **Audit:** a new `telegram_config_audit` table. It records admin, timestamp, setting, previous
  and new value (secrets redacted), IP, user agent and correlation id. Today `admin_logs` has no
  before/after or correlation fields, and its type 20 is already used for two different things.
- **Bot token:** stays in the Player API env. The admin page shows only "configured" and the
  last 4 characters, fetched via an internal endpoint. Changing it is a deploy step, not a form
  field. The brief prefers secret references over database storage.

## 8. Notifications

- **There is no event bus today.** Events are produced inline:
  - lotto status changes in `cron/lotto_drawn.ts`;
  - win settlement in `lottoSettlement.service.ts`;
  - withdraw status in `financialAdmin.service.ts`;
  - deposit credit in `backend` `_creditDepositOnce`;
  - reminders in `game_reminder_processor`.
- **Plan:** one `notifyTelegram(userId, event, vars)` helper per API.
  - It checks the event toggle, the user's link and preferences.
  - It renders an admin-edited template (variables substituted and escaped, no code execution).
  - It sends through the Player API's bot client.
  - It records the send in `user_communications` with a new `telegram` channel.
  - It is fire-and-forget and never blocks the business action.

## 9. Open decisions (owner)

| # | Decision | Why it matters | Recommendation |
|---|---|---|---|
| D1 | **Can Stars fund real-money play at all?** Telegram's Stars and bot payment terms, and Apple and Google rules for in-app currency, must allow Stars for gaming deposits | Legal and platform risk; a ban would take down the bot | Legal sign-off before Stars goes live; build behind a flag that defaults off |
| D2 | **Can Stars-funded balance be withdrawn as USDT?** | Paying out crypto for Stars turns Stars into cash, an AML and laundering channel and a likely policy breach | Credit Stars to non-withdrawable balance (or ticket purchases only) |
| D3 | Gross value per Star and settlement loss starting values | Pricing correctness | Admin-entered; no defaults shipped |
| D4 | Mini App repo host and domain | Needed to create the repo, BotFather settings and CORS | **Decided:** repo `wingobingotv/tg`, address `https://tg.wingobingo.tv` (host nginx site `deploy/nginx/tg.wingobingo.tv`). The Player API allows any origin, so no CORS change |
| D5 | **Compliance scope.** The site has no KYC flow, limits, self-exclusion, age or geo checks | The brief assumes they exist. Building them for Telegram only would make Telegram stricter than web; building them platform-wide changes the website | Shared server-side gate in `backend`, rolled out deliberately |
| D6 | Collectibles / NFT: ship now (flag off) or after launch | Scope | After the core launch |
| D7 | Admin Panel i18n: the panel is English-only with no i18n mechanism | Workspace rule asks for 4 languages | Treat the panel as exempt, as today |
