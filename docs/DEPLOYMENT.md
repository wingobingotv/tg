# Telegram Mini App — Deployment

One command, like every other WingoBingo repo:

```bash
docker compose up -d --build        # or ./scripts/docker-deploy.sh
```

All settings come from `.env` next to `docker-compose.yml`. Copy `.env.example` and fill it in.
`.env` is git-ignored and never baked into the image.

## What the container does

- **Build stage (Node):**
  1. `npm ci`;
  2. native-tone translations (`scripts/i18n-native-translate.mjs --build`, OpenAI, never fails);
  3. `npm run lint`, `npm test` and `npm run build`. A lint or test failure stops the build.
- **Runtime stage (`nginx-unprivileged`, port 8080, non-root):**
  1. `deploy/nginx/05-runtime-config.envsh` validates `.env` and writes `/config.js`.
     It also derives the API and telemetry origins for the Content-Security-Policy.
     A bad value stops the container and logs the reason: `docker compose logs miniapp`.
  2. nginx renders `deploy/nginx/default.conf.template` and serves the static app.
  3. It also serves `/healthz` and `/config.js`. `index.html` and `/config.js` are never cached.

Changing a value in `.env` needs only `docker compose up -d` (a restart), not a rebuild. The two
`OPENAI_*` values are the exception: they are used only at build time.

`docker-compose.yml` passes the runtime variables one by one (`environment:`), not the whole
`.env` file, so `OPENAI_API_KEY` never reaches the running container. A new runtime variable
needs a line there too. Any value that spans more than one line is refused at start.

## `.env`

| Variable | Required | Example | Used for |
|---|---|---|---|
| `MINIAPP_BIND` | no | `127.0.0.1` | Host address the port is published on |
| `MINIAPP_PORT` | no | `7400` | Host port |
| `PLAYER_API_URL` | yes | `https://v2.api.wingobingo.tv` | Same Player API as the website |
| `SITE_URL` | yes | `https://wingobingo.tv` | Links out of Telegram |
| `TELEGRAM_BOT_USERNAME` | yes | `WingoBingoBot` | Share and referral deep links |
| `TELEGRAM_MINIAPP_SHORT_NAME` | no | `play` | `t.me/<bot>/<app>` links |
| `DEFAULT_LANG` | no | `en` | Fallback language (`en`, `ar`, `fa`, `fr`) |
| `DEBUG_TELEMETRY_URL` / `DEBUG_TELEMETRY_KEY` | no | — | Live Debug ingest. The website uses the same pair |
| `OPENAI_API_KEY` / `OPENAI_TRANSLATE_MODEL` | no | — | Build-time translations |

The **bot token is not in this repo**. It is `TELEGRAM_BOT_TOKEN` in the Player API (`backend`)
`.env`; only the server ever sees it.

## Server setup (once)

1. **DNS and TLS.** The Mini App address is **`https://tg.wingobingo.tv`**. Point a DNS `A`
   record for `tg.wingobingo.tv` at the server. Then install the host nginx site and add TLS,
   like the other sites:

   ```bash
   sudo cp deploy/nginx/tg.wingobingo.tv /etc/nginx/sites-available/tg.wingobingo.tv
   sudo ln -s /etc/nginx/sites-available/tg.wingobingo.tv /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d tg.wingobingo.tv
   ```

   The site proxies to `127.0.0.1:7400`. If you change `MINIAPP_PORT` in `.env`, change it in
   the site file too.

2. **BotFather:**
   - `/newapp` (or Bot Settings → Configure Mini App) with the Mini App URL
     `https://tg.wingobingo.tv/`, and pick the short name for `TELEGRAM_MINIAPP_SHORT_NAME`;
   - optionally set the menu button to open the same URL.
3. **Player API:** set `TELEGRAM_BOT_TOKEN` in `backend/.env`, then
   `docker compose up -d --build` there. Until then sign-in answers `telegram_not_configured`.
4. **This repo:** `cp .env.example .env`, fill it in, then `docker compose up -d --build`.

## Checks after deploy

- `curl -fsS http://127.0.0.1:7400/healthz` prints `ok`.
- `curl -fsS https://tg.wingobingo.tv/config.js` shows the configured values.
- Open the bot in Telegram and launch the Mini App. The Player API's `telegram_auth_events`
  table gets a `link_required` or `session_issued` row.
