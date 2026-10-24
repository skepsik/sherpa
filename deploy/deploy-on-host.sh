#!/usr/bin/env bash
# Выкат бота на хосте репо: docker compose (канал на адресе SHERPA_CHANNEL_PUBLISH_HOST).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "нет .env в $ROOT" >&2
  exit 1
fi

publish_host="$(sed -n 's/^SHERPA_CHANNEL_PUBLISH_HOST=//p' .env | tail -n1)"
if [[ -z "$publish_host" ]]; then
  echo "нет SHERPA_CHANNEL_PUBLISH_HOST в $ROOT/.env" >&2
  exit 1
fi

docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f
echo "OK: channel ws://${publish_host}:8787/v1/channel"
