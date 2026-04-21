# API Contracts

## Base Rules
- Все API маршруты используют префикс `/api`.
- Каждый запрос работает в контексте `tenantId`, определяемом из сессии.
- Формат ответа: `ApiResponse<T>` из `@ai/shared`.
- Ошибки: `UNAUTHORIZED`, `FORBIDDEN`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `INTEGRATION_ERROR`.

## Auth
- `POST /api/auth/register` — регистрация tenant + owner.
- `POST /api/auth/login` — выдача `access_token` и `refresh_token`.
- `POST /api/auth/forgot-password` — генерация reset token.
- `POST /api/auth/reset-password` — смена пароля по токену.
- `POST /api/auth/logout` — отзыв refresh session и очистка cookies.
- `GET /api/auth/me` — профиль текущего пользователя.

## Admin Modules (REST)
- `GET /api/admin/:module` — список ресурсов модуля.
- `POST /api/admin/:module` — создание ресурса модуля.
- Модули: `integrations`, `agents`, `knowledge`, `assistants`, `dialogs`, `api_keys`, `leads`, `telegram`, `analytics`, `usage`, `settings`, `avito`.

## Contracts Discovery
- `GET /api/contracts/rest` — реестр REST контрактов.
- `GET /api/contracts/ws` — реестр WebSocket событий.

## WebSocket Contracts
- Каналы: `jobs`, `dialogs`, `ingestion`, `integrations`, `system`.
- События:
  - `job.created`
  - `job.progress`
  - `job.failed`
  - `dialog.message.stream`
  - `ingestion.updated`
  - `webhook.received`
  - `system.health`

## Security Contract
- Обязательный middleware на проверку access cookie.
- RBAC: permission-строки формата `module.action`.
- Audit log на мутационные операции (`create`, `update`, `delete`).
