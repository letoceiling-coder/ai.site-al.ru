#!/usr/bin/env bash
# Вызывайте из cron (раз в 1–5 минут). Читает EMBEDDING_WORKER_SECRET из .env проекта.
set -euo pipefail
ROOT="${AI_SITE_AL_ROOT:-/var/www/ai.site-al.ru}"
ENV_FILE="$ROOT/.env"
LOG="${EMBEDDING_WORKER_LOG:-/var/log/ai-site-al-embedding-worker.log}"
PORT="${AI_SITE_AL_PORT:-3006}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$(date -Is) no .env at $ENV_FILE" >>"$LOG"
  exit 0
fi

if ! grep -q '^EMBEDDING_WORKER_SECRET=' "$ENV_FILE"; then
  echo "$(date -Is) EMBEDDING_WORKER_SECRET not set, skip" >>"$LOG"
  exit 0
fi

SECRET="$(grep -E '^EMBEDDING_WORKER_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
SECRET="${SECRET%$'\r'}"
if [[ -z "$SECRET" ]]; then
  echo "$(date -Is) empty secret, skip" >>"$LOG"
  exit 0
fi

code="$(curl -sS -m 120 -o /tmp/ai-emb-worker.out -w '%{http_code}' -X POST \
  -H "x-embedding-worker-secret: ${SECRET}" \
  "http://127.0.0.1:${PORT}/api/knowledge/embeddings/worker" || true)"
echo "$(date -Is) http=$code $(head -c 200 /tmp/ai-emb-worker.out 2>/dev/null | tr '\n' ' ')" >>"$LOG"
