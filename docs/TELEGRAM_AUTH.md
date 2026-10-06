# Telegram Mini App — Authentication and account linking

Status: **built in the Player API** (`backend` `a9f3580`, Admin API `ffa0f63`, DEV-108).
Sign-in is off until `TELEGRAM_BOT_TOKEN` is set in the backend `.env`.

## Rules

- Email stays the primary identity. A Telegram account is linked to an existing account;
  it never creates a separate user.
- Only the raw `Telegram.WebApp.initData` string is sent to the server.
  `initDataUnsafe` is never used for identity.
- There is no mock, test or bypass mode. Without a valid bot token every request answers
  `telegram_not_configured`.

## Endpoints (Player API, all POST)

| Endpoint | Auth | Body | Success response |
|---|---|---|---|
| `/auth/telegram/session` | none (guest endpoint) | `{ initData }` | `status: "linked"`, `userAuth`, `sessionExpiresAt`, `startParam`; or `status: "link_required"`, `linkTicket`, `linkTicketExpiresAt`, `telegramUser { firstName, username }`, `startParam` |
| `/auth/telegram/link` | fresh email-login session | `{ linkTicket }` | `userAuth` (new Telegram session), `sessionExpiresAt`, `startParam` |
| `/auth/telegram/connect-code` | fresh website session (e.g. right after Google sign-in) | — | `code` (`ABCD-EFGH`), `expiresAt`, `openUrl` (t.me link with `startapp=lk_<code>`, or null) |
| `/auth/telegram/connect` | none (guest endpoint) | `{ linkTicket, code, confirm }` | without `confirm`: `status: "confirm"`, `account { maskedEmail }`; with `confirm: true`: `status: "linked"`, `userAuth`, `sessionExpiresAt`, `startParam` |
| `/auth/telegram/unlink` | any player session | — | `message: telegram_unlinked` or `telegram_not_linked` |
| `/auth/telegram/status` | any player session | — | `linked`, `identity { telegramUserId, username, firstName, linkedAt }` |
| `/user/logout` | any player session | — | ends the session in `Authorization` |

Failures come back as `{ success: false, message: <code> }`, like `/user/login`:

| Code | Meaning | Mini App action |
|---|---|---|
| `telegram_not_configured` | No bot token on the server | Show "temporarily unavailable" |
| `telegram_auth_disabled` | Switched off in Admin → Telegram → Authentication | Same |
| `invalid_init_data` | Bad signature, other bot, malformed, no user | Ask to reopen from the bot |
| `init_data_expired` | `auth_date` older than the allowed age | Ask to reopen from the bot |
| `init_data_replayed` | This initData already opened a session | Reuse the stored session, or reopen |
| `user_is_banned` | Linked account is banned | Show the account notice |
| `fresh_login_required` | Link called without a recent email login | Log in again, then link |
| `link_ticket_invalid` | Ticket unknown, used or expired | Restart from `/auth/telegram/session` |
| `telegram_already_linked` | This Telegram account belongs to another user | Explain; offer support |
| `account_already_linked` | The account already has another Telegram id | Explain; relink only if enabled |
| `code_invalid` | Connect code unknown, used or expired | Get a new code in the browser |
| `too_many_attempts` | 5 wrong connect codes for this Telegram user within the ticket TTL | Wait, then try again |

## initData check (`src/utils/telegramInitData.js`)

1. Raw string at most 8 KB; any repeated key is rejected.
2. `hash` must be 64 lowercase hex characters.
3. Data-check string: every field except `hash` (including `signature`), sorted by key,
   joined as `key=value` lines.
4. `secret = HMAC_SHA256(key "WebAppData", bot_token)`;
   expected = `hex(HMAC_SHA256(key secret, data_check_string))`; compared in constant time.
5. `auth_date` no more than 60 s in the future and no older than the configured maximum age.
6. `user` must be JSON with a positive integer `id` and not a bot.
7. `start_param`, when present, must match Telegram's alphabet `[A-Za-z0-9_-]{1,512}`.

## Replay protection

Each accepted `hash` is inserted into `telegram_init_data_uses` (primary key). A second use
fails on the unique key and returns `init_data_replayed`. Rows are pruned once older than the
largest allowed age (24 h + 5 min), so raising the setting later cannot reopen old initData.

The Mini App therefore keeps its session token in `sessionStorage` and only calls
`/auth/telegram/session` when it has no working session.

## Linking

1. `/auth/telegram/session` for an unlinked Telegram user stores a link ticket
   (`telegram_link_tickets`, only the SHA-256 of the ticket) with the verified Telegram profile
   and `start_param`. The ticket lives `linkTicketTtlSec` (default 15 min) and works once.
2. The player logs in with the existing `/user/login` (captcha included), or registers with
   `/user/register` and then logs in. The captcha is Google reCAPTCHA v3, set up as on
   wingobingo.tv: same site key (`RECAPTCHA_V3_SITE_KEY` here, `NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY`
   on the website), actions `login` / `register`, a `recaptchaToken` the Player API checks with
   `RECAPTCHA_V3_SECRET` and `RECAPTCHA_V3_MIN_SCORE`. Google's script loads only on this
   screen. With no site key the screen falls back to the image captcha (`/captcha`).
