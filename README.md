# WingoBingo Telegram Mini App

A second client of the WingoBingo Player API, opened from the WingoBingo bot inside Telegram.
Email stays the primary identity, and a Telegram account is linked to it once.

- Stack: React 19, Vite 6, TanStack Query, i18next (en / ar / fa / fr, RTL for ar and fa).
- Deploy: `docker compose up -d --build`. All settings are in `.env`; see
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- Sign-in and linking: [docs/TELEGRAM_AUTH.md](docs/TELEGRAM_AUTH.md).
- Scope and web parity: [docs/FEATURE_PARITY_MATRIX.md](docs/FEATURE_PARITY_MATRIX.md),
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Checks

```bash
npm ci
npm run lint
npm run typecheck
npm test
```

The app is not run locally: it needs Telegram's signed `initData` and the Player API. The
Docker build runs the same lint and tests.

## Layout

| Path | What |
|---|---|
| `src/auth/` | Telegram sign-in (`useTelegramAuth`), state mapping (`authFlow`), link screen |
| `src/screens/` | Home (wallet, Wingo, Bingo), Profile, full-screen states |
| `src/api.ts` | Player API client, with the same conventions as the website |
| `src/config.ts` | Validates `window.__WINGOBINGO_CONFIG__`, written from `.env` at container start |
| `locales/<lang>/translation.json` | Copy keyed by English text; ar/fa/fr are refined at build time by `scripts/i18n-native-translate.mjs` |
| `deploy/nginx/` | Container-start config script and nginx template |
