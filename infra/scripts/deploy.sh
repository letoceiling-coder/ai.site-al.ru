#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/var/www/ai.site-al.ru"
APP_PORT="3006"
SERVICE_NAME="ai-site-al-ru"

echo "[1/8] Ensuring project directory exists"
mkdir -p "${PROJECT_DIR}"
cd "${PROJECT_DIR}"

echo "[2/8] Fetching latest code"
git fetch --all
git pull --ff-only origin main

echo "[3/8] Installing dependencies"
npm install

echo "[4/8] Running quality gates"
npm run typecheck
npm run build

echo "[5/8] Prisma generate and migrate"
npm run db:generate
npm run db:migrate

echo "[6/8] Restarting application"
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete "${SERVICE_NAME}" || true
  pm2 start npm --name "${SERVICE_NAME}" -- run start -w apps/web
else
  nohup npm run start -w apps/web -- --port "${APP_PORT}" >/var/log/ai-site-al-ru.log 2>&1 &
fi

echo "[7/8] Nginx safety checks"
nginx -t
systemctl reload nginx

echo "[8/8] Deploy complete"
