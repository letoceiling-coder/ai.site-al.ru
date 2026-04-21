import { prisma } from "@ai/db";
import { decodeSecret } from "@/lib/integrations";

const SUGGEST_MODEL =
  process.env.OPENROUTER_SUGGEST_MODEL?.trim() || "openai/gpt-4o-mini";

export type SuggestCard = { title: string; content: string };

export async function suggestKnowledgeCardsFromRawText(
  tenantId: string,
  rawText: string,
): Promise<SuggestCard[]> {
  const openrouterRow = await prisma.systemSetting.findFirst({
    where: { tenantId, key: "openrouter" },
  });
  const openrouter = (openrouterRow?.value ?? {}) as { enabled?: boolean; apiKey?: string };
  if (openrouter.enabled && typeof openrouter.apiKey === "string" && openrouter.apiKey.trim()) {
    return completeSuggestOpenRouter(openrouter.apiKey.trim(), SUGGEST_MODEL, rawText);
  }

  const openaiIntegration = await prisma.providerIntegration.findFirst({
    where: { tenantId, provider: "OPENAI", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  if (!openaiIntegration) {
    throw new Error("Нет OpenRouter или OpenAI для подсказок. Настройте интеграцию.");
  }
  const apiKey = decodeSecret(openaiIntegration.encryptedSecret);
  if (!apiKey?.trim()) {
    throw new Error("Нет ключа OpenAI.");
  }
  return completeSuggestOpenAi(apiKey.trim(), "gpt-4o-mini", rawText);
}

function parseCardsJson(text: string): SuggestCard[] {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const data = JSON.parse(cleaned) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("Ответ модели не массив");
  }
  const out: SuggestCard[] = [];
  for (const row of data.slice(0, 14)) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const o = row as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const content = typeof o.content === "string" ? o.content.trim() : "";
    if (title && content) {
      out.push({ title: title.slice(0, 200), content: content.slice(0, 12000) });
    }
  }
  if (out.length === 0) {
    throw new Error("Модель не вернула карточки");
  }
  return out;
}

async function completeSuggestOpenRouter(apiKey: string, model: string, raw: string) {
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
      temperature: 0.15,
      messages: [
        {
          role: "system",
          content:
            'Ты готовишь фрагменты для базы знаний. Верни ТОЛЬКО JSON-массив вида [{"title":"...","content":"..."}] без пояснений и без markdown. 2–12 элементов: короткий title, content — связный фрагмент на русском, без выдуманных фактов — только из текста пользователя.',
        },
        { role: "user", content: raw.slice(0, 14_000) },
      ],
    }),
  });
  if (!response.ok) {
    const t = await response.text().catch(() => "");
    throw new Error(`OpenRouter ${response.status}: ${t.slice(0, 200)}`);
  }
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new Error("Пустой ответ модели");
  }
  return parseCardsJson(text);
}

async function completeSuggestOpenAi(apiKey: string, model: string, raw: string) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      messages: [
        {
          role: "system",
          content:
            'Ты готовишь фрагменты для базы знаний. Верни ТОЛЬКО JSON-массив вида [{"title":"...","content":"..."}] без пояснений. 2–12 элементов, только из текста пользователя.',
        },
        { role: "user", content: raw.slice(0, 14_000) },
      ],
    }),
  });
  if (!response.ok) {
    const t = await response.text().catch(() => "");
    throw new Error(`OpenAI ${response.status}: ${t.slice(0, 200)}`);
  }
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new Error("Пустой ответ модели");
  }
  return parseCardsJson(text);
}
