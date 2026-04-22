import { prisma } from "@ai/db";
import { BUILTIN_TOOLS, type AssistantToolId, type AssistantToolConfig } from "@/lib/assistant-tools";

export type ToolEvent = {
  toolName: AssistantToolId;
  inputJson: Record<string, unknown>;
  outputJson: Record<string, unknown>;
  /** Лаконичная строка, которая пойдёт модели назад как tool_result. */
  resultText: string;
  status: "COMPLETED" | "FAILED";
};

export type ToolExecContext = {
  tenantId: string;
  assistantId: string;
  assistantName: string;
  dialogId?: string;
};

function stringOrEmpty(v: unknown): string {
  if (typeof v !== "string") {
    return "";
  }
  return v.trim();
}

function sanitizePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "").slice(0, 32);
}

function isPublicHttpUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return false;
    }
    const host = u.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local")) {
      return false;
    }
    if (host === "0.0.0.0" || host === "::1" || host.startsWith("127.")) {
      return false;
    }
    if (/^10\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false;
    if (host.startsWith("fc") || host.startsWith("fd")) return false;
    return true;
  } catch {
    return false;
  }
}

async function fireWebhook(
  url: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status?: number; errorText?: string }> {
  if (!url || !isPublicHttpUrl(url)) {
    return { ok: false, errorText: "invalid_or_private_url" };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ai.site-al.ru assistant-tool-webhook/1.0",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return { ok: false, status: response.status, errorText: errText.slice(0, 300) };
    }
    return { ok: true, status: response.status };
  } catch (err) {
    const errText = err instanceof Error ? err.message : "webhook_error";
    return { ok: false, errorText: errText.slice(0, 300) };
  }
}

/** create_lead: сохранить запись в таблице Lead + webhook. */
async function execCreateLead(
  args: Record<string, unknown>,
  config: AssistantToolConfig,
  ctx: ToolExecContext,
): Promise<ToolEvent> {
  const fullName = stringOrEmpty(args.fullName).slice(0, 200);
  const phone = sanitizePhone(stringOrEmpty(args.phone)) || null;
  const email = stringOrEmpty(args.email).slice(0, 200) || null;
  const message = stringOrEmpty(args.message).slice(0, 2000);
  const productInterest = stringOrEmpty(args.productInterest).slice(0, 400);

  if (!fullName) {
    return {
      toolName: "create_lead",
      inputJson: args,
      outputJson: { ok: false, error: "fullName_required" },
      resultText: "Не удалось создать заявку: не указано имя.",
      status: "FAILED",
    };
  }
  if (!phone && !email) {
    return {
      toolName: "create_lead",
      inputJson: args,
      outputJson: { ok: false, error: "contact_required" },
      resultText: "Не удалось создать заявку: нужен хотя бы один контакт (телефон или email).",
      status: "FAILED",
    };
  }

  const lead = await prisma.lead.create({
    data: {
      tenantId: ctx.tenantId,
      fullName,
      phone,
      email,
      source: `assistant:${ctx.assistantId}`,
      status: "NEW",
      payload: {
        kind: "create_lead",
        assistantId: ctx.assistantId,
        assistantName: ctx.assistantName,
        dialogId: ctx.dialogId ?? null,
        message,
        productInterest,
        rawArgs: args,
      },
    },
  });

  let webhook: ReturnType<typeof fireWebhook> extends Promise<infer R> ? R : never = { ok: false };
  if (config.webhookUrl) {
    webhook = await fireWebhook(config.webhookUrl, {
      event: "assistant.tool.create_lead",
      leadId: lead.id,
      tenantId: ctx.tenantId,
      assistantId: ctx.assistantId,
      assistantName: ctx.assistantName,
      dialogId: ctx.dialogId ?? null,
      fullName,
      phone,
      email,
      message,
      productInterest,
      createdAt: lead.createdAt.toISOString(),
    });
  }

  return {
    toolName: "create_lead",
    inputJson: args,
    outputJson: {
      ok: true,
      leadId: lead.id,
      webhook: config.webhookUrl ? webhook : null,
      notifyEmail: config.notifyEmail || null,
    },
    resultText: `Заявка создана (id=${lead.id}). Сообщи пользователю короткое подтверждение.`,
    status: "COMPLETED",
  };
}

