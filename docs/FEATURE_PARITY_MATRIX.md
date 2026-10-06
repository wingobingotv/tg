# WingoBingo Telegram Mini App — Feature Parity Matrix

Audit date: 2026-10-06. Source of truth is the code, read in these repos:

| Repo | Branch | Commit | Role |
|---|---|---|---|
| `WingoBingo` | `main` | `97257b93` | Consumer site (Next.js 15, React 19, Tailwind 4) |
| `backend` | `feat/gift-codes` | `e45b78e` | Player API (Express 4, Prisma, MySQL) |
| `wingobingiadminapi` | `feature/cinematic-celebration` | `755f2cc` | Admin API, cron worker, most migrations |
| `wingibingoadminpanel` | `feature/cinematic-celebration` | `c3dd886` | Admin Panel (Next.js 16) |
| `bingo` | `main` | `2a277b1` | Bingo (Daberna) game service (Hapi, Mongo) |

## How to read this

- **Player API call shape.** Every call is `POST <NEXT_PUBLIC_API_BASE_URL><path>` with a JSON
  body, even reads. The session token goes raw in `Authorization` (no `Bearer`). The body
  always carries `metadata.currency`. Source: `WingoBingo/src/app/api/apiRequest.ts`.
- **Site route.** A route the website itself hosts (`WingoBingo/src/app/api/*`), not the
  Player API. The Mini App cannot call these cross-origin today.
- **Status values.**
  - `Reuse`: the Mini App calls the existing API unchanged.
  - `Reuse + backend`: the existing API plus a small backend addition.
  - `New`: no web equivalent; new backend work.
  - `Not on web`: the site does not have it, so there is nothing to match. Listed so the gap is explicit.
  - `Decision`: blocked on an owner decision (see `ARCHITECTURE.md` → Open decisions).

---

## 1. Discovery and games

| Current Web Feature | Existing API/Service | Mini App Implementation | Backend Changes Required | Status | Dependencies |
|---|---|---|---|---|---|
| Home feed: next shows, live bar, latest replay, recent draws and winners | `/wingo/getTournaments` (`type:normal`/`special`), `/bingo/getGames` (4 calls), `/wingo/getWinners`, `/bingo/getWinners`; composed client-side in `WingoBingo/src/utils/home-v2/compose.ts` | Compact home: live-now card, next Wingo, next Bingo, recent winners. Fewer calls than web (one per type, not four Bingo calls) | None | Reuse | Game list endpoints |
| Wingo list (normal and special tournaments) | `/wingo/getTournaments` `{type, page, count, tags?}` | List with countdowns from `drawDate`/`startTime`/`finishTime` | None | Reuse | — |
| Wingo detail, countdown, ticketing state | `/wingo/getTournaments` `{gameId, type?}`; web polls every 30 s while `isTicketingOpen` | Detail screen; poll while open; refetch on Telegram `activated` (resume) | None | Reuse | Resume handling |
| Private Wingo games | `/wingo/unlockPrivateGame` via site route `/api/private-game/unlock` (sets httpOnly cookie `wb_pg_<id>`) | Call `/wingo/unlockPrivateGame` directly; keep the token in memory and send `privateAccessToken` + `x-private-access-token` like `apiRequest.ts` | None (Player API route is Guest) | Reuse | — |
| Draw reminders | `/wingo/getReminder`, `/wingo/setReminder`, `/wingo/cancelReminder`; email sent by Admin API cron `game_reminder_processor` | Same calls; add a Telegram delivery option | Telegram channel in the reminder sender | Reuse + backend | Telegram notifications |
| Number statistics and "others' picks" | `/wingo/getTopChosenNumbers` `{}` or `{tournamentId, days}` | Same | None | Reuse | — |
| Bingo list and daily games | `/bingo/getGames` `{drawType, status, page, count, tags?}`, `/bingo/getQuickPlayGames` | Same | None | Reuse | — |
| Bingo detail | `/getGameDetails` `{gameId, gameType:"Bingo"}` | Same | None | Reuse | — |
| Draw times (results filter) | `/getDrawTimes` `{type, eventType?}` | Same | None | Reuse | — |
| Game rules | Static content `WingoBingo/src/data/more.data.ts` (`wingoRules`, `bingoRules`) | Render the same content; share via build-time copy, not a second source | None | Reuse | Content sharing decision |

