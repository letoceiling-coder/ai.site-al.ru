import type { Prisma } from "@prisma/client";
import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { isConnectedIntegration } from "@/lib/tenant-ai-integrations";
import {
  mergeAssistantSettings,
  mergeGenerationOverrides,
  normalizeGenerationOverrides,
} from "@/lib/assistant-settings";
import { mergeAssistantTools, normalizeAssistantTools } from "@/lib/assistant-tools";
import { mergeHandoffTargets, normalizeHandoffTargets } from "@/lib/assistant-handoff-targets";

type Context = { params: Promise<{ assistantId: string }> };
type AssistantStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

type UpdatePayload = {
  name?: unknown;
  systemPrompt?: unknown;
  providerIntegrationId?: unknown;
  agentId?: unknown;
  status?: unknown;
  knowledgeBaseIds?: unknown;
  model?: unknown;
  persona?: unknown;
  generation?: unknown;
  tools?: unknown;
  handoffTargets?: unknown;
};

function isAssistantStatus(value: unknown): value is AssistantStatus {
  return value === "DRAFT" || value === "ACTIVE" || value === "ARCHIVED";
}

function parseKnowledgeBaseIds(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim())
    .slice(0, 20);
}

async function resolveRealIntegrationId(
  tenantId: string,
  providerIntegrationId: string,
): Promise<
  | { ok: true; id: string; useOpenRouter: boolean }
  | { ok: false; response: ReturnType<typeof fail> }
> {
  if (providerIntegrationId === "openrouter") {
    const setting = await prisma.systemSetting.findFirst({
      where: { tenantId, key: "openrouter" },
      select: { value: true },
    });
    const value = (setting?.value ?? {}) as { enabled?: boolean; lastTestOk?: boolean };
    if (!value.enabled || !value.lastTestOk) {
      return {
        ok: false,
        response: fail(
          "OpenRouter не подключен. Сначала сохраните и протестируйте его в Интеграции AI.",
          "VALIDATION_ERROR",
          400,
        ),
      };
    }
    const integration = await prisma.providerIntegration.findFirst({
      where: { tenantId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true, encryptedSecret: true, metadata: true },
    });
    if (!integration || !isConnectedIntegration(integration)) {
      return {
        ok: false,
        response: fail(
          "Нет активной интеграции для OpenRouter. Сначала подключите провайдера в Интеграции AI.",
          "VALIDATION_ERROR",
          400,
        ),
      };
    }
    return { ok: true, id: integration.id, useOpenRouter: true };
  }
  const integration = await prisma.providerIntegration.findFirst({
    where: { id: providerIntegrationId, tenantId },
    select: { id: true, status: true, encryptedSecret: true, metadata: true },
  });
  if (!integration) {
    return { ok: false, response: fail("Интеграция не найдена", "NOT_FOUND", 404) };
  }
  if (!isConnectedIntegration(integration)) {
    return {
      ok: false,
      response: fail(
        "Интеграция не подключена. Сначала выполните успешный тест в разделе Интеграции AI.",
        "VALIDATION_ERROR",
        400,
      ),
    };
  }
  return { ok: true, id: integration.id, useOpenRouter: false };
}

