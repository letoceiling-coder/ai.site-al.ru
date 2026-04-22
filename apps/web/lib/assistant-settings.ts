/**
 * Персоналия и стиль ответов ассистента: tone, length, language, emoji, template.
 * Плюс параметры генерации (temperature, maxTokens, topP).
 * Всё хранится в поле Assistant.settingsJson (наряду с useOpenRouter, model, и другими ключами).
 */

export type AssistantGenerationOverrides = {
  /** null = использовать дефолт (0.7) */
  temperature: number | null;
  /** null = без ограничения */
  maxTokens: number | null;
  /** null = дефолт (1.0) */
  topP: number | null;
};

export const DEFAULT_ASSISTANT_GENERATION: AssistantGenerationOverrides = {
  temperature: null,
  maxTokens: null,
  topP: null,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseNumberOrNull(raw: unknown, min: number, max: number, allowInt?: boolean): number | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    return null;
  }
  const clamped = clamp(n, min, max);
  return allowInt ? Math.round(clamped) : clamped;
}

export function normalizeGenerationOverrides(raw: unknown): AssistantGenerationOverrides {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_ASSISTANT_GENERATION };
  }
  const v = raw as Record<string, unknown>;
  return {
    temperature: parseNumberOrNull(v.temperature, 0, 2),
    maxTokens: parseNumberOrNull(v.maxTokens, 1, 8192, true),
    topP: parseNumberOrNull(v.topP, 0, 1),
  };
}

export function extractGenerationOverrides(settingsJson: unknown): AssistantGenerationOverrides {
  if (!settingsJson || typeof settingsJson !== "object" || Array.isArray(settingsJson)) {
    return { ...DEFAULT_ASSISTANT_GENERATION };
  }
  const v = settingsJson as Record<string, unknown>;
  return {
    temperature: parseNumberOrNull(v.temperature, 0, 2),
    maxTokens: parseNumberOrNull(v.maxTokens, 1, 8192, true),
    topP: parseNumberOrNull(v.topP, 0, 1),
  };
}

export function mergeGenerationOverrides(
  existing: unknown,
  incoming: Partial<AssistantGenerationOverrides>,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const current = extractGenerationOverrides(existing);
  const merged = normalizeGenerationOverrides({ ...current, ...incoming });
  base.temperature = merged.temperature;
  base.maxTokens = merged.maxTokens;
  base.topP = merged.topP;
  return base;
}

export type AssistantTemplate =
  | "blank"
  | "support"
  | "sales"
  | "concierge"
  | "expert"
  | "techsupport"
  | "legal";

export type AssistantTone = "friendly" | "formal" | "neutral" | "energetic" | "empathic";
export type AssistantLength = "short" | "normal" | "detailed";
export type AssistantLanguage = "auto" | "ru" | "en";

export type AssistantPersonaSettings = {
  template: AssistantTemplate;
  tone: AssistantTone;
  length: AssistantLength;
  language: AssistantLanguage;
  useEmoji: boolean;
  /**
   * Короткое описание роли (1 предложение), попадает в systemPrompt как «You are: ...».
   * Необязательно — если пусто, директива не добавляется.
   */
  role: string;
  /** Приветственное сообщение ассистента (отдаётся в UI для новой сессии). */
  welcomeMessage: string;
  /** Быстрые кнопки-подсказки под сообщением (chips). */
  quickReplies: string[];
  /** Темы/слова, на которые нельзя отвечать. */
  bannedTopics: string[];
  /** Обязательный дисклеймер в конце ответа. */
  disclaimer: string;
  /**
   * Фраза, которую ассистент произносит при эскалации на оператора
   * (напр. «Я переключу вас на живого специалиста»).
   */
  handoffMessage: string;
};

export const DEFAULT_ASSISTANT_SETTINGS: AssistantPersonaSettings = {
  template: "blank",
  tone: "friendly",
  length: "normal",
  language: "auto",
  useEmoji: false,
  role: "",
  welcomeMessage: "",
  quickReplies: [],
  bannedTopics: [],
  disclaimer: "",
  handoffMessage: "",
};

