import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

type AgentStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

type Context = {
  params: Promise<{ agentId: string }>;
};

type UpdatePayload = {
  name?: unknown;
  description?: unknown;
  providerIntegrationId?: unknown;
  model?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
  status?: unknown;
  configJson?: unknown;
};

function isAgentStatus(value: unknown): value is AgentStatus {
  return value === "DRAFT" || value === "ACTIVE" || value === "ARCHIVED";
}

function isConnectedIntegration(integration: { status: string; encryptedSecret: string; metadata: unknown }) {
  if (integration.status !== "ACTIVE") {
    return false;
  }
  if (!integration.encryptedSecret) {
    return false;
  }
  const metadata = integration.metadata as { lastTestOk?: boolean } | null;
  return metadata?.lastTestOk === true;
}

function parseTemperature(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 2) {
    return null;
  }
  return Math.round(num * 100) / 100;
}

function parseMaxTokens(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 500000) {
    return null;
  }
  return num;
}

function toNullableText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export async function PUT(request: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const { agentId } = await context.params;
  const existing = await prisma.agent.findFirst({
    where: { id: agentId, tenantId: auth.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) {
    return fail("Агент не найден", "NOT_FOUND", 404);
  }

  const body = (await request.json().catch(() => ({}))) as UpdatePayload;
  const data: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return fail("Поле 'Наименование' не может быть пустым", "VALIDATION_ERROR", 400);
    }
    data.name = name;
  }

  const description = toNullableText(body.description);
  if (description !== undefined) {
    data.description = description;
  }

  if (typeof body.providerIntegrationId === "string") {
    let integration = null as null | { id: string; status: string; encryptedSecret: string; metadata: unknown };
    let useOpenRouter = false;
    if (body.providerIntegrationId === "openrouter") {
      const setting = await prisma.systemSetting.findFirst({
        where: { tenantId: auth.tenantId, key: "openrouter" },
        select: { value: true },
      });
      const value = (setting?.value ?? {}) as { enabled?: boolean; lastTestOk?: boolean };
      if (!value.enabled || !value.lastTestOk) {
        return fail("OpenRouter не подключен. Сначала сохраните и протестируйте его в Интеграции AI.", "VALIDATION_ERROR", 400);
      }
      useOpenRouter = true;
      integration = await prisma.providerIntegration.findFirst({
        where: { tenantId: auth.tenantId, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true, encryptedSecret: true, metadata: true },
      });
    } else {
      integration = await prisma.providerIntegration.findFirst({
        where: { id: body.providerIntegrationId, tenantId: auth.tenantId },
        select: { id: true, status: true, encryptedSecret: true, metadata: true },
      });
    }
    if (!integration) {
      return fail("Интеграция не найдена", "NOT_FOUND", 404);
    }
    if (!isConnectedIntegration(integration)) {
      return fail("Интеграция не подключена. Сначала выполните успешный тест в разделе Интеграции AI.", "VALIDATION_ERROR", 400);
    }
    data.providerIntegrationId = integration.id;
    if (useOpenRouter) {
      data.configJson = {
        ...(typeof data.configJson === "object" && data.configJson !== null ? (data.configJson as Record<string, unknown>) : {}),
        useOpenRouter: true,
      };
    }
  }

  if (typeof body.model === "string") {
    const model = body.model.trim();
    if (!model) {
      return fail("Поле 'Модель' не может быть пустым", "VALIDATION_ERROR", 400);
    }
    data.model = model;
  }

  if (body.temperature !== undefined) {
    const temperature = parseTemperature(body.temperature);
    if (temperature === null) {
      return fail("Temperature должно быть числом от 0 до 2", "VALIDATION_ERROR", 400);
    }
    data.temperature = temperature;
  }

  if (body.maxTokens !== undefined) {
    const maxTokens = parseMaxTokens(body.maxTokens);
    if (maxTokens === null && body.maxTokens !== null && body.maxTokens !== "") {
      return fail("maxTokens должно быть целым числом от 1 до 500000", "VALIDATION_ERROR", 400);
    }
    data.maxTokens = maxTokens;
  }

  if (body.status !== undefined) {
    if (!isAgentStatus(body.status)) {
      return fail("Некорректный статус агента", "VALIDATION_ERROR", 400);
    }
    data.status = body.status;
  }

  if (body.configJson !== undefined) {
    if (body.configJson !== null && typeof body.configJson !== "object") {
      return fail("configJson должен быть объектом", "VALIDATION_ERROR", 400);
    }
    const existingConfig =
      typeof data.configJson === "object" && data.configJson !== null ? (data.configJson as Record<string, unknown>) : {};
    const incomingConfig =
      body.configJson && typeof body.configJson === "object" ? (body.configJson as Record<string, unknown>) : {};
    data.configJson = {
      ...incomingConfig,
      ...existingConfig,
    };
  }

  const item = await prisma.agent.update({
    where: { id: existing.id },
    data,
    include: { providerIntegration: { select: { provider: true, displayName: true, status: true } } },
  });

  return ok({ item });
}

export async function DELETE(_: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const { agentId } = await context.params;
  const existing = await prisma.agent.findFirst({
    where: { id: agentId, tenantId: auth.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) {
    return fail("Агент не найден", "NOT_FOUND", 404);
  }

  await prisma.agent.update({
    where: { id: existing.id },
    data: { deletedAt: new Date(), status: "ARCHIVED" },
  });

  return ok({ removed: true });
}
