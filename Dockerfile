# syntax=docker/dockerfile:1
FROM node:22.19.0-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Native-tone ar/fa/fr translations (OpenAI). Cached across builds by English
# text. Never fails the build: no key or an OpenAI error keeps the committed
# translations. The key only exists in this stage, not in the final image.
ARG OPENAI_API_KEY=""
ARG OPENAI_TRANSLATE_MODEL=""
RUN --mount=type=cache,id=wingobingo-telegram-i18n-native,target=/i18n-cache \
    I18N_CACHE_DIR=/i18n-cache node scripts/i18n-native-translate.mjs --build

# Same gate as a local commit: lint and tests must pass before an image exists.
RUN npm run lint && npm test && npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=0755 deploy/nginx/05-runtime-config.envsh /docker-entrypoint.d/05-runtime-config.envsh
EXPOSE 8080