## 2. Buying tickets

| Current Web Feature | Existing API/Service | Mini App Implementation | Backend Changes Required | Status | Dependencies |
|---|---|---|---|---|---|
| Wingo manual pick | Client rules: 6 numbers of 1–47, 1 lucky of 1–10, max 14 tickets (`ChooseTicket/index.tsx`, `ticketing-b/types.ts`); `POST /wingo/setTickets` `{tournamentId, tickets:[{numbers, chanceNumber}], giftCode?}` | Touch number grid | **Expose the ranges and per-user limit in the game payload.** They are hardcoded in the web client today, and the brief forbids hardcoding them | Reuse + backend | Game config fields |
| Quick Pick | Client-only shuffle `WingoBingo/src/utils/wingo.utils.ts` `getUniqueRandomNumbers` | Same client logic, using server-provided ranges | None beyond the row above | Reuse | Game config fields |
| Multiple tickets, duplicate prevention | Client `src/utils/wingoTicketCombo.ts`; server `backend/src/utils/wingoTicketCombo.js` | Same | None | Reuse | — |
| Ticketing modes A/B/C/D | `ticketingMode` on the game; four web UIs | One mobile flow that honours the mode's rules (not four UIs) | None | Reuse | — |
| Free tickets | `freeTicketCount`/`freeTicketsRemaining` on the game; applied inside `setTickets` (`game_free_ticket_config/usage`) | Show allowance; server applies it | None | Reuse | — |
| Gift or discount code at checkout | `/gift-codes/preview`; `giftCode` on `setTickets` | Same | None | Reuse | — |
| Insufficient balance | `setTickets` returns `code 4501` | Offer top-up (existing methods, plus Stars where allowed) | None | Reuse | Wallet |
| Pay with card or crypto inside checkout | `TicketCheckoutModal`: Card (`/initPayment` mastercard → external gateway page), Crypto, Voucher | Crypto and Voucher in-app; card opens the gateway with `Telegram.WebApp.openLink` and resumes by polling `/getPayment` | Gateway return URL for the Mini App | Reuse + backend | Payment return design |
| Bingo card choice and Quick Pick | `/bingo/getGameCardsById` `{gameId, cardModelId, choiceType}`; client picks randomly | Same | None | Reuse | — |
| Bingo purchase | `POST /bingo/setTickets` `{gameId, tickets, giftCode?}` → `GameService.setBingoTickets` | Same | See security review: cards are assigned in the Bingo service before the MySQL charge, with no release on failure (UNVERIFIED) | Reuse | — |
| Concurrent or duplicate purchase | Server transaction in `setTickets`; web resume store `pendingPurchase` | Disable the button while in flight; one client request id per purchase | Server idempotency key on `setTickets` (none today) | Reuse + backend | — |

## 3. My games, results, winners, live

| Current Web Feature | Existing API/Service | Mini App Implementation | Backend Changes Required | Status | Dependencies |
|---|---|---|---|---|---|
| My Rounds (Wingo / Bingo tabs) | `/getMyGames` `{page, count, status, type}` | Same | None | Reuse | — |
| My tickets per game | `/wingo/getTickets` `{tournamentId, isPaid:true}`, `/bingo/getTickets` `{gameId}` | Same; outcome via the same logic as `wingoTicketOutcome.ts` | None | Reuse | — |
| Bingo results, drawn balls, line and full-house marking | `/bingo/getGameResults`, `/getGameDetails`; marking done client-side (`TicketsList.tsx`) | Same, server data only | None | Reuse | — |
| Winners and results | `/wingo/getWinners`, `/bingo/getWinners`, `/getGameDetails` | Same | None | Reuse | — |
| Live show (video) | LiveKit; token from **site route** `/api/token`; room from **site route** `/api/livekit/active-room`; rooms `wingo-N` / `bingo-X` via `showRoom` | Viewer in Telegram WebView | **Viewer token and active-room lookup must move to the Player API** (or be exposed from the site with CORS). The Mini App never mints tokens itself | Reuse + backend | LiveKit keys server-side; `showRoom` module |
| Live data overlays (numbers, winners, awards) | LiveKit data messages (`winner-bubble`, `numbers-history`, `draw-finalized`, …) | Same handlers | None | Reuse | — |
| Live chat | `/live-chat/messages` (2 s poll), `/live-chat/send`, `/live-chat/like` | Same | None | Reuse | — |
| Replays | `/getGameDetails` (`recordingUrl`), Bingo replay page | Same | None | Reuse | — |

