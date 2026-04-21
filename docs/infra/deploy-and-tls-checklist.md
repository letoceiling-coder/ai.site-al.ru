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

## Миграции БД (pgvector / RAG)

- Для семантического поиска по базе знаний нужны расширение **pgvector** и миграция `20260221140000_knowledge_chunk_vectors_fts` (столбцы `Chunk.embedding`, `Chunk.content_tsv`, индексы).
- На сервере из **корня репозитория** (чтобы подхватился `.env`): `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`.
- Установите пакет ОС, например Ubuntu: `apt-get install -y postgresql-16-pgvector` (версия должна совпадать с major PostgreSQL).
- Если `CREATE EXTENSION vector` запрещён роли приложения — один раз от суперпользователя: `sudo -u postgres psql -d ИМЯ_БД -c 'CREATE EXTENSION IF NOT EXISTS vector;'`, затем снова `migrate deploy`.
- Воркер эмбеддингов по cron: скрипт `infra/scripts/embedding-worker-cron.sh`, переменные в `.env` — см. `docs/knowledge/limitations-and-mitigations.md`.
- Переменные окружения лежат **только** в корневом `/var/www/ai.site-al.ru/.env` (правятся по SSH, в git не коммитятся). Next подхватывает их автоматически через `apps/web/scripts/start-with-root-env.js` — никаких копий `apps/web/.env*` заводить не нужно.

## Post-Deploy Validation
- Проверить health endpoint.
- Проверить login/logout flow.
- Проверить WebSocket upgrade через reverse proxy.
- Проверить cert validity:
  - `openssl s_client -connect ai.site-al.ru:443 -servername ai.site-al.ru < /dev/null 2>/dev/null | openssl x509 -noout -dates -subject`
