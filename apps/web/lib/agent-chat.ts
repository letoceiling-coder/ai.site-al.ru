import { prisma } from "@ai/db";
import { buildKnowledgeContextForBases } from "@/lib/knowledge-context";
import { buildGroundedSystemPrompt } from "@/lib/knowledge-grounding";
import { resolveMaxContextCharsForBases } from "@/lib/knowledge-settings";
import {
  buildPersonaDirectives,
  extractAssistantSettings,
  extractGenerationOverrides,
  type AssistantGenerationOverrides,
} from "@/lib/assistant-settings";
import {
  extractAssistantTools,
  resolveEnabledTools,
  toAnthropicTools,
  toGeminiTools,
  toOpenAiTools,
  type AssistantToolsConfig,
  type ResolveToolsContext,
} from "@/lib/assistant-tools";
import { executeAssistantTool, type ToolEvent, type ToolExecContext } from "@/lib/assistant-tool-exec";
import {
  buildHandoffTargetsDirective,
  extractHandoffTargets,
  type AssistantHandoffTarget,
} from "@/lib/assistant-handoff-targets";
import { extractAssistantRouting } from "@/lib/dialog-handoff";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
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

type AttachmentPayload = AttachmentRef & {
  inlineBase64?: string;
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

async function toAttachmentPayload(
  tenantId: string,
  attachments: AttachmentRef[],
): Promise<AttachmentPayload[]> {
  const prepared: AttachmentPayload[] = [];
  for (const file of attachments.slice(0, 10)) {
    const next: AttachmentPayload = { ...file };
    const isImage = file.mimeType.startsWith("image/");
    const isTenantFile = file.url.startsWith(`/uploads/${tenantId}/`);
    if (!isImage || !isTenantFile || file.size > 5 * 1024 * 1024) {
      prepared.push(next);
      continue;
    }
    try {
      const normalized = normalize(file.url).replace(/\\/g, "/");
      if (!normalized.startsWith(`/uploads/${tenantId}/`) || normalized.includes("..")) {
        prepared.push(next);
        continue;
      }
      const relativePath = normalized.replace(/^\/+/, "");
      const absolute = join(process.cwd(), "public", relativePath);
      const bytes = await readFile(absolute);
      next.inlineBase64 = Buffer.from(bytes).toString("base64");
    } catch {
      // The file can still be referenced as metadata even if inline conversion failed.
    }
    prepared.push(next);
  }
  return prepared;
}

function buildAttachmentSummary(attachments: AttachmentPayload[]) {
  if (attachments.length === 0) {
    return "";
  }
  return attachments
    .map((file, index) => `${index + 1}. ${file.name} (${file.mimeType}, ${file.size} bytes)`)
    .join("\n");
}

const TOOL_LOOP_MAX_ITERATIONS = 3;

type ToolRuntime = {
  config: AssistantToolsConfig;
  execCtx: ToolExecContext;
  resolveCtx?: ResolveToolsContext;
};

type CompletionResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  route: "direct" | "openrouter";
  resolvedModel?: string;
  toolEvents: ToolEvent[];
};

function buildOpenAiUserContent(
  userText: string,
  attachments: AttachmentPayload[],
): Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> {
  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
    { type: "text", text: userText },
  ];
  for (const file of attachments) {
    if (!file.inlineBase64 || !file.mimeType.startsWith("image/")) {
      continue;
    }
    content.push({
      type: "image_url",
      image_url: { url: `data:${file.mimeType};base64,${file.inlineBase64}` },
    });
  }
  return content;
}

