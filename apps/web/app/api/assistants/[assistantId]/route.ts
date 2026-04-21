import type { Prisma } from "@prisma/client";
import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { isConnectedIntegration } from "@/lib/tenant-ai-integrations";

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
    data.systemPrompt = systemPrompt;
  }
  if (isAssistantStatus(body.status)) {
    data.status = body.status;
  }

  if (typeof body.providerIntegrationId === "string") {
    const resolved = await resolveRealIntegrationId(auth.tenantId, body.providerIntegrationId.trim());
    if (!resolved.ok) {
      return resolved.response;
    }
    data.providerIntegrationId = resolved.id;
    const currentSettings = (existing.settingsJson ?? {}) as Record<string, unknown>;
    data.settingsJson = {
      ...currentSettings,
      useOpenRouter: resolved.useOpenRouter,
    };
  }

  if (body.agentId !== undefined) {
    if (body.agentId === null || body.agentId === "") {
      data.agentId = null;
    } else if (typeof body.agentId === "string") {
      const agent = await prisma.agent.findFirst({
        where: { id: body.agentId.trim(), tenantId: auth.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!agent) {
        return fail("Агент не найден", "NOT_FOUND", 404);
      }
      data.agentId = agent.id;
    } else {
      return fail("Некорректный идентификатор агента", "VALIDATION_ERROR", 400);
    }
  }

  if (typeof body.model === "string") {
    const cur = { ...((existing.settingsJson ?? {}) as Record<string, unknown>) };
    const m = body.model.trim();
    if (m) {
      cur.model = m;
    } else {
      delete cur.model;
    }
    data.settingsJson = cur;
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