/** handoff_to_operator: логируется как ToolCall позднее; здесь — вернуть готовый payload. */
async function execHandoff(
  args: Record<string, unknown>,
  config: AssistantToolConfig,
  ctx: ToolExecContext,
): Promise<ToolEvent> {
  const reason = stringOrEmpty(args.reason).slice(0, 1000);
  const urgency = stringOrEmpty(args.urgency).toLowerCase();
  const normalizedUrgency = ["low", "normal", "high"].includes(urgency) ? urgency : "normal";
  const summary = stringOrEmpty(args.summary).slice(0, 2000);

  if (!reason) {
    return {
      toolName: "handoff_to_operator",
      inputJson: args,
      outputJson: { ok: false, error: "reason_required" },
      resultText: "Не удалось эскалировать: не указана причина.",
      status: "FAILED",
    };
  }

  let webhook: ReturnType<typeof fireWebhook> extends Promise<infer R> ? R : never = { ok: false };
  if (config.webhookUrl) {
    webhook = await fireWebhook(config.webhookUrl, {
      event: "assistant.tool.handoff_to_operator",
      tenantId: ctx.tenantId,
      assistantId: ctx.assistantId,
      assistantName: ctx.assistantName,
      dialogId: ctx.dialogId ?? null,
      reason,
      urgency: normalizedUrgency,
      summary,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    toolName: "handoff_to_operator",
    inputJson: args,
    outputJson: {
      ok: true,
      urgency: normalizedUrgency,
      webhook: config.webhookUrl ? webhook : null,
      notifyEmail: config.notifyEmail || null,
    },
    resultText:
      "Диалог помечен для передачи живому оператору. Коротко попрощайся с пользователем и сообщи, что оператор " +
      "скоро подключится.",
    status: "COMPLETED",
  };
}

/** schedule_callback: сохраняется как Lead с source=callback + payload.preferredTime. */
async function execScheduleCallback(
  args: Record<string, unknown>,
  config: AssistantToolConfig,
  ctx: ToolExecContext,
): Promise<ToolEvent> {
  const fullName = stringOrEmpty(args.fullName).slice(0, 200) || "Без имени";
  const phone = sanitizePhone(stringOrEmpty(args.phone));
  const preferredTime = stringOrEmpty(args.preferredTime).slice(0, 200);
  const purpose = stringOrEmpty(args.purpose).slice(0, 1000);

  if (!phone) {
    return {
      toolName: "schedule_callback",
      inputJson: args,
      outputJson: { ok: false, error: "phone_required" },
      resultText: "Не удалось записать обратный звонок: не указан телефон.",
      status: "FAILED",
    };
  }
  if (!preferredTime) {
    return {
      toolName: "schedule_callback",
      inputJson: args,
      outputJson: { ok: false, error: "preferredTime_required" },
      resultText: "Не удалось записать обратный звонок: не указано удобное время.",
      status: "FAILED",
    };
  }

  const lead = await prisma.lead.create({
    data: {
      tenantId: ctx.tenantId,
      fullName,
      phone,
      email: null,
      source: `callback:${ctx.assistantId}`,
      status: "NEW",
      payload: {
        kind: "schedule_callback",
        assistantId: ctx.assistantId,
        assistantName: ctx.assistantName,
        dialogId: ctx.dialogId ?? null,
        preferredTime,
        purpose,
        rawArgs: args,
      },
    },
  });

  let webhook: ReturnType<typeof fireWebhook> extends Promise<infer R> ? R : never = { ok: false };
  if (config.webhookUrl) {
    webhook = await fireWebhook(config.webhookUrl, {
      event: "assistant.tool.schedule_callback",
      leadId: lead.id,
      tenantId: ctx.tenantId,
      assistantId: ctx.assistantId,
      assistantName: ctx.assistantName,
      dialogId: ctx.dialogId ?? null,
      fullName,
      phone,
      preferredTime,
      purpose,
      createdAt: lead.createdAt.toISOString(),
    });
  }

  return {
    toolName: "schedule_callback",
    inputJson: args,
    outputJson: {
      ok: true,
      leadId: lead.id,
      webhook: config.webhookUrl ? webhook : null,
      notifyEmail: config.notifyEmail || null,
    },
    resultText:
      `Заявка на обратный звонок сохранена (id=${lead.id}). Подтверди пользователю, что перезвоним в указанное время.`,
    status: "COMPLETED",
  };
}

export async function executeAssistantTool(
  name: string,
  args: Record<string, unknown>,
  config: AssistantToolConfig,
  ctx: ToolExecContext,
): Promise<ToolEvent> {
  if (!config.enabled) {
    return {
      toolName: name as AssistantToolId,
      inputJson: args,
      outputJson: { ok: false, error: "tool_disabled" },
      resultText: "Инструмент отключён. Отвечай без вызова.",
      status: "FAILED",
    };
  }
  const known = BUILTIN_TOOLS.find((t) => t.id === name);
  if (!known) {
    return {
      toolName: name as AssistantToolId,
      inputJson: args,
      outputJson: { ok: false, error: "unknown_tool" },
      resultText: "Неизвестный инструмент.",
      status: "FAILED",
    };
  }
  switch (known.id) {
    case "create_lead":
      return execCreateLead(args, config, ctx);
    case "handoff_to_operator":
      return execHandoff(args, config, ctx);
    case "schedule_callback":
      return execScheduleCallback(args, config, ctx);
    default:
      return {
        toolName: name as AssistantToolId,
        inputJson: args,
        outputJson: { ok: false, error: "not_implemented" },
        resultText: "Обработчик не реализован.",
        status: "FAILED",
      };
  }
}
