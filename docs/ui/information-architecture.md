# Admin IA and User Flows

## Navigation
- Dashboard
- Интеграция AI
- Агенты
- База знаний
- Ассистенты
- Диалоги
- API ключи
- Лиды
- Telegram Bot
- Аналитика
- Usage
- Настройки
- Авито

## Core UX Principles
- Все экраны tenant-aware и фильтруют данные по tenant автоматически.
- Каждое действие с риском (удаление, отзыв ключа, webhook reset) требует подтверждение.
- Важные фоновые процессы показываются в realtime-блоке (WebSocket).

## Critical User Flows

### Auth Flow
1. Регистрация owner -> создание tenant -> подтверждение email.
2. Логин -> доступ в Dashboard.
3. Forgot password -> ссылка -> reset password.

### Agent + Assistant Flow
1. Подключение провайдера в Интеграции AI.
2. Создание агента с моделью и параметрами.
3. Создание ассистента, привязка агента и базы знаний.
4. Запуск тестового диалога и просмотр usage.

### Knowledge Base Flow
1. Создание базы знаний.
2. Загрузка файла/добавление текста/ссылки.
3. Индексация в фоне (jobs + ingestion события).
4. Подключение базы в ассистенте.

### Integration Flow (Avito/Telegram)
1. Добавление credentials.
2. Настройка webhook URL.
3. Валидация webhook.
4. Мониторинг событий и ошибок.