async function runOpenAiLikeLoop(
  endpoint: string,
  headers: Record<string, string>,
  routeLabel: "direct" | "openrouter",
  model: string,
  systemPrompt: string,
  userText: string,
  attachments: AttachmentPayload[],
  overrides: AssistantGenerationOverrides | undefined,
  tools: ToolRuntime | undefined,
  errLabel: string,
): Promise<CompletionResult> {
  const userContent = buildOpenAiUserContent(userText, attachments);
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
  const toolSpecs = tools ? toOpenAiTools(tools.config, tools.resolveCtx) : [];
  const toolEvents: ToolEvent[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let resolvedModel: string | undefined;

  for (let iter = 0; iter < TOOL_LOOP_MAX_ITERATIONS; iter += 1) {
    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature: overrides?.temperature ?? 0.7,
    };
    if (overrides?.maxTokens != null) {
      payload.max_tokens = overrides.maxTokens;
    }
    if (overrides?.topP != null) {
      payload.top_p = overrides.topP;
    }
    if (toolSpecs.length > 0) {
      payload.tools = toolSpecs;
      payload.tool_choice = "auto";
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`${errLabel} error: ${response.status}`);
    }
    const json = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    totalInput += json.usage?.prompt_tokens ?? 0;
    totalOutput += json.usage?.completion_tokens ?? 0;
    if (json.model) {
      resolvedModel = json.model;
    }
    const choice = json.choices?.[0];
    const msg = choice?.message ?? {};
    const toolCalls = msg.tool_calls ?? [];

    if (tools && toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: toolCalls,
      });
      for (const call of toolCalls) {
        const name = call.function?.name ?? "";
        let args: Record<string, unknown> = {};
        try {
          args = call.function?.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
        } catch {
          args = {};
        }
        const toolCfg = (tools.config as Record<string, import("@/lib/assistant-tools").AssistantToolConfig>)[name];
        const event = toolCfg
          ? await executeAssistantTool(name, args, toolCfg, tools.execCtx)
          : {
              toolName: name as "create_lead",
              inputJson: args,
              outputJson: { ok: false, error: "tool_not_configured" },
              resultText: "Инструмент не настроен на этом ассистенте.",
              status: "FAILED" as const,
            };
        toolEvents.push(event);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ ok: event.status === "COMPLETED", result: event.outputJson, summary: event.resultText }),
        });
      }
      continue;
    }

    const text = (typeof msg.content === "string" ? msg.content : "").trim();
    const fallbackInput = totalInput || estimateTokens(userText);
    const fallbackOutput = totalOutput || estimateTokens(text || "ok");
    return {
      text: text || "Пустой ответ модели.",
      inputTokens: fallbackInput,
      outputTokens: fallbackOutput,
      route: routeLabel,
      resolvedModel,
      toolEvents,
    };
  }

  return {
    text: "Достигнут лимит вызовов инструментов. Попробуй ещё раз или уточни запрос.",
    inputTokens: totalInput || estimateTokens(userText),
    outputTokens: totalOutput || 10,
    route: routeLabel,
    resolvedModel,
    toolEvents,
  };
}

