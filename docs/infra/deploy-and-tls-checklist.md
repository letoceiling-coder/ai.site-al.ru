# Deploy and TLS Checklist

## Production SSH (деплой)

- **Единственный продакшен-хост:** `root@89.169.39.244`.
- Подключение: `ssh root@89.169.39.244` (при необходимости укажите ключ: `ssh -i ~/.ssh/id_rsa root@89.169.39.244`).
- Дальше на сервере: `cd /var/www/ai.site-al.ru`, `git pull`, сборка и перезапуск по вашему чеклисту (см. `infra/scripts/deploy.sh` и PM2).

## Server Layout
- Проектная директория: `/var/www/ai.site-al.ru`.
- Приложение слушает отдельный порт: `3006`.
- Nginx config только для `ai.site-al.ru`: `/etc/nginx/sites-available/ai.site-al.ru.conf`.

## Safe TLS Issuance (Without Touching Other Projects)
1. Создать отдельный `server` блок только для `ai.site-al.ru`.
2. Проверить `nginx -t` перед любыми изменениями.
3. Выпускать сертификат webroot-методом:
   - `certbot certonly --webroot -w /var/www/ai.site-al.ru -d ai.site-al.ru -d www.ai.site-al.ru`
4. Не использовать wildcard-переиздание общего сертификата.
5. После выпуска снова `nginx -t` и только затем `systemctl reload nginx`.

## Pre-Deploy Backup
- Сделать backup текущего nginx файла:
  - `cp /etc/nginx/sites-available/ai.site-al.ru.conf /etc/nginx/sites-available/ai.site-al.ru.conf.bak.$(date +%F-%H%M%S)`
- Сделать backup `.env` и текущего release.

## Post-Deploy Validation
- Проверить health endpoint.
- Проверить login/logout flow.
- Проверить WebSocket upgrade через reverse proxy.
- Проверить cert validity:
  - `openssl s_client -connect ai.site-al.ru:443 -servername ai.site-al.ru < /dev/null 2>/dev/null | openssl x509 -noout -dates -subject`
