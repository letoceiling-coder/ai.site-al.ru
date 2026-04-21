-- Настройки базы знаний (чанкинг, грунтинг, авто-заголовки, лимит контекста).
ALTER TABLE "KnowledgeBase" ADD COLUMN "settingsJson" JSONB;