3. `/auth/telegram/link` with that session:
   - the session must be an email session younger than the ticket TTL. An old or stolen web
     session cannot attach someone else's Telegram account;
   - a Telegram id already linked to another account is never moved;
   - an account already linked to a different Telegram id is refused unless `allowRelink` is on.
     With it on, the old link and all of its Telegram sessions are removed first;
   - the ticket is claimed with a compare-and-set inside the transaction, and the unique keys on
     `telegram_identities` settle concurrent attempts.
4. The email session used to prove the account is deleted and an expiring Telegram session
   (`sessions.sessionType = 3`) is returned instead.

## Continue with Google (connect codes)

Google refuses sign-in inside embedded browsers (`disallowed_useragent`), which is what Telegram
opens Mini Apps in, and Google-only accounts have no password. So Google sign-in happens in the
system browser and comes back as a one-time code:

1. The Mini App opens `https://wingobingo.tv/<lang>/connect-telegram` with `openLink`. The URL
   carries nothing secret.
2. The player signs in there with the site's Google button (`/auth/google`).
3. The site calls `/auth/telegram/connect-code` with that fresh session (same freshness rule as
   linking; a Telegram session is refused). The Player API stores the SHA-256 of an 8-character
   code (alphabet without 0/O/1/I/L) in `telegram_connect_codes`, valid 10 minutes and once. A
   new code replaces the account's unused ones. `code_issued` is logged.
4. The site shows the code and, when the bot has `TELEGRAM_MINIAPP_SHORT_NAME` (backend `.env`)
   or a Main Mini App, an "Open Telegram" button: `https://t.me/<bot>[/<app>]?startapp=lk_<code>`.
   The bot username comes from `getMe`, never from the client.
5. The Mini App gets the code from the signed `start_param`, or the player types it.
   `/auth/telegram/connect` without `confirm` answers the account's masked email
   (`r•••@gmail.com`); the player confirms, then the call with `confirm: true` links it with the
   same rules as `/auth/telegram/link`. Ticket and code are claimed in one transaction.

Why the link is made in the Mini App, not on the website: whoever redeems the code has proved
their Telegram account with initData. Someone who forwards their own Mini App link to a victim
gets nothing: the victim's browser never sees a link ticket. The confirm screen covers the
reverse trick (a stranger's "Open Telegram" link would show the stranger's email). Wrong codes are
counted per Telegram user from `link_refused`/`code_invalid` events; after 5 within the ticket TTL
every attempt answers `too_many_attempts`.

## Sessions

- Telegram sessions use `sessionType = 3` and expire after `sessionMaxAgeSec` (default 7 days).
  An expired one is deleted on its next use. Website sessions keep their current behaviour.
- Every request now refuses:
  - sessions of a banned player (`users.isBanned = 1`);
  - Admin API sessions (`sessions.userType = 2`). They share the `sessions` table and used to be
    accepted as a player session of the same numeric id.
- Unlinking ends every Telegram session of the account. Password reset now deletes only player
  sessions; it used to delete the admin sessions of the admin with the same id.

## Settings (`telegram_auth_settings`, singleton id 1, owned by the Admin API)

| Field | Default | Allowed range |
|---|---|---|
| `enabled` | 1 | 0 / 1 |
| `initDataMaxAgeSec` | 600 | 60 – 86 400 |
| `sessionMaxAgeSec` | 604 800 (7 days) | 3 600 – 7 776 000 (90 days) |
| `linkTicketTtlSec` | 900 | 120 – 3 600 |
| `allowRelink` | 0 | 0 / 1 |

The backend caches the row for 30 s, clamps every value to the range above, and falls back to
the defaults if the table is not migrated yet. Admins edit it at Admin → Telegram → Sign-in
Settings. Admin → Telegram → Linked Accounts lists linked players and can unlink one (reason
`admin` in `telegram_auth_events`). Sign-in Activity lists `telegram_auth_events`.

## Audit

`telegram_auth_events` records `session_issued`, `session_refused`, `link_required`, `linked`,
`link_refused`, `unlinked`, `init_data_rejected` and `init_data_replayed`, with reason, Telegram
user id, user id, IP and user agent. Writes are fire-and-forget and never block sign-in.
initData and link tickets are never logged.

## Tests

`backend/src/utils/telegramInitData.test.js`, `src/utils/telegramAuthRules.test.js` and
`src/services/TelegramAuthService.test.js` (the service against an in-memory Prisma stand-in):
signature, foreign bot, tampering, expiry, future dates, malformed input, replay, link ticket
single use, fresh-login rule, no moving a linked Telegram id, relink setting, bans, Telegram
session expiry, admin sessions refused, unlink, status. Run with
`node --test src/utils/*.test.js src/services/*.test.js`.
