import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { getConnectedIntegrationsWithModels, isConnectedIntegration } from "@/lib/tenant-ai-integrations";

type AssistantStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

type CreatePayload = {
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

function parseKnowledgeBaseIds(value: unknown): string[] {
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

export async function GET() {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { connectedIntegrations, modelOptions } = await getConnectedIntegrationsWithModels(auth.tenantId);
  const [assistants, agents, knowledgeBases] = await Promise.all([
    prisma.assistant.findMany({
      where: { tenantId: auth.tenantId, deletedAt: null },
      include: {
        providerIntegration: {
          select: { id: true, provider: true, displayName: true, status: true },
        },
        agent: { select: { id: true, name: true, model: true, status: true } },
        knowledgeLinks: { select: { knowledgeBaseId: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agent.findMany({
      where: { tenantId: auth.tenantId, deletedAt: null, status: "ACTIVE" },
      select: { id: true, name: true, model: true },
      orderBy: { name: "asc" },
    }),
    prisma.knowledgeBase.findMany({
      where: { tenantId: auth.tenantId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return ok({ assistants, integrations: connectedIntegrations, modelOptions, agents, knowledgeBases });
}

export async function POST(request: Request) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const body = (await request.json().catch(() => ({}))) as CreatePayload;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return fail("Поле «Наименование» обязательно", "VALIDATION_ERROR", 400);
  }
  const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  if (!systemPrompt) {
    return fail("Поле «Системный промпт» обязательно", "VALIDATION_ERROR", 400);
  }
  const providerIntegrationId =
    typeof body.providerIntegrationId === "string" ? body.providerIntegrationId.trim() : "";
  if (!providerIntegrationId) {
    return fail("Выберите интеграцию провайдера", "VALIDATION_ERROR", 400);
  }

  const resolved = await resolveRealIntegrationId(auth.tenantId, providerIntegrationId);
  if (!resolved.ok) {
    return resolved.response;
  }

  let agentId: string | null = null;
  if (body.agentId !== undefined && body.agentId !== null && body.agentId !== "") {
    if (typeof body.agentId !== "string") {
      return fail("Некорректный идентификатор агента", "VALIDATION_ERROR", 400);
    }
    const agent = await prisma.agent.findFirst({
      where: { id: body.agentId.trim(), tenantId: auth.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!agent) {
      return fail("Агент не найден", "NOT_FOUND", 404);
    }
    agentId = agent.id;
  }

  const status = isAssistantStatus(body.status) ? body.status : "ACTIVE";
  const kbIds = parseKnowledgeBaseIds(body.knowledgeBaseIds);
  if (kbIds.length) {
    const count = await prisma.knowledgeBase.count({
      where: { tenantId: auth.tenantId, deletedAt: null, id: { in: kbIds } },
    });
    if (count !== kbIds.length) {
      return fail("Одна или несколько баз знаний не найдены", "VALIDATION_ERROR", 400);
    }
  }

  const modelTrim = typeof body.model === "string" ? body.model.trim() : "";
  const settingsJson: Record<string, unknown> = {};
  if (resolved.useOpenRouter) {
    settingsJson.useOpenRouter = true;
  }
  if (modelTrim) {
    settingsJson.model = modelTrim;
  }

  const item = await prisma.assistant.create({
    data: {
      tenantId: auth.tenantId,
      createdById: auth.userId,
      providerIntegrationId: resolved.id,
      agentId,
      name,
      systemPrompt,
      status,
      ...(Object.keys(settingsJson).length > 0 ? { settingsJson } : {}),
      ...(kbIds.length
        ? {
            knowledgeLinks: {
              create: kbIds.map((knowledgeBaseId) => ({
                tenantId: auth.tenantId,
                knowledgeBaseId,
              })),
            },
          }
        : {}),
    },
    include: {
      providerIntegration: { select: { id: true, provider: true, displayName: true, status: true } },
      agent: { select: { id: true, name: true, model: true, status: true } },
      knowledgeLinks: { select: { knowledgeBaseId: true } },
    },
  });

  return ok({ item }, 201);
}
