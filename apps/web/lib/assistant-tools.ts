/**
 * Инструменты ассистента (function-calling).
 *
 * Все настройки хранятся в `Assistant.settingsJson.tools` в формате:
 * {
 *   create_lead:         { enabled: boolean, webhookUrl?: string, notifyEmail?: string, instructions?: string },
 *   handoff_to_operator: { enabled: boolean, webhookUrl?: string, notifyEmail?: string, instructions?: string },
 *   schedule_callback:   { enabled: boolean, webhookUrl?: string, notifyEmail?: string, instructions?: string },
 * }
 *
 * Каждый инструмент имеет JSON Schema параметров (в формате OpenAI).
 * Провайдеро-специфичная сериализация — в `toOpenAiTools`, `toAnthropicTools`, `toGeminiTools`.
 */

export type AssistantToolId =
  | "create_lead"
  | "handoff_to_operator"
  | "schedule_callback"
  | "search_knowledge_base";

export type AssistantToolConfig = {
  enabled: boolean;
  /** Необязательный внешний webhook — туда POST-ом отправится payload после успешного вызова. */
  webhookUrl: string;
  /** Необязательный email для уведомления (пока только логируется, отправка — в будущем). */
  notifyEmail: string;
  /**
   * Произвольная инструкция для ассистента о том, КОГДА/КАК вызывать инструмент.
   * Попадает в description инструмента при передаче в LLM.
   */
  instructions: string;
};

export type AssistantToolsConfig = Record<AssistantToolId, AssistantToolConfig>;

export const DEFAULT_TOOL_CONFIG: AssistantToolConfig = {
  enabled: false,
  webhookUrl: "",
  notifyEmail: "",
  instructions: "",
};

export const DEFAULT_ASSISTANT_TOOLS: AssistantToolsConfig = {
  create_lead: { ...DEFAULT_TOOL_CONFIG },
  handoff_to_operator: { ...DEFAULT_TOOL_CONFIG },
  schedule_callback: { ...DEFAULT_TOOL_CONFIG },
  search_knowledge_base: { ...DEFAULT_TOOL_CONFIG },
};

export type ToolParameterSchema = {
  type: "object";
  properties: Record<
    string,
    {
      type: "string" | "number" | "integer" | "boolean";
      description?: string;
      enum?: string[];
      minimum?: number;
      maximum?: number;
      default?: unknown;
    }
  >;
  required?: string[];
};

export type AssistantToolDefinition = {
  id: AssistantToolId;
  title: string;
  /** Человекочитаемое описание для UI. */
  humanDescription: string;
  /** Базовое описание для LLM (как function description). */
  modelDescription: string;
  parameters: ToolParameterSchema;
};

export const BUILTIN_TOOLS: AssistantToolDefinition[] = [
  {
    id: "create_lead",
    title: "Создание заявки (лида)",
    humanDescription:
      "Ассистент может оформить заявку: имя, телефон/email, короткий комментарий. Заявка попадает в раздел «Лиды».",
    modelDescription:
      "Создать лид (заявку на услугу/товар). Вызывай, когда пользователь явно готов оставить контакт для связи. " +
      "Обязательно уточни имя и минимум один контакт (телефон или email) до вызова.",
    parameters: {
      type: "object",
      properties: {
        fullName: { type: "string", description: "Имя пользователя, как он представился." },
        phone: { type: "string", description: "Телефон в произвольном формате, с кодом страны если указан." },
        email: { type: "string", description: "Электронная почта пользователя, если он её дал." },
        message: { type: "string", description: "Короткое описание запроса: что именно интересует." },
        productInterest: {
          type: "string",
          description: "Продукт/услуга, которой заинтересовался пользователь (если применимо).",
        },
      },
      required: ["fullName"],
    },
  },
  {
    id: "handoff_to_operator",
    title: "Передача оператору",
    humanDescription:
      "Если ассистент не справляется или пользователь просит живого человека — он сообщит об эскалации. Запись попадает в журнал.",
    modelDescription:
      "Эскалировать диалог на живого оператора. Вызывай, когда пользователь явно просит человека, " +
      "либо когда вопрос вне базы знаний и требует личного участия. " +
      "Перед вызовом попрощайся и скажи, что передаёшь оператора.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Краткое объяснение, почему нужна эскалация." },
        urgency: {
          type: "string",
          description: "Срочность: low | normal | high.",
          enum: ["low", "normal", "high"],
        },
        summary: { type: "string", description: "Короткая сводка диалога для оператора (2–3 предложения)." },
      },
      required: ["reason"],
    },
  },
  {
    id: "search_knowledge_base",
    title: "Поиск в базе знаний",
    humanDescription:
      "Ассистент сам ищет нужные фрагменты в подключённых базах знаний и цитирует их. Используется, когда контекста недостаточно или нужен уточняющий поиск по длинным материалам.",
    modelDescription:
      "Выполнить поиск по базе знаний ассистента и получить релевантные фрагменты с указанием источника. " +
      "Вызывай, когда: (а) базового контекста недостаточно, (б) пользователь задаёт уточняющий/узкий вопрос, " +
      "(в) нужно процитировать конкретный документ. Формулируй короткий, конкретный `query` (3–10 слов). " +
      "Используй результаты как единственный источник фактов, если включён strict-режим. Цитируй `title` в ответе.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Короткий поисковый запрос на языке материалов базы (чаще русский). 3–10 значимых слов; без лишних фраз типа «найди в базе».",
        },
        topK: {
          type: "integer",
          description: "Сколько фрагментов вернуть (1–10). По умолчанию 5.",
          minimum: 1,
          maximum: 10,
          default: 5,
        },
      },
      required: ["query"],
    },
  },
  {
    id: "schedule_callback",
    title: "Запрос обратного звонка",
    humanDescription:
      "Если пользователь просит перезвонить — ассистент оформит заявку на звонок с удобным временем и телефоном.",
    modelDescription:
      "Оформить заявку на обратный звонок. Обязательно уточни телефон и удобное время звонка " +
      "(день + диапазон часов, либо ISO 8601) перед вызовом.",
    parameters: {
      type: "object",
      properties: {
        fullName: { type: "string", description: "Имя пользователя." },
        phone: { type: "string", description: "Телефон для обратного звонка." },
        preferredTime: {
          type: "string",
          description:
            "Предпочтительное время звонка. Либо ISO (2026-04-22T15:00), либо описание («завтра после 15:00»).",
        },
        purpose: { type: "string", description: "Что обсудить на звонке." },
      },
      required: ["phone", "preferredTime"],
    },
  },
];

