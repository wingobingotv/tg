#!/bin/bash
# One-command deploy for wingobingo-telegram (the Telegram Mini App).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "Missing .env — copy .env.example to .env and fill it in." >&2
  exit 1
fi

echo "=== wingobingo-telegram: build & start ==="
docker compose up -d --build --remove-orphans

echo "=== Done. ==="
docker compose ps
