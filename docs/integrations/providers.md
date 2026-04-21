# Integrations Registry (Official Docs Only)

Использовать только официальные документы и SDK. Перед внедрением каждого endpoint обязательно сверять changelog.

## AI Providers
- OpenAI: [https://platform.openai.com/docs](https://platform.openai.com/docs)
- Anthropic Claude: [https://docs.anthropic.com](https://docs.anthropic.com)
- Google AI Studio (Gemini): [https://ai.google.dev/gemini-api/docs](https://ai.google.dev/gemini-api/docs)
- xAI (Grok): [https://docs.x.ai](https://docs.x.ai)
- Replicate: [https://replicate.com/docs](https://replicate.com/docs)
- ElevenLabs: [https://elevenlabs.io/docs](https://elevenlabs.io/docs)

## Messaging / Marketplace
- Telegram Bot API: [https://core.telegram.org/bots/api](https://core.telegram.org/bots/api)
- Avito API: [https://developers.avito.ru/api-catalog](https://developers.avito.ru/api-catalog)

## Adapter Standard
- Каждый провайдер реализует единый интерфейс адаптера.
- Ошибки приводятся к унифицированному виду `IntegrationError`.
- Поддерживаются retry policy и circuit breaker.
- Ключи и токены хранятся только в шифрованном виде.