const VALID_TEMPLATES: AssistantTemplate[] = [
  "blank",
  "support",
  "sales",
  "concierge",
  "expert",
  "techsupport",
  "legal",
];
const VALID_TONES: AssistantTone[] = ["friendly", "formal", "neutral", "energetic", "empathic"];
const VALID_LENGTHS: AssistantLength[] = ["short", "normal", "detailed"];
const VALID_LANGUAGES: AssistantLanguage[] = ["auto", "ru", "en"];

export type AssistantTemplatePreset = {
  id: AssistantTemplate;
  title: string;
  description: string;
  /** Готовый системный промпт для этого шаблона (используется, если пользователь не ввёл свой). */
  systemPrompt: string;
  /** Стиль и длина по умолчанию для шаблона. */
  persona: Partial<AssistantPersonaSettings>;
};

export const ASSISTANT_TEMPLATES: AssistantTemplatePreset[] = [
  {
    id: "blank",
    title: "Пустой",
    description: "Начать с чистого листа — без готового промпта и пресетов.",
    systemPrompt: "",
    persona: {},
  },
  {
    id: "support",
    title: "Поддержка клиентов",
    description: "Вежливо и кратко отвечает по базе знаний, не выдумывает.",
    systemPrompt: [
      "Ты — ассистент поддержки клиентов.",
      "Твоя задача — быстро и вежливо отвечать на вопросы пользователей, опираясь на подключённую базу знаний.",
      "Если в базе нет ответа — честно скажи, что не нашёл информации, и предложи связаться с оператором.",
      "Не придумывай цены, сроки и условия, если они не указаны в базе.",
    ].join(" "),
    persona: {
      template: "support",
      tone: "friendly",
      length: "short",
      useEmoji: false,
      welcomeMessage: "Здравствуйте! Я виртуальный помощник поддержки. Чем могу помочь?",
      quickReplies: ["Режим работы", "Доставка и оплата", "Возврат товара", "Связаться с оператором"],
      handoffMessage: "Сейчас подключу к вам живого специалиста — он ответит в ближайшее время.",
    },
  },
  {
    id: "sales",
    title: "Продажник",
    description: "Выявляет потребность, презентует продукт, мягко ведёт к покупке.",
    systemPrompt: [
      "Ты — менеджер по продажам.",
      "Цель — помочь клиенту выбрать подходящий продукт или услугу из каталога и мягко подвести к покупке.",
      "Задавай уточняющие вопросы о потребностях, бюджете и сроках. Делай 1-2 коротких предложения и паузу для ответа клиента.",
      "Не давай скидок и не обещай ничего, чего нет в базе знаний. Если клиент готов — предложи оставить контакт или связаться с менеджером.",
    ].join(" "),
    persona: {
      template: "sales",
      tone: "friendly",
      length: "short",
      useEmoji: true,
      welcomeMessage: "Здравствуйте! Помогу подобрать подходящий вариант. Что ищете?",
      quickReplies: ["Подобрать по цене", "Что в наличии?", "Скидки и акции", "Оставить заявку"],
      handoffMessage: "Передам ваш запрос менеджеру — он свяжется с вами в рабочее время.",
    },
  },
  {
    id: "concierge",
    title: "Консьерж-администратор",
    description: "Записывает на услуги, отвечает по графику, уточняет детали бронирования.",
    systemPrompt: [
      "Ты — администратор салона/клиники/отеля.",
      "Помогаешь клиентам узнать график работы, стоимость услуг и записаться на визит.",
      "Всегда уточняй имя, удобную дату и время, телефон для подтверждения.",
      "Если услуги нет в базе знаний — скажи, что уточнишь у специалиста.",
    ].join(" "),
    persona: {
      template: "concierge",
      tone: "friendly",
      length: "short",
      useEmoji: false,
      welcomeMessage: "Здравствуйте! Помогу записаться и ответить по услугам. На что вас записать?",
      quickReplies: ["Записаться", "График работы", "Стоимость услуг", "Отменить запись"],
      handoffMessage: "Передаю обращение администратору — он подтвердит детали записи.",
    },
  },
  {
    id: "expert",
    title: "Эксперт по продуктам",
    description: "Даёт развёрнутые консультации по ассортименту со ссылками на базу знаний.",
    systemPrompt: [
      "Ты — эксперт-консультант по каталогу продуктов компании.",
      "Даёшь развёрнутые и технически корректные ответы, опираясь только на подключённую базу знаний.",
      "Сравнивай варианты по характеристикам, объясняй разницу, приводи примеры применения.",
      "Если данных о товаре нет в базе — честно скажи об этом.",
    ].join(" "),
    persona: {
      template: "expert",
      tone: "neutral",
      length: "detailed",
      useEmoji: false,
      welcomeMessage: "Здравствуйте. Подробно расскажу о продуктах и помогу выбрать. О чём рассказать?",
      quickReplies: ["Сравнить модели", "Характеристики", "Совместимость", "Рекомендации"],
    },
  },
  {
    id: "techsupport",
    title: "Техническая поддержка",
    description: "Диагностика проблем шаг за шагом, инструкции по решению.",
    systemPrompt: [
      "Ты — инженер технической поддержки.",
      "Помогаешь пользователям диагностировать и решать технические проблемы.",
      "Задавай уточняющие вопросы (ОС, версия, шаги воспроизведения, текст ошибки). Предлагай проверки по шагам.",
      "Если проблема не решается или выходит за рамки базы знаний — эскалируй на инженера.",
    ].join(" "),
    persona: {
      template: "techsupport",
      tone: "neutral",
      length: "normal",
      useEmoji: false,
      welcomeMessage: "Здравствуйте. Опишите проблему: ОС/версия, что делаете, что получаете.",
      quickReplies: ["Не могу войти", "Ошибка оплаты", "Медленно работает", "Связь с инженером"],
      handoffMessage: "Эскалирую запрос в инженерную команду — они подключатся к задаче.",
    },
  },
  {
    id: "legal",
    title: "Юрист 1-линии",
    description: "Первичная консультация по регламентам и договорам из базы знаний.",
    systemPrompt: [
      "Ты — юридический консультант первой линии.",
      "Отвечаешь строго по регламентам, политикам и договорам из подключённой базы знаний.",
      "Формулируй чётко, со ссылками на пункты документов. Никогда не придумывай нормы права.",
      "Всегда добавляй оговорку: «Это справочная информация, для официальной позиции обратитесь к юристу компании».",
    ].join(" "),
    persona: {
      template: "legal",
      tone: "formal",
      length: "detailed",
      useEmoji: false,
      welcomeMessage: "Здравствуйте. Отвечаю по регламентам и договорам компании. Какой у вас вопрос?",
      quickReplies: ["Условия возврата", "Договор оферты", "Политика конфиденциальности", "Персональные данные"],
      disclaimer: "Это справочная информация. Для официальной позиции обратитесь к юристу компании.",
      handoffMessage: "Передам запрос корпоративному юристу.",
    },
  },
];