## 4. Account and identity

| Current Web Feature | Existing API/Service | Mini App Implementation | Backend Changes Required | Status | Dependencies |
|---|---|---|---|---|---|
| Login (email or username + password) | `/user/login` `{login, password, type:"1", recaptchaToken}` → `userAuth`; captcha required server-side (`AuthController.verifyCaptchaProof`) | Used **once**, to prove ownership before linking Telegram | None for login itself | Reuse | reCAPTCHA site key must allow the Mini App domain |
| Google sign-in | `/auth/google` `{idToken, recaptchaToken}` | Google One Tap inside Telegram WebView is unreliable; offer email login | None | Decision | — |
| Registration | `/user/register` (captcha, referral fields); returns no session; site logs in afterwards | Same, then login, then link | None | Reuse | Referral deep link |
| Email verification | None as a flow (`emailVerifiedAt` set by Google login and withdraw OTP only) | — | If "require email link" means verified email, a verification flow is new work | Not on web | Decision |
| Password recovery | `/auth/forgot-password/request`, `/auth/forgot-password/verify` | Same | None | Reuse | — |
| Telegram auto-login | — | Validate `initData` server-side, then mint a normal session for the linked user | New `/auth/telegram/*` endpoints, `telegram_identities` table | New | Bot token in backend env |
| Profile, avatar, mobile, country | `/getUser`, `/updateUser`, `/uploadAvatar`, `/user/setMobileNumber`, `/user/setCountry`, `GET /avatar/:id` | Same | None | Reuse | — |
| Logout | Client only (cookie delete); no server route | Server-side session revoke | Logout endpoint (sessions never expire today) | Reuse + backend | — |
| KYC | **No KYC upload or status UI on web.** Tables `user_nationalcards`, `user_cards`, `user_mobilenumbers` reviewed in Admin API only | Show status read-only if a player endpoint is added | Player KYC status endpoint | Not on web | Decision |
| 2FA for players | None (TOTP exists for admins only) | — | — | Not on web | — |

## 5. Wallet and payments

| Current Web Feature | Existing API/Service | Mini App Implementation | Backend Changes Required | Status | Dependencies |
|---|---|---|---|---|---|
| Balance (cash, bonus, wagering) | `/getWalletBalance` | Same; refetch on resume and after every payment | None | Reuse | — |
| Display currency | `/convertCurrency`; `currency` from `/getUser` | Same | None | Reuse | — |
| Card deposit (Riverpe / IR gateway / Remitation) | `/getRiverpeDepositOptions`, `/initPayment` `{type:"mastercard"}` → external `paymentLink`, `/getPayment` | `openLink` to the gateway; poll `/getPayment` on return | Return URL that lands back in Telegram | Reuse + backend | Payment return design |
| Crypto deposit | `/getCryptocurrencies`, `/getCryptoMinAllowedAmount`, `/initPayment` `{type:"crypto"}`, `/getPayment` (15 s poll) | Same | None | Reuse | — |
| Voucher (Utopia) | `/utopia/activate` | Same | None | Reuse | — |
| Gift code redeem | `/gift-codes/redeem`, `/gift-codes/preview` | Same | None | Reuse | — |
| Saved payment details | `/getSavedPaymentDetails`, `/deleteSavedPaymentDetails` | Same | None | Reuse | — |
| Withdrawal (TRON USDT) | `/getWallets`, `/createWallet`, `/getGasFee`, `/withdraw/request-otp`, `/createWithdraw`, `/getWithdraws` | Same, with the email OTP | None | Reuse | — |
| Transaction history | `/getTransactionHistory`, `/getWithdraws` | Same; Stars rows labelled by provider | Provider label for `telegram_stars` | Reuse + backend | Stars provider |
| Bonuses | `bonusBalance` / `outstandingWagering` on the wallet; no bonus page | Same | None | Reuse | — |
| **Telegram Stars** | — | Telegram-only payment method (`openInvoice`) | New provider, pricing engine, webhook, ledger tables | New | Decisions D1–D3 |

## 6. Referrals

