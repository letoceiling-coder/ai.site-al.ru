import { prisma } from "@ai/db";
import { decodeSecret } from "@/lib/integrations";

type AttachmentRef = {
  name: string;
  url: string;
  mimeType: string;
  size: number;
};

type ParsedMessageContent = {
  text: string;
  attachments: AttachmentRef[];
};

export function parseMessageContent(content: string): ParsedMessageContent {
  try {
    const parsed = JSON.parse(content) as { text?: unknown; attachments?: unknown };
    const text = typeof parsed.text === "string" ? parsed.text : content;
    const attachments = Array.isArray(parsed.attachments)
      ? parsed.attachments
          .filter((item): item is AttachmentRef => {
            if (!item || typeof item !== "object") {
              return false;
            }
            const value = item as Record<string, unknown>;
            return (
              typeof value.name === "string" &&
              typeof value.url === "string" &&
              typeof value.mimeType === "string" &&
              typeof value.size === "number"
            );
          })
          .slice(0, 10)
      : [];
    return { text, attachments };
  } catch {
    return { text: content, attachments: [] };
  }
}

export function buildMessageContent(text: string, attachments: AttachmentRef[]) {
  return JSON.stringify({
    text,
    attachments: attachments.slice(0, 10),
  });
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

async function completeWithOpenAi(apiKey: string, model: string, systemPrompt: string, userText: string) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      temperature: 0.7,
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI error: ${response.status}`);
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content?.trim() ?? "";
  return {
    text: text || "Пустой ответ модели.",
    inputTokens: json.usage?.prompt_tokens ?? estimateTokens(userText),
    outputTokens: json.usage?.completion_tokens ?? estimateTokens(text || "ok"),
    route: "direct" as const,
  };
}

async function completeWithAnthropic(apiKey: string, model: string, systemPrompt: string, userText: string) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userText }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Anthropic error: ${response.status}`);
  }
  const json = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text =
    json.content?.find((item) => item.type === "text")?.text?.trim() ??
    json.content?.map((item) => item.text ?? "").join("\n").trim() ??
    "";
  return {
    text: text || "Пустой ответ модели.",
    inputTokens: json.usage?.input_tokens ?? estimateTokens(userText),
    outputTokens: json.usage?.output_tokens ?? estimateTokens(text || "ok"),
    route: "direct" as const,
  };
}

async function completeWithGemini(apiKey: string, model: string, userText: string) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userText }] }],
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Gemini error: ${response.status}`);
  }
  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = json.candidates?.[0]?.content?.parts?.map((item) => item.text ?? "").join("\n").trim() ?? "";
  return {
    text: text || "Пустой ответ модели.",
    inputTokens: json.usageMetadata?.promptTokenCount ?? estimateTokens(userText),
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? estimateTokens(text || "ok"),
    route: "direct" as const,
  };
}

async function completeWithOpenRouter(apiKey: string, model: string, systemPrompt: string, userText: string) {
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
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      temperature: 0.7,
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenRouter error: ${response.status}`);
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  const text = json.choices?.[0]?.message?.content?.trim() ?? "";
  return {
    text: text || "Пустой ответ модели.",
    inputTokens: json.usage?.prompt_tokens ?? estimateTokens(userText),
    outputTokens: json.usage?.completion_tokens ?? estimateTokens(text || "ok"),
    route: "openrouter" as const,
    resolvedModel: json.model ?? model,
  };
}

export async function ensureAssistantForAgent(tenantId: string, userId: string, agentId: string) {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, tenantId, deletedAt: null },
    include: {
      providerIntegration: true,
    },
  });
  if (!agent) {
    return null;
  }

  const existing = await prisma.assistant.findFirst({
    where: {
      tenantId,
      agentId: agent.id,
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    return { agent, assistant: existing };
  }

  const assistant = await prisma.assistant.create({
    data: {
      tenantId,
      createdById: userId,
      providerIntegrationId: agent.providerIntegrationId,
      agentId: agent.id,
      name: `${agent.name} Assistant`,
      systemPrompt: `You are assistant for agent "${agent.name}".`,
      status: "ACTIVE",
      settingsJson: {
        autogeneratedByAgentChat: true,
      },
    },
  });
  return { agent, assistant };
}

export async function buildAssistantReply(input: {
  tenantId: string;
  userId: string;
  agentId: string;
  userText: string;
  attachments: AttachmentRef[];
}) {
  const linked = await ensureAssistantForAgent(input.tenantId, input.userId, input.agentId);
  if (!linked) {
    throw new Error("AGENT_NOT_FOUND");
  }
  const { agent } = linked;
  const integration = agent.providerIntegration;
  const directKey = decodeSecret(integration.encryptedSecret);
  const settings = await prisma.systemSetting.findFirst({
    where: { tenantId: input.tenantId, key: "openrouter" },
  });
  const openRouterConfig = (settings?.value ?? {}) as {
    enabled?: boolean;
    apiKey?: string;
    model?: string;
    autoRouting?: boolean;
  };
  const openRouterEnabled = Boolean(openRouterConfig.enabled && openRouterConfig.apiKey);
  const agentConfig = (agent.configJson ?? {}) as { useOpenRouter?: boolean };
  const shouldUseOpenRouter = Boolean(
    openRouterEnabled && (agentConfig.useOpenRouter === true || openRouterConfig.autoRouting === true),
  );

  const userTextWithAttachments =
    input.attachments.length > 0
      ? `${input.userText}\n\nВложения:\n${input.attachments
          .map((file, index) => `${index + 1}. ${file.name} (${file.mimeType}, ${file.size} bytes)`)
          .join("\n")}`
      : input.userText;

  let result: {
    text: string;
    inputTokens: number;
    outputTokens: number;
    route: "direct" | "openrouter";
    resolvedModel?: string;
  };

  if (shouldUseOpenRouter) {
    result = await completeWithOpenRouter(
      String(openRouterConfig.apiKey),
      String(openRouterConfig.model || agent.model),
      `You are agent "${agent.name}".`,
      userTextWithAttachments,
    );
  } else {
    switch (integration.provider) {
      case "OPENAI":
        result = await completeWithOpenAi(directKey, agent.model, `You are agent "${agent.name}".`, userTextWithAttachments);
        break;
      case "ANTHROPIC":
        result = await completeWithAnthropic(directKey, agent.model, `You are agent "${agent.name}".`, userTextWithAttachments);
        break;
      case "GEMINI":
        result = await completeWithGemini(directKey, agent.model, userTextWithAttachments);
        break;
      default:
        result = {
          text: `Тестовый ответ (${integration.provider}) для агента "${agent.name}": ${input.userText}`,
          inputTokens: estimateTokens(userTextWithAttachments),
          outputTokens: estimateTokens(input.userText) + 12,
          route: "direct" as const,
        };
    }
  }

  return {
    ...linked,
    routeMode: result.route,
    responseText: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    providerForUsage: shouldUseOpenRouter ? "OPENAI" : integration.provider,
    modelForUsage: result.resolvedModel ?? (shouldUseOpenRouter ? String(openRouterConfig.model || agent.model) : agent.model),
  };
}