async function completeWithOpenAi(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userText: string,
  attachments: AttachmentPayload[],
  overrides?: AssistantGenerationOverrides,
  tools?: ToolRuntime,
) {
  return runOpenAiLikeLoop(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${apiKey}` },
    "direct",
    model,
    systemPrompt,
    userText,
    attachments,
    overrides,
    tools,
    "OpenAI",
  );
}

async function completeWithOpenRouter(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userText: string,
  attachments: AttachmentPayload[],
  overrides?: AssistantGenerationOverrides,
  tools?: ToolRuntime,
) {
  return runOpenAiLikeLoop(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://ai.site-al.ru",
      "X-Title": "ai.site-al.ru",
    },
    "openrouter",
    model,
    systemPrompt,
    userText,
    attachments,
    overrides,
    tools,
    "OpenRouter",
  );
}

async function completeWithAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userText: string,
  attachments: AttachmentPayload[],
  overrides?: AssistantGenerationOverrides,
  tools?: ToolRuntime,
): Promise<CompletionResult> {
  type AnthropicContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

  const initialUserContent: AnthropicContentBlock[] = [{ type: "text", text: userText }];
  for (const file of attachments) {
    if (!file.inlineBase64 || !file.mimeType.startsWith("image/")) {
      continue;
    }
    initialUserContent.push({
      type: "image",
      source: { type: "base64", media_type: file.mimeType, data: file.inlineBase64 },
    });
  }
  const messages: Array<{ role: "user" | "assistant"; content: AnthropicContentBlock[] }> = [
    { role: "user", content: initialUserContent },
  ];
  const toolSpecs = tools ? toAnthropicTools(tools.config, tools.resolveCtx) : [];
  const toolEvents: ToolEvent[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  for (let iter = 0; iter < TOOL_LOOP_MAX_ITERATIONS; iter += 1) {
    const payload: Record<string, unknown> = {
      model,
      max_tokens: overrides?.maxTokens ?? 1024,
      system: systemPrompt,
      messages,
    };
    if (overrides?.temperature != null) {
      payload.temperature = overrides.temperature;
    }
    if (overrides?.topP != null) {
      payload.top_p = overrides.topP;
    }
    if (toolSpecs.length > 0) {
      payload.tools = toolSpecs;
    }
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Anthropic error: ${response.status}`);
    }
    const json = (await response.json()) as {
      content?: Array<
        | { type: "text"; text?: string }
        | { type: "tool_use"; id: string; name: string; input?: Record<string, unknown> }
      >;
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };
    totalInput += json.usage?.input_tokens ?? 0;
    totalOutput += json.usage?.output_tokens ?? 0;
    const blocks = Array.isArray(json.content) ? json.content : [];
    const toolUses = blocks.filter(
      (b): b is { type: "tool_use"; id: string; name: string; input?: Record<string, unknown> } =>
        (b as { type?: string }).type === "tool_use",
    );

    if (tools && toolUses.length > 0) {
      const assistantBlocks: AnthropicContentBlock[] = [];
      for (const b of blocks) {
        if (b.type === "text" && typeof b.text === "string") {
          assistantBlocks.push({ type: "text", text: b.text });
        } else if (b.type === "tool_use") {
          assistantBlocks.push({ type: "tool_use", id: b.id, name: b.name, input: b.input ?? {} });
        }
      }
      messages.push({ role: "assistant", content: assistantBlocks });
      const nextUserBlocks: AnthropicContentBlock[] = [];
      for (const use of toolUses) {
        const args = (use.input ?? {}) as Record<string, unknown>;
        const toolCfg = (tools.config as Record<string, import("@/lib/assistant-tools").AssistantToolConfig>)[use.name];
        const event = toolCfg
          ? await executeAssistantTool(use.name, args, toolCfg, tools.execCtx)
          : {
              toolName: use.name as "create_lead",
              inputJson: args,
              outputJson: { ok: false, error: "tool_not_configured" },
              resultText: "Инструмент не настроен.",
              status: "FAILED" as const,
            };
        toolEvents.push(event);
        nextUserBlocks.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify({
            ok: event.status === "COMPLETED",
            result: event.outputJson,
            summary: event.resultText,
          }),
          is_error: event.status !== "COMPLETED",
        });
      }
      messages.push({ role: "user", content: nextUserBlocks });
      continue;
    }

    const text = blocks
      .filter((b): b is { type: "text"; text?: string } => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n")
      .trim();
    return {
      text: text || "Пустой ответ модели.",
      inputTokens: totalInput || estimateTokens(userText),
      outputTokens: totalOutput || estimateTokens(text || "ok"),
      route: "direct",
      toolEvents,
    };
  }

  return {
    text: "Достигнут лимит вызовов инструментов. Попробуй ещё раз или уточни запрос.",
    inputTokens: totalInput || estimateTokens(userText),
    outputTokens: totalOutput || 10,
    route: "direct",
    toolEvents,
  };
}