export function getAssistantTemplate(id: AssistantTemplate | string): AssistantTemplatePreset {
  return ASSISTANT_TEMPLATES.find((tpl) => tpl.id === id) ?? ASSISTANT_TEMPLATES[0];
}

export function normalizeAssistantSettings(raw: unknown): AssistantPersonaSettings {
  const base = { ...DEFAULT_ASSISTANT_SETTINGS };
  if (!raw || typeof raw !== "object") {
    return base;
  }
  const value = raw as Record<string, unknown>;
  const template = typeof value.template === "string" ? value.template : "";
  if ((VALID_TEMPLATES as string[]).includes(template)) {
    base.template = template as AssistantTemplate;
  }
  const tone = typeof value.tone === "string" ? value.tone : "";
  if ((VALID_TONES as string[]).includes(tone)) {
    base.tone = tone as AssistantTone;
  }
  const length = typeof value.length === "string" ? value.length : "";
  if ((VALID_LENGTHS as string[]).includes(length)) {
    base.length = length as AssistantLength;
  }
  const language = typeof value.language === "string" ? value.language : "";
  if ((VALID_LANGUAGES as string[]).includes(language)) {
    base.language = language as AssistantLanguage;
  }
  if (typeof value.useEmoji === "boolean") {
    base.useEmoji = value.useEmoji;
  }
  if (typeof value.role === "string") {
    base.role = value.role.slice(0, 240).trim();
  }
  if (typeof value.welcomeMessage === "string") {
    base.welcomeMessage = value.welcomeMessage.slice(0, 600).trim();
  }
  if (Array.isArray(value.quickReplies)) {
    base.quickReplies = value.quickReplies
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim().slice(0, 80))
      .slice(0, 8);
  }
  if (Array.isArray(value.bannedTopics)) {
    base.bannedTopics = value.bannedTopics
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim().slice(0, 80))
      .slice(0, 20);
  }
  if (typeof value.disclaimer === "string") {
    base.disclaimer = value.disclaimer.slice(0, 400).trim();
  }
  if (typeof value.handoffMessage === "string") {
    base.handoffMessage = value.handoffMessage.slice(0, 400).trim();
  }
  return base;
}

