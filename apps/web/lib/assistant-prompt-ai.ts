import { prisma } from "@ai/db";
import { decodeSecret } from "@/lib/integrations";
import {
  ASSISTANT_TEMPLATES,
  buildPersonaDirectives,
  DEFAULT_ASSISTANT_SETTINGS,
  normalizeAssistantSettings,
  settingsFromTemplate,
  type AssistantPersonaSettings,
  type AssistantTemplate,
} from "@/lib/assistant-settings";
import { BUILTIN_TOOLS, normalizeAssistantTools, type AssistantToolsConfig } from "@/lib/assistant-tools";

const PROMPT_MODEL = process.env.OPENROUTER_PROMPT_MODEL?.trim() || "openai/gpt-4o-mini";
const OPENAI_MODEL = process.env.OPENAI_PROMPT_MODEL?.trim() || "gpt-4o-mini";

export type GeneratePromptInput = {
  tenantId: string;
  roleDescription: string;
  template?: AssistantTemplate | null;
  persona?: Partial<AssistantPersonaSettings> | null;
  tools?: AssistantToolsConfig | null;
};

function buildGeneratorUserPrompt(input: GeneratePromptInput): string {
  const parts: string[] = [];
  parts.push("Описание роли ассистента (от заказчика):");
  parts.push(input.roleDescription.trim().slice(0, 4000));

  if (input.template) {
    const tpl = ASSISTANT_TEMPLATES.find((t) => t.id === input.template);
    if (tpl) {
      parts.push("");
      parts.push(`Шаблон: ${tpl.title}. Описание шаблона: ${tpl.description}.`);
    }
  }

  const effectivePersona: AssistantPersonaSettings = normalizeAssistantSettings({
    ...(input.template ? settingsFromTemplate(input.template) : DEFAULT_ASSISTANT_SETTINGS),
    ...(input.persona ?? {}),
  });
  const directives = buildPersonaDirectives(effectivePersona);
  if (directives) {
    parts.push("");
    parts.push("Стиль/персона, которую нужно отразить в промпте:");
    parts.push(directives);
  }

  if (input.tools) {
    const enabled = BUILTIN_TOOLS.filter((t) => input.tools?.[t.id]?.enabled);
    if (enabled.length > 0) {
      parts.push("");
      parts.push(
        "Доступные инструменты (function-calling), которые ассистент сможет вызывать — перечисли в промпте " +
          "правила их использования:",
      );
      for (const tool of enabled) {
        parts.push(`- ${tool.id}: ${tool.title}. ${tool.humanDescription}`);
      }
    }
  }

  parts.push("");
  parts.push(
    "Верни ТОЛЬКО финальный текст System Prompt (без markdown-обрамления, без комментариев). " +
      "Пиши на русском, чётко, в повелительном наклонении ко второму лицу («Ты …»). " +
      "Структура: 1) Кто ты (роль), 2) Твои задачи и границы, 3) Правила общения (тон/длина), " +
      "4) Как использовать базу знаний (если есть факты — ссылайся только на них), " +
      "5) Когда вызывать инструменты (если указаны выше), 6) Что делать при отсутствии информации — вежливо просить уточнение " +
      "или передавать оператора. Не включай Markdown-заголовки.",
  );

  return parts.join("\n");
}

export async function generateAssistantSystemPrompt(input: GeneratePromptInput): Promise<string> {
  const description = input.roleDescription.trim();
  if (description.length < 8) {
    throw new Error("Описание роли слишком короткое (минимум 8 символов).");
  }
  const userPrompt = buildGeneratorUserPrompt(input);

  const openrouterRow = await prisma.systemSetting.findFirst({
    where: { tenantId: input.tenantId, key: "openrouter" },
  });
  const openrouter = (openrouterRow?.value ?? {}) as { enabled?: boolean; apiKey?: string };
  if (openrouter.enabled && typeof openrouter.apiKey === "string" && openrouter.apiKey.trim()) {
    return completeOpenRouter(openrouter.apiKey.trim(), PROMPT_MODEL, userPrompt);
  }

  const openaiIntegration = await prisma.providerIntegration.findFirst({
    where: { tenantId: input.tenantId, provider: "OPENAI", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  if (!openaiIntegration) {
    throw new Error("Нет OpenRouter или OpenAI для генерации. Настройте интеграцию.");
  }
  const apiKey = decodeSecret(openaiIntegration.encryptedSecret);
  if (!apiKey?.trim()) {
    throw new Error("Нет ключа OpenAI.");
  }
  return completeOpenAi(apiKey.trim(), OPENAI_MODEL, userPrompt);
}

const SYSTEM_META_PROMPT =
  "Ты опытный prompt-инженер. Твоя задача — написать качественный System Prompt для ИИ-ассистента " +
  "на русском языке. Следуй требованиям пользователя буквально. Избегай общих фраз и шаблонных формулировок. " +
  "Пиши сжато, 150–400 слов. Не добавляй преамбулу и метаинформацию — только сам промпт.";

function cleanupPrompt(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^```(?:markdown|md|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!cleaned) {
    throw new Error("Пустой ответ модели");
  }
  return cleaned.slice(0, 8000);
}

async function completeOpenRouter(apiKey: string, model: string, userPrompt: string): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://ai.site-al.ru",
      "X-Title": "ai.site-al.ru",
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: SYSTEM_META_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!response.ok) {
    const t = await response.text().catch(() => "");
    throw new Error(`OpenRouter ${response.status}: ${t.slice(0, 200)}`);
  }
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return cleanupPrompt(json.choices?.[0]?.message?.content ?? "");
}

async function completeOpenAi(apiKey: string, model: string, userPrompt: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: SYSTEM_META_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!response.ok) {
    const t = await response.text().catch(() => "");
    throw new Error(`OpenAI ${response.status}: ${t.slice(0, 200)}`);
  }
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return cleanupPrompt(json.choices?.[0]?.message?.content ?? "");
}

// Нормализуем входные persona/tools чтобы корректно их использовать в generator
export function prepareGeneratorPersona(input: unknown): AssistantPersonaSettings | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return normalizeAssistantSettings(input as Record<string, unknown>);
}

export function prepareGeneratorTools(input: unknown): AssistantToolsConfig | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return normalizeAssistantTools(input);
}
