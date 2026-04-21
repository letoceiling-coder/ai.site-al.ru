#!/usr/bin/env bash
set -eu
P="/var/www/ai.site-al.ru"
T="/var/www/ai-site-al-ru-tmp-$(date +%s)"
echo "[0] Backup .env if present"
if [[ -f "$P/.env" ]]; then
  cp -a "$P/.env" /root/ai-site-al-ru.env.bak
fi
echo "[1] Clone latest main (no git in old tree)"
rm -rf "$T"
git clone --depth 1 "https://github.com/letoceiling-coder/ai.site-al.ru.git" "$T"
if [[ -f /root/ai-site-al-ru.env.bak ]]; then
  cp -a /root/ai-site-al-ru.env.bak "$T/.env"
fi
echo "[2] Replace app directory"
rm -rf "$P"
mv "$T" "$P"
cd "$P"
echo "[3] Install & build"
npm install
npm run db:generate
npm run build
echo "[4] Restart"
systemctl restart ai-site-al-ru
systemctl is-active ai-site-al-ru
echo "[done]"
