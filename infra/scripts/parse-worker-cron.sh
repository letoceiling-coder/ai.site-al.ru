#!/usr/bin/env bash
# Cron-воркер извлечения текста из «тяжёлых» файлов (PDF/DOCX/>1 MB).
# Запускать каждые 1–2 минуты. Использует PARSE_WORKER_SECRET из корневого .env,
# либо EMBEDDING_WORKER_SECRET как fallback (Next.js принимает оба заголовка).
set -euo pipefail
ROOT="${AI_SITE_AL_ROOT:-/var/www/ai.site-al.ru}"
ENV_FILE="$ROOT/.env"
LOG="${PARSE_WORKER_LOG:-/var/log/ai-site-al-parse-worker.log}"
PORT="${AI_SITE_AL_PORT:-3006}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$(date -Is) no .env at $ENV_FILE" >>"$LOG"
  exit 0
fi

SECRET=""
if grep -q '^PARSE_WORKER_SECRET=' "$ENV_FILE"; then
  SECRET="$(grep -E '^PARSE_WORKER_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
elif grep -q '^EMBEDDING_WORKER_SECRET=' "$ENV_FILE"; then
  SECRET="$(grep -E '^EMBEDDING_WORKER_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
fi
SECRET="${SECRET%$'\r'}"
if [[ -z "$SECRET" ]]; then
  echo "$(date -Is) no worker secret in $ENV_FILE, skip" >>"$LOG"
  exit 0
fi

code="$(curl -sS -m 120 -o /tmp/ai-parse-worker.out -w '%{http_code}' -X POST \
  -H "x-parse-worker-secret: ${SECRET}" \
  "http://127.0.0.1:${PORT}/api/knowledge/parse/worker" || true)"
echo "$(date -Is) http=$code $(head -c 200 /tmp/ai-parse-worker.out 2>/dev/null | tr '\n' ' ')" >>"$LOG"