| Current Web Feature | Existing API/Service | Mini App Implementation | Backend Changes Required | Status | Dependencies |
|---|---|---|---|---|---|
| Referral capture at sign-up | URL `?ref=` / `?iref=` → `wb_referral_preset` → `/user/register` `referralCode` / `influencerReferralCode` | Bot deep link `t.me/<bot>?start=ref_<CODE>` or Mini App `startapp=ref_<CODE>`; server keeps the code with the pending link | Read the code from the validated `start_param` server-side; pass it to the existing registration | Reuse + backend | Auth link flow |
| Validate code | `/referrals/validate`, `/influencer-referrals/validate` | Same | None | Reuse | — |
| Invite & Earn panel | `/referrals/me`, `/referrals/myReferrals`, `/referrals/apply` | Same; share via Telegram `switchInlineQuery` / share link | Telegram share link format | Reuse | — |

## 7. Support, notices, notifications

| Current Web Feature | Existing API/Service | Mini App Implementation | Backend Changes Required | Status | Dependencies |
|---|---|---|---|---|---|
| Account notices and appeal | `/account-notices/list`, `/read`, `/appeal` | Same | None | Reuse | — |
| Support AI chat and tickets | `/support/welcome`, `/support/chat`, `/support/tickets/*` | Same | None | Reuse | — |
| In-app notifications | `user_communications` (channels `email`, `in_app`) | Telegram bot messages as a new channel | Telegram sender, templates, per-event toggles | New | Notification design |
| Push | None | Telegram messages replace push | — | Not on web | — |
| Business events (ticket purchased, deposit confirmed, user won) | **No notification is sent for these today.** Win settlement in Admin API `lottoSettlement.service.ts`; deposit credit in `backend` `PaymentService._creditDepositOnce` | Telegram messages | New emit points in both services (no event bus exists) | New | — |
| Unsubscribe | `panel.api.wingobingo.tv/marketing/unsubscribe` | Telegram notification preferences screen | Telegram preferences per user | New | — |

## 8. Compliance and legal

| Current Web Feature | Existing API/Service | Mini App Implementation | Backend Changes Required | Status | Dependencies |
|---|---|---|---|---|---|
| Terms, Privacy, AML, KYC, Refund, Responsible Gambling pages | Static `WingoBingo/content/legal/{lang}/*.json` | Same content (shared source) | None | Reuse | Content sharing decision |
| Account ban | Checked at login only; **not** checked on authenticated requests (`AuthMiddleware.authenticate`) | Inherits the gap | Check `isBanned` on authenticated requests (fixes web too) | Decision | Owner approval |
| Self-exclusion, deposit and betting limits | **None** | — | New shared compliance gate if wanted | Not on web | Decision D5 |
| Age verification | Text-only "18+" | — | — | Not on web | Decision D5 |
| Restricted jurisdictions | Not enforced (country only routes payment rails) | Stars availability by country (brief requirement) | Country rules for Stars; optional platform-wide gate | New | Decision D5 |
| AML screening | Admin-side security cases only | — | — | Not on web | — |

## 9. Telegram-only

| Feature | Mini App Implementation | Backend Changes Required | Status | Dependencies |
|---|---|---|---|---|
| Bot (`/start`, menu button, deep links) | Bot opens the Mini App | Bot webhook in `backend` | New | Bot token, domain |
| Admin → Telegram (Overview, Bot, Mini App, Auth, Stars, Notifications, Referrals, Collectibles, Security, Logs) | — | Admin API routes, settings tables, `telegram` permission keys, audit log | New | RBAC, audit design |
| Stars pricing engine and profitability dashboard | — | Pure engine in `backend`; Admin preview via internal endpoint | New | D1–D3 |
| Collectibles / NFT | Feature-flagged, off | Ownership verification provider | New (deferred) | D6 |

---

## Summary

- **Most player features are `Reuse`.** The Player API already serves them.
- **Real backend work:**
  - Telegram identity and sessions
  - the Stars provider and pricing engine
  - the Telegram bot webhook
  - Telegram notifications
  - moving LiveKit viewer tokens into the Player API
  - exposing the Wingo number rules in the game payload
  - the Admin → Telegram section
- **Things the web does not have**, so there is nothing to match: KYC, responsible-gaming limits,
  self-exclusion, age checks, geo-blocking, push. The brief's compliance rules assume these exist.
  See decision D5.