export async function PUT(request: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { assistantId } = await context.params;
  const existing = await prisma.assistant.findFirst({
    where: { id: assistantId, tenantId: auth.tenantId, deletedAt: null },
  });
  if (!existing) {
    return fail("Ассистент не найден", "NOT_FOUND", 404);
  }

  const body = (await request.json().catch(() => ({}))) as UpdatePayload;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return fail("Поле «Наименование» не может быть пустым", "VALIDATION_ERROR", 400);
    }
    data.name = name;
  }
  if (typeof body.systemPrompt === "string") {
    const systemPrompt = body.systemPrompt.trim();
    if (!systemPrompt) {
      return fail("Поле «Системный промпт» не может быть пустым", "VALIDATION_ERROR", 400);
    }
    if (systemPrompt !== existing.systemPrompt) {
      data.systemPrompt = systemPrompt;
      data.version = { increment: 1 };
      const base =
        existing.settingsJson && typeof existing.settingsJson === "object" && !Array.isArray(existing.settingsJson)
          ? ({ ...(existing.settingsJson as Record<string, unknown>) } as Record<string, unknown>)
          : ({} as Record<string, unknown>);
      const history = Array.isArray(base.promptHistory) ? [...(base.promptHistory as unknown[])] : [];
      history.unshift({
        version: existing.version,
        prompt: existing.systemPrompt,
        createdAt: new Date().toISOString(),
        author: auth.userId,
      });
      base.promptHistory = history.slice(0, 20);
      data.settingsJson = base;
    }
  }
  if (isAssistantStatus(body.status)) {
    data.status = body.status;
  }

  const currentSettings = (existing.settingsJson ?? {}) as Record<string, unknown>;

  if (body.agentId !== undefined) {
    const raw = typeof body.agentId === "string" ? body.agentId.trim() : "";
    if (raw) {
      const agent = await prisma.agent.findFirst({
        where: { id: raw, tenantId: auth.tenantId, deletedAt: null },
        select: { id: true, providerIntegrationId: true },
      });
      if (!agent) {
        return fail("Агент не найден", "NOT_FOUND", 404);
      }
      const resolved = await resolveRealIntegrationId(auth.tenantId, agent.providerIntegrationId);
      if (!resolved.ok) {
        return resolved.response;
      }
      data.providerIntegrationId = resolved.id;
      data.agentId = agent.id;
      const { model: _drop, ...rest } = currentSettings;
      data.settingsJson = { ...rest, useOpenRouter: resolved.useOpenRouter };
    } else {
      const providerIntegrationId =
        typeof body.providerIntegrationId === "string" ? body.providerIntegrationId.trim() : "";
      const modelTrim = typeof body.model === "string" ? body.model.trim() : "";
      if (!providerIntegrationId) {
        return fail("Без агента укажите интеграцию", "VALIDATION_ERROR", 400);
      }
      if (!modelTrim) {
        return fail("Без агента укажите модель", "VALIDATION_ERROR", 400);
      }
      const resolved = await resolveRealIntegrationId(auth.tenantId, providerIntegrationId);
      if (!resolved.ok) {
        return resolved.response;
      }
      data.providerIntegrationId = resolved.id;
      data.agentId = null;
      data.settingsJson = { ...currentSettings, useOpenRouter: resolved.useOpenRouter, model: modelTrim };
    }
  } else if (typeof body.providerIntegrationId === "string") {
    const resolved = await resolveRealIntegrationId(auth.tenantId, body.providerIntegrationId.trim());
    if (!resolved.ok) {
      return resolved.response;
    }
    data.providerIntegrationId = resolved.id;
    data.settingsJson = {
      ...(data.settingsJson ?? currentSettings),
      useOpenRouter: resolved.useOpenRouter,
    };
  }

  if (body.agentId === undefined && typeof body.model === "string") {
    const base = (data.settingsJson ?? currentSettings) as Record<string, unknown>;
    const cur = { ...base };
    const m = body.model.trim();
    if (m) {
      cur.model = m;
    } else {
      delete cur.model;
    }
    data.settingsJson = cur;
  }

  if (body.persona !== undefined) {
    const current = (data.settingsJson ?? currentSettings) as Record<string, unknown>;
    const personaPayload =
      body.persona && typeof body.persona === "object" && !Array.isArray(body.persona)
        ? (body.persona as Record<string, unknown>)
        : {};
    data.settingsJson = mergeAssistantSettings(current, personaPayload);
  }

  if (body.generation !== undefined) {
    const current = (data.settingsJson ?? currentSettings) as Record<string, unknown>;
    const gen = body.generation && typeof body.generation === "object" && !Array.isArray(body.generation)
      ? normalizeGenerationOverrides(body.generation)
      : normalizeGenerationOverrides({});
    data.settingsJson = mergeGenerationOverrides(current, gen);
  }

  if (body.tools !== undefined) {
    const current = (data.settingsJson ?? currentSettings) as Record<string, unknown>;
    const toolsPayload = body.tools && typeof body.tools === "object" && !Array.isArray(body.tools)
      ? normalizeAssistantTools(body.tools)
      : normalizeAssistantTools({});
    data.settingsJson = mergeAssistantTools(current, toolsPayload);
  }

  if (body.handoffTargets !== undefined) {
    const current = (data.settingsJson ?? currentSettings) as Record<string, unknown>;
    const targets = normalizeHandoffTargets(body.handoffTargets);
    data.settingsJson = mergeHandoffTargets(current, targets);
  }

  const kbIds = parseKnowledgeBaseIds(body.knowledgeBaseIds);
  if (kbIds !== undefined) {
    if (kbIds.length) {
      const count = await prisma.knowledgeBase.count({
        where: { tenantId: auth.tenantId, deletedAt: null, id: { in: kbIds } },
      });
      if (count !== kbIds.length) {
        return fail("Одна или несколько баз знаний не найдены", "VALIDATION_ERROR", 400);
      }
    }
  }

  if (Object.keys(data).length === 0 && kbIds === undefined) {
    return fail("Нет полей для обновления", "VALIDATION_ERROR", 400);
  }

  const item = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (Object.keys(data).length > 0) {
      await tx.assistant.update({
        where: { id: assistantId },
        data,
      });
    }
    if (kbIds !== undefined) {
      await tx.assistantKnowledgeBase.deleteMany({ where: { assistantId, tenantId: auth.tenantId } });
      if (kbIds.length) {
        await tx.assistantKnowledgeBase.createMany({
          data: kbIds.map((knowledgeBaseId) => ({
            assistantId,
            tenantId: auth.tenantId,
            knowledgeBaseId,
          })),
        });
      }
    }
    return tx.assistant.findFirstOrThrow({
      where: { id: assistantId },
      include: {
        providerIntegration: { select: { id: true, provider: true, displayName: true, status: true } },
        agent: { select: { id: true, name: true, model: true, status: true } },
        knowledgeLinks: { select: { knowledgeBaseId: true } },
      },
    });
  });

  return ok({ item });
}

export async function DELETE(_: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { assistantId } = await context.params;
  const found = await prisma.assistant.findFirst({
    where: { id: assistantId, tenantId: auth.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!found) {
    return fail("Ассистент не найден", "NOT_FOUND", 404);
  }
  await prisma.assistant.update({
    where: { id: assistantId },
    data: { deletedAt: new Date() },
  });
  return ok({ ok: true });
}