async function completeWithGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userText: string,
  attachments: AttachmentPayload[],
  overrides?: AssistantGenerationOverrides,
  tools?: ToolRuntime,
): Promise<CompletionResult> {
  type GeminiPart =
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
    | { functionCall: { name: string; args?: Record<string, unknown> } }
    | { functionResponse: { name: string; response: Record<string, unknown> } };

  const initialParts: GeminiPart[] = [{ text: userText }];
  for (const file of attachments) {
    if (!file.inlineBase64 || !file.mimeType.startsWith("image/")) {
      continue;
    }
    initialParts.push({ inlineData: { mimeType: file.mimeType, data: file.inlineBase64 } });
  }
  const contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [
    { role: "user", parts: initialParts },
  ];
  const toolSpecs = tools ? toGeminiTools(tools.config, tools.resolveCtx) : [];
  const toolEvents: ToolEvent[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  for (let iter = 0; iter < TOOL_LOOP_MAX_ITERATIONS; iter += 1) {
    const generationConfig: Record<string, unknown> = {};
    if (overrides?.temperature != null) generationConfig.temperature = overrides.temperature;
    if (overrides?.maxTokens != null) generationConfig.maxOutputTokens = overrides.maxTokens;
    if (overrides?.topP != null) generationConfig.topP = overrides.topP;
    const body: Record<string, unknown> = {
      contents,
      systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
    };
    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }
    if (toolSpecs.length > 0) {
      body.tools = toolSpecs;
    }
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      throw new Error(`Gemini error: ${response.status}`);
    }
    const json = (await response.json()) as {
      candidates?: Array<{
        content?: {
          role?: string;
          parts?: Array<{
            text?: string;
            functionCall?: { name?: string; args?: Record<string, unknown> };
          }>;
        };
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    totalInput += json.usageMetadata?.promptTokenCount ?? 0;
    totalOutput += json.usageMetadata?.candidatesTokenCount ?? 0;
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const functionCalls = parts
      .map((p) => p.functionCall)
      .filter((c): c is { name?: string; args?: Record<string, unknown> } => Boolean(c?.name));

    if (tools && functionCalls.length > 0) {
      const modelParts: GeminiPart[] = parts
        .map((p): GeminiPart | null => {
          if (typeof p.text === "string" && p.text) {
            return { text: p.text };
          }
          if (p.functionCall?.name) {
            return { functionCall: { name: p.functionCall.name, args: p.functionCall.args ?? {} } };
          }
          return null;
        })
        .filter((p): p is GeminiPart => p !== null);
      contents.push({ role: "model", parts: modelParts });

      const responseParts: GeminiPart[] = [];
      for (const call of functionCalls) {
        const name = call.name ?? "";
        const args = (call.args ?? {}) as Record<string, unknown>;
        const toolCfg = (tools.config as Record<string, import("@/lib/assistant-tools").AssistantToolConfig>)[name];
        const event = toolCfg
          ? await executeAssistantTool(name, args, toolCfg, tools.execCtx)
          : {
              toolName: name as "create_lead",
              inputJson: args,
              outputJson: { ok: false, error: "tool_not_configured" },
              resultText: "Инструмент не настроен.",
              status: "FAILED" as const,
            };
        toolEvents.push(event);
        responseParts.push({
          functionResponse: {
            name,
            response: {
              ok: event.status === "COMPLETED",
              result: event.outputJson,
              summary: event.resultText,
            },
          },
        });
      }
      contents.push({ role: "user", parts: responseParts });
      continue;
    }

    const text = parts
      .map((p) => p.text ?? "")
      .join("\n")
      .trim();
    return {
      text: text || "Пустой ответ модели.",
      inputTokens: totalInput || estimateTokens(userText),
      outputTokens: totalOutput || estimateTokens(text || "ok"),
      route: "direct",
      toolEvents,
    };
  }

  return {
    text: "Достигнут лимит вызовов инструментов. Попробуй ещё раз или уточни запрос.",
    inputTokens: totalInput || estimateTokens(userText),
    outputTokens: totalOutput || 10,
    route: "direct",
    toolEvents,
  };
}

type ResolvedHandoffTarget = { assistantId: string; name: string; description?: string };

async function resolveHandoffTargets(
  tenantId: string,
  configured: AssistantHandoffTarget[],
  selfAssistantId: string,
): Promise<ResolvedHandoffTarget[]> {
  const ids = Array.from(
    new Set(
      configured
        .map((t) => t.assistantId)
        .filter((id) => id && id !== selfAssistantId),
    ),
  );
  if (ids.length === 0) {
    return [];
  }
  const rows = await prisma.assistant.findMany({
    where: { id: { in: ids }, tenantId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  const byId = new Map<string, string>();
  for (const r of rows as Array<{ id: string; name: string }>) {
    byId.set(r.id, r.name);
  }
  const out: ResolvedHandoffTarget[] = [];
  for (const t of configured) {
    const name = byId.get(t.assistantId);
    if (!name) continue;
    out.push({ assistantId: t.assistantId, name, description: t.description });
  }
  return out;
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
    include: { knowledgeLinks: { select: { knowledgeBaseId: true } } },
  });
  if (existing) {
    return { agent, assistant: existing };
  }

  const created = await prisma.assistant.create({
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
  const assistant = await prisma.assistant.findFirstOrThrow({
    where: { id: created.id },
    include: { knowledgeLinks: { select: { knowledgeBaseId: true } } },
  });
  return { agent, assistant };
}

export async function buildAssistantReply(input: {
  tenantId: string;
  userId: string;
  agentId: string;
  userText: string;
  attachments: AttachmentRef[];
  dialogId?: string;
}) {
  const linked = await ensureAssistantForAgent(input.tenantId, input.userId, input.agentId);
  if (!linked) {
    throw new Error("AGENT_NOT_FOUND");
  }
  const { agent } = linked;
  let assistant = linked.assistant;

  if (input.dialogId) {
    const dialogForRouting = await prisma.dialog.findFirst({
      where: { id: input.dialogId, tenantId: input.tenantId },
      select: { metadata: true },
    });
    const activeId = dialogForRouting
      ? extractAssistantRouting(dialogForRouting.metadata).activeAssistantId
      : null;
    if (activeId && activeId !== assistant.id) {
      const overrideAssistant = await prisma.assistant.findFirst({
        where: { id: activeId, tenantId: input.tenantId, deletedAt: null, status: "ACTIVE" },
        include: { knowledgeLinks: { select: { knowledgeBaseId: true } } },
      });
      if (overrideAssistant) {
        assistant = overrideAssistant;
      }
    }
  }
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

  const preparedAttachments = await toAttachmentPayload(input.tenantId, input.attachments);
  const attachmentSummary = buildAttachmentSummary(preparedAttachments);
  const userTextWithAttachments =
    input.attachments.length > 0
      ? `${input.userText}\n\nВложения:\n${attachmentSummary}`
      : input.userText;

  const kbIds = assistant.knowledgeLinks.map((l: { knowledgeBaseId: string }) => l.knowledgeBaseId);
  const kbResolved =
    kbIds.length > 0
      ? await resolveMaxContextCharsForBases(input.tenantId, kbIds)
      : { maxChars: 12_000, grounding: "strict" as const };
  const kbText =
    kbIds.length > 0
      ? await buildKnowledgeContextForBases(input.tenantId, kbIds, input.userText, kbResolved.maxChars).catch(() => "")
      : "";
  const persona = extractAssistantSettings(assistant.settingsJson);
  const personaDirectives = buildPersonaDirectives(persona);
  const configuredHandoffs = extractHandoffTargets(assistant.settingsJson);
  const resolvedHandoffs = await resolveHandoffTargets(input.tenantId, configuredHandoffs, assistant.id);
  const handoffDirective = buildHandoffTargetsDirective(resolvedHandoffs);
  const basePrompt =
    `You are agent "${agent.name}".` +
    (personaDirectives ? `\n\n${personaDirectives}` : "") +
    (handoffDirective ? `\n\n${handoffDirective}` : "");
  const systemForModel = buildGroundedSystemPrompt(basePrompt, kbText, kbResolved.grounding);

  const assistantOverrides = extractGenerationOverrides(assistant.settingsJson);
  const overrides: AssistantGenerationOverrides = {
    temperature: assistantOverrides.temperature ?? agent.temperature ?? null,
    maxTokens: assistantOverrides.maxTokens ?? agent.maxTokens ?? null,
    topP: assistantOverrides.topP,
  };

  const toolsConfig = extractAssistantTools(assistant.settingsJson);
  const resolveCtx: ResolveToolsContext = { handoffTargets: resolvedHandoffs };
  const hasEnabledTools = resolveEnabledTools(toolsConfig, resolveCtx).length > 0;
  const toolRuntime: ToolRuntime | undefined = hasEnabledTools
    ? {
        config: toolsConfig,
        execCtx: {
          tenantId: input.tenantId,
          assistantId: assistant.id,
          assistantName: assistant.name,
          dialogId: input.dialogId,
          knowledgeBaseIds: kbIds,
          handoffTargets: resolvedHandoffs,
        },
        resolveCtx,
      }
    : undefined;

  let result: CompletionResult;

  if (shouldUseOpenRouter) {
    result = await completeWithOpenRouter(
      String(openRouterConfig.apiKey),
      String(openRouterConfig.model || agent.model),
      systemForModel,
      userTextWithAttachments,
      preparedAttachments,
      overrides,
      toolRuntime,
    );
  } else {
    switch (integration.provider) {
      case "OPENAI":
        result = await completeWithOpenAi(
          directKey,
          agent.model,
          systemForModel,
          userTextWithAttachments,
          preparedAttachments,
          overrides,
          toolRuntime,
        );
        break;
      case "ANTHROPIC":
        result = await completeWithAnthropic(
          directKey,
          agent.model,
          systemForModel,
          userTextWithAttachments,
          preparedAttachments,
          overrides,
          toolRuntime,
        );
        break;
      case "GEMINI":
        result = await completeWithGemini(
          directKey,
          agent.model,
          systemForModel,
          userTextWithAttachments,
          preparedAttachments,
          overrides,
          toolRuntime,
        );
        break;
      default:
        result = {
          text: `Тестовый ответ (${integration.provider}) для агента "${agent.name}": ${input.userText}`,
          inputTokens: estimateTokens(userTextWithAttachments),
          outputTokens: estimateTokens(input.userText) + 12,
          route: "direct" as const,
          toolEvents: [],
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
    toolEvents: result.toolEvents,
  };
}

/**
 * Прямой тест-чат по сущности Assistant (страница «Ассистенты»), без агента как обязательного.
 */
export async function buildAssistantReplyForUserAssistant(input: {
  tenantId: string;
  assistantId: string;
  userText: string;
  attachments: AttachmentRef[];
  dialogId?: string;
}) {
  const record = await prisma.assistant.findFirst({
    where: { id: input.assistantId, tenantId: input.tenantId, deletedAt: null },
    include: {
      providerIntegration: true,
      agent: { include: { providerIntegration: true } },
      knowledgeLinks: { select: { knowledgeBaseId: true } },
    },
  });
  if (!record) {
    throw new Error("ASSISTANT_NOT_FOUND");
  }
  const assistant = record;

  const aSettings = (assistant.settingsJson ?? {}) as {
    useOpenRouter?: boolean;
    model?: string;
  };
  const integration = assistant.providerIntegration;
  const directKey = decodeSecret(integration.encryptedSecret);

  const linkAgent = assistant.agent;
  const resolvedModelFromAgent = linkAgent?.model?.trim() || "";
  const resolvedModelFromSettings = typeof aSettings.model === "string" ? aSettings.model.trim() : "";

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
  const shouldUseOpenRouter = Boolean(
    openRouterEnabled &&
      (aSettings.useOpenRouter === true || openRouterConfig.autoRouting === true),
  );

  const model = resolvedModelFromAgent || resolvedModelFromSettings || String(openRouterConfig.model || "gpt-4.1-mini");
  const kbIds = assistant.knowledgeLinks.map((l: { knowledgeBaseId: string }) => l.knowledgeBaseId);
  const kbResolved =
    kbIds.length > 0
      ? await resolveMaxContextCharsForBases(input.tenantId, kbIds)
      : { maxChars: 12_000, grounding: "strict" as const };
  const kbText = await buildKnowledgeContextForBases(
    input.tenantId,
    kbIds,
    input.userText,
    kbResolved.maxChars,
  ).catch(() => "");
  const persona = extractAssistantSettings(assistant.settingsJson);
  const personaDirectives = buildPersonaDirectives(persona);
  const configuredHandoffs = extractHandoffTargets(assistant.settingsJson);
  const resolvedHandoffs = await resolveHandoffTargets(input.tenantId, configuredHandoffs, assistant.id);
  const handoffDirective = buildHandoffTargetsDirective(resolvedHandoffs);
  const baseSystemRaw = assistant.systemPrompt.trim() || "You are a helpful assistant.";
  const baseSystem =
    baseSystemRaw +
    (personaDirectives ? `\n\n${personaDirectives}` : "") +
    (handoffDirective ? `\n\n${handoffDirective}` : "");
  const systemForModel = buildGroundedSystemPrompt(baseSystem, kbText, kbResolved.grounding);

  const assistantOverrides = extractGenerationOverrides(assistant.settingsJson);
  const agentOverrides = linkAgent
    ? {
        temperature: linkAgent.temperature ?? null,
        maxTokens: linkAgent.maxTokens ?? null,
        topP: null,
      }
    : { temperature: null, maxTokens: null, topP: null };
  const overrides: AssistantGenerationOverrides = {
    temperature: assistantOverrides.temperature ?? agentOverrides.temperature,
    maxTokens: assistantOverrides.maxTokens ?? agentOverrides.maxTokens,
    topP: assistantOverrides.topP ?? agentOverrides.topP,
  };

  const toolsConfig = extractAssistantTools(assistant.settingsJson);
  const resolveCtx: ResolveToolsContext = { handoffTargets: resolvedHandoffs };
  const hasEnabledTools = resolveEnabledTools(toolsConfig, resolveCtx).length > 0;
  const toolRuntime: ToolRuntime | undefined = hasEnabledTools
    ? {
        config: toolsConfig,
        execCtx: {
          tenantId: input.tenantId,
          assistantId: assistant.id,
          assistantName: assistant.name,
          dialogId: input.dialogId,
          knowledgeBaseIds: kbIds,
          handoffTargets: resolvedHandoffs,
        },
        resolveCtx,
      }
    : undefined;

  const preparedAttachments = await toAttachmentPayload(input.tenantId, input.attachments);
  const attachmentSummary = buildAttachmentSummary(preparedAttachments);
  const userTextWithAttachments =
    input.attachments.length > 0
      ? `${input.userText}\n\nВложения:\n${attachmentSummary}`
      : input.userText;

  let result: CompletionResult;

  if (shouldUseOpenRouter) {
    result = await completeWithOpenRouter(
      String(openRouterConfig.apiKey),
      String(openRouterConfig.model || model),
      systemForModel,
      userTextWithAttachments,
      preparedAttachments,
      overrides,
      toolRuntime,
    );
  } else {
    switch (integration.provider) {
      case "OPENAI":
        result = await completeWithOpenAi(directKey, model, systemForModel, userTextWithAttachments, preparedAttachments, overrides, toolRuntime);
        break;
      case "ANTHROPIC":
        result = await completeWithAnthropic(directKey, model, systemForModel, userTextWithAttachments, preparedAttachments, overrides, toolRuntime);
        break;
      case "GEMINI":
        result = await completeWithGemini(directKey, model, systemForModel, userTextWithAttachments, preparedAttachments, overrides, toolRuntime);
        break;
      default:
        result = {
          text: `Тестовый ответ (${integration.provider}) для ассистента «${assistant.name}»: ${input.userText}`,
          inputTokens: estimateTokens(userTextWithAttachments),
          outputTokens: estimateTokens(input.userText) + 12,
          route: "direct" as const,
          toolEvents: [],
        };
    }
  }

  return {
    assistant,
    routeMode: result.route,
    responseText: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    providerForUsage: shouldUseOpenRouter ? "OPENAI" : integration.provider,
    modelForUsage: result.resolvedModel ?? (shouldUseOpenRouter ? String(openRouterConfig.model || model) : model),
    toolEvents: result.toolEvents,
  };
}
