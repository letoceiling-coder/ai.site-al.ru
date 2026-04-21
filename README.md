# ai.site-al.ru

Multi-tenant SaaS scaffold на React (Next.js) + Prisma + PostgreSQL.

## Что уже реализовано
- Monorepo структура `apps/*` и `packages/*`.
- Prisma schema для всех доменных модулей.
- Auth API: register/login/logout/forgot/reset/me.
- Защищенный UI-каркас админ-панели с разделами из ТЗ.
- REST/WebSocket контрактные реестры.
- Инфраструктура: Dockerfile, docker-compose, Nginx conf, deploy script, GitHub Actions.

## Быстрый старт
1. Скопировать env:
   - `cp .env.example .env`
2. Установить зависимости:
   - `npm install`
3. Сгенерировать Prisma client:
   - `npm run db:generate`
4. Запустить приложение:
   - `npm run dev`

## E2E сценарии агентов
- Тесты находятся в `apps/web/e2e/agents-chat.spec.ts`.
- Установить браузеры Playwright:
  - `npx playwright install`
- Посмотреть список тестов:
  - `npm run test:e2e -w apps/web -- --list`
- Запуск:
  - `npm run test:e2e -w apps/web`

## Auth refresh flow
- Добавлен endpoint `POST /api/auth/refresh` для перевыпуска `access_token` по `refresh_token`.
- Middleware теперь проактивно обновляет `access_token`, если токен отсутствует или истекает.

## Документация
- Контракты API: `docs/api/contracts.md`
- IA админки: `docs/ui/information-architecture.md`
- Интеграции и официальные docs: `docs/integrations/providers.md`
- Деплой и TLS чеклист: `docs/infra/deploy-and-tls-checklist.md`
