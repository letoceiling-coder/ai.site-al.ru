#!/usr/bin/env bash
set -euo pipefail

DB_PASS="${1:?db password required}"
JWT_SECRET="${2:?jwt secret required}"

DB_USER="ai_site_al_ru_user"
DB_NAME="ai_site_al_ru"
ENV_FILE="/var/www/ai.site-al.ru/.env"

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
SQL

touch "${ENV_FILE}"

python3 - <<PY
from pathlib import Path
env_path = Path("${ENV_FILE}")
data = {}
if env_path.exists():
    for raw in env_path.read_text(errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        data[k] = v

data["DATABASE_URL"] = "\"postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?schema=public\""
data["JWT_SECRET"] = "\"${JWT_SECRET}\""
data["NODE_ENV"] = "\"production\""

env_path.write_text("".join(f"{k}={v}\n" for k, v in data.items()))
PY

printf "DB_USER=%s\nDB_NAME=%s\nDB_PASS=%s\nJWT_SECRET=%s\n" \
  "${DB_USER}" "${DB_NAME}" "${DB_PASS}" "${JWT_SECRET}" > /root/ai-site-al-ru-secrets.txt
chmod 600 /root/ai-site-al-ru-secrets.txt

systemctl restart ai-site-al-ru
echo "OK"