export function settingsFromTemplate(id: AssistantTemplate): AssistantPersonaSettings {
  const tpl = getAssistantTemplate(id);
  return { ...DEFAULT_ASSISTANT_SETTINGS, ...tpl.persona, template: tpl.id };
}

/**
 * Сформировать директивы для системного промпта из персональных настроек.
 * Возвращает пустую строку, если ничего нестандартного не задано.
 */
export function buildPersonaDirectives(settings: AssistantPersonaSettings): string {
  const parts: string[] = [];

  if (settings.role.trim()) {
    parts.push(`Роль: ${settings.role.trim()}.`);
  }

  const toneText: Record<AssistantTone, string> = {
    friendly: "Говори дружелюбно и тепло, без канцеляризмов.",
    formal: "Говори официально и деловым тоном, без фамильярности.",
    neutral: "Говори нейтрально и фактологически.",
    energetic: "Говори энергично и позитивно, вовлекай собеседника.",
    empathic: "Говори с эмпатией, признавай чувства собеседника перед тем как помогать.",
  };
  parts.push(toneText[settings.tone]);

  const lengthText: Record<AssistantLength, string> = {
    short: "Отвечай коротко — 1–3 предложения. Избегай воды и перечислений.",
    normal: "Отвечай сбалансированно — по существу, без лишних подробностей.",
    detailed: "Давай развёрнутые ответы с примерами и пояснениями, структурируй пунктами.",
  };
  parts.push(lengthText[settings.length]);

  if (settings.language === "ru") {
    parts.push("Отвечай всегда на русском языке, даже если вопрос задан на другом языке.");
  } else if (settings.language === "en") {
    parts.push("Always reply in English, even if the question is in another language.");
  } else {
    parts.push("Отвечай на том языке, на котором к тебе обратились.");
  }

  if (settings.useEmoji) {
    parts.push("Умеренно используй эмодзи, где они уместны (1–2 на сообщение).");
  } else {
    parts.push("Не используй эмодзи.");
  }

  if (settings.bannedTopics.length > 0) {
    parts.push(
      `Запрещённые темы (никогда не обсуждай и не давай советов): ${settings.bannedTopics.join(", ")}. ` +
        "Если пользователь спрашивает об этом — вежливо откажись и предложи релевантную помощь.",
    );
  }

  if (settings.handoffMessage.trim()) {
    parts.push(
      `Если ты не можешь помочь или тебя просят соединить с человеком — используй фразу: «${settings.handoffMessage.trim()}».`,
    );
  }

  if (settings.disclaimer.trim()) {
    parts.push(
      `В конце каждого содержательного ответа добавляй дисклеймер отдельным абзацем: «${settings.disclaimer.trim()}».`,
    );
  }

  return parts.join(" ");
}

/**
 * Достать и нормализовать персональные настройки из существующей записи Assistant.settingsJson.
 * Игнорирует прочие ключи (useOpenRouter, model и т.п.).
 */
export function extractAssistantSettings(settingsJson: unknown): AssistantPersonaSettings {
  return normalizeAssistantSettings(settingsJson);
}

/**
 * Сохранить персональные настройки в settingsJson, не затирая сторонние ключи (useOpenRouter, model).
 */
export function mergeAssistantSettings(
  existing: unknown,
  persona: Partial<AssistantPersonaSettings>,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const current = extractAssistantSettings(existing);
  const merged = normalizeAssistantSettings({ ...current, ...persona });

  base.template = merged.template;
  base.tone = merged.tone;
  base.length = merged.length;
  base.language = merged.language;
  base.useEmoji = merged.useEmoji;
  base.role = merged.role;
  base.welcomeMessage = merged.welcomeMessage;
  base.quickReplies = merged.quickReplies;
  base.bannedTopics = merged.bannedTopics;
  base.disclaimer = merged.disclaimer;
  base.handoffMessage = merged.handoffMessage;
  return base;
}