export function getToolDefinition(id: AssistantToolId): AssistantToolDefinition | null {
  return BUILTIN_TOOLS.find((t) => t.id === id) ?? null;
}

function normalizeOneTool(raw: unknown): AssistantToolConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_TOOL_CONFIG };
  }
  const v = raw as Record<string, unknown>;
  const webhook = typeof v.webhookUrl === "string" ? v.webhookUrl.trim() : "";
  const isValidWebhook = !webhook || /^https?:\/\//i.test(webhook);
  return {
    enabled: v.enabled === true,
    webhookUrl: isValidWebhook ? webhook.slice(0, 1000) : "",
    notifyEmail: typeof v.notifyEmail === "string" ? v.notifyEmail.trim().slice(0, 200) : "",
    instructions: typeof v.instructions === "string" ? v.instructions.slice(0, 600).trim() : "",
  };
}

export function normalizeAssistantTools(raw: unknown): AssistantToolsConfig {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    create_lead: normalizeOneTool(source.create_lead),
    handoff_to_operator: normalizeOneTool(source.handoff_to_operator),
    schedule_callback: normalizeOneTool(source.schedule_callback),
    search_knowledge_base: normalizeOneTool(source.search_knowledge_base),
  };
}

export function extractAssistantTools(settingsJson: unknown): AssistantToolsConfig {
  if (!settingsJson || typeof settingsJson !== "object" || Array.isArray(settingsJson)) {
    return { ...DEFAULT_ASSISTANT_TOOLS };
  }
  const v = settingsJson as Record<string, unknown>;
  return normalizeAssistantTools(v.tools);
}

export function mergeAssistantTools(
  existing: unknown,
  incoming: Partial<AssistantToolsConfig>,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const current = extractAssistantTools(existing);
  const merged: AssistantToolsConfig = {
    create_lead: { ...current.create_lead, ...(incoming.create_lead ?? {}) },
    handoff_to_operator: { ...current.handoff_to_operator, ...(incoming.handoff_to_operator ?? {}) },
    schedule_callback: { ...current.schedule_callback, ...(incoming.schedule_callback ?? {}) },
    search_knowledge_base: { ...current.search_knowledge_base, ...(incoming.search_knowledge_base ?? {}) },
  };
  base.tools = normalizeAssistantTools(merged);
  return base;
}

/** Список активных инструментов с мержем базового описания и кастомных инструкций пользователя. */
export function resolveEnabledTools(config: AssistantToolsConfig): Array<{
  definition: AssistantToolDefinition;
  config: AssistantToolConfig;
  description: string;
}> {
  const out: Array<{ definition: AssistantToolDefinition; config: AssistantToolConfig; description: string }> = [];
  for (const def of BUILTIN_TOOLS) {
    const cfg = config[def.id];
    if (!cfg?.enabled) {
      continue;
    }
    const description = cfg.instructions
      ? `${def.modelDescription}\n\nПользовательские инструкции: ${cfg.instructions}`
      : def.modelDescription;
    out.push({ definition: def, config: cfg, description });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Провайдеро-специфичные форматы                                      */
/* ------------------------------------------------------------------ */

type ProviderTool = Record<string, unknown>;

export function toOpenAiTools(config: AssistantToolsConfig): ProviderTool[] {
  return resolveEnabledTools(config).map(({ definition, description }) => ({
    type: "function",
    function: {
      name: definition.id,
      description,
      parameters: definition.parameters,
    },
  }));
}

export function toAnthropicTools(config: AssistantToolsConfig): ProviderTool[] {
  return resolveEnabledTools(config).map(({ definition, description }) => ({
    name: definition.id,
    description,
    input_schema: definition.parameters,
  }));
}

export function toGeminiTools(config: AssistantToolsConfig): ProviderTool[] {
  const enabled = resolveEnabledTools(config);
  if (enabled.length === 0) {
    return [];
  }
  return [
    {
      functionDeclarations: enabled.map(({ definition, description }) => ({
        name: definition.id,
        description,
        parameters: definition.parameters,
      })),
    },
  ];
}
