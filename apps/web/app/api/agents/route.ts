import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

type ProviderType = "OPENAI" | "ANTHROPIC" | "GEMINI" | "XAI" | "REPLICATE" | "ELEVENLABS" | "OPENROUTER";
type AgentStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

const providerDefaults: Record<ProviderType, string[]> = {
  OPENAI: [
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-3.5-turbo",
    "o1",
    "o1-mini",
    "o3-mini",
  ],
  ANTHROPIC: [
    "claude-3-7-sonnet-latest",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-opus-latest",
  ],
  GEMINI: [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ],
  XAI: ["grok-3-beta", "grok-2-1212", "grok-2-vision-1212", "grok-beta"],
  REPLICATE: [
    "meta/llama-3.1-405b-instruct",
    "meta/llama-3.1-70b-instruct",
    "meta/llama-3.1-8b-instruct",
    "mistralai/mistral-7b-instruct-v0.2",
  ],
  ELEVENLABS: ["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2_5"],
  OPENROUTER: ["openai/gpt-4.1-mini", "anthropic/claude-3.7-sonnet", "google/gemini-2.0-flash-001"],
};

type AgentPayload = {
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

function toNullableText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function parseTemperature(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return 0.7;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 2) {
    return null;
  }
  return Math.round(num * 100) / 100;
}

function parseMaxTokens(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 500000) {
    return null;
  }
  return num;
}

async function buildModelOptions(tenantId: string) {
  const catalog = await prisma.modelCatalog.findMany({
    where: { tenantId, isActive: true },
    orderBy: [{ provider: "asc" }, { modelCode: "asc" }],
    select: { provider: true, modelCode: true },
  });
  const options: Record<string, string[]> = {};
  for (const row of catalog) {
    if (!options[row.provider]) {
      options[row.provider] = [];
    }
    if (!options[row.provider].includes(row.modelCode)) {
      options[row.provider].push(row.modelCode);
    }
  }
  for (const [provider, defaults] of Object.entries(providerDefaults)) {
    if (!options[provider] || options[provider].length === 0) {
      options[provider] = defaults;
    }
  }
  return options;
}

export async function GET() {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const [agents, integrations, modelOptions, openrouterSetting] = await Promise.all([
    prisma.agent.findMany({
      where: { tenantId: auth.tenantId, deletedAt: null },
      include: { providerIntegration: { select: { provider: true, displayName: true, status: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.providerIntegration.findMany({
      where: { tenantId: auth.tenantId },
      select: { id: true, provider: true, displayName: true, status: true, encryptedSecret: true, metadata: true },
      orderBy: { createdAt: "asc" },
    }),
    buildModelOptions(auth.tenantId),
    prisma.systemSetting.findFirst({
      where: { tenantId: auth.tenantId, key: "openrouter" },
      select: { value: true },
    }),
  ]);

  const connectedIntegrations: Array<{ id: string; provider: string; displayName: string; status: string }> = integrations
    .filter((integration: (typeof integrations)[number]) => isConnectedIntegration(integration))
    .map((integration: (typeof integrations)[number]) => ({
      id: integration.id,
      provider: integration.provider,
      displayName: integration.displayName,
      status: integration.status,
    }));

  const openrouter = (openrouterSetting?.value ?? {}) as {
    enabled?: boolean;
    model?: string;
    lastTestOk?: boolean;
  };
  connectedIntegrations.unshift({
    id: "openrouter",
    provider: "OPENROUTER",
    displayName: openrouter.enabled ? "OpenRouter" : "OpenRouter (не подключен)",
    status: openrouter.enabled ? "ACTIVE" : "DISABLED",
  });
  const presetModel = typeof openrouter.model === "string" && openrouter.model.trim() ? openrouter.model.trim() : null;
  const base = modelOptions.OPENROUTER ?? providerDefaults.OPENROUTER;
  modelOptions.OPENROUTER = presetModel ? Array.from(new Set([presetModel, ...base])) : base;

  return ok({
    agents,
    integrations: connectedIntegrations,
    modelOptions,
  });
}

export async function POST(request: Request) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const body = (await request.json().catch(() => ({}))) as AgentPayload;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return fail("Поле 'Наименование' обязательно", "VALIDATION_ERROR", 400);
  }
  const providerIntegrationId =
    typeof body.providerIntegrationId === "string" ? body.providerIntegrationId.trim() : "";
  if (!providerIntegrationId) {
    return fail("Выберите интеграцию провайдера", "VALIDATION_ERROR", 400);
  }
  let integration = null as null | { id: string; status: string; encryptedSecret: string; metadata: unknown };
  let useOpenRouter = false;
  if (providerIntegrationId === "openrouter") {
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
      where: { id: providerIntegrationId, tenantId: auth.tenantId },
      select: { id: true, status: true, encryptedSecret: true, metadata: true },
    });
  }
  if (!integration) {
    return fail("Интеграция не найдена", "NOT_FOUND", 404);
  }
  if (!isConnectedIntegration(integration)) {
    return fail("Интеграция не подключена. Сначала выполните успешный тест в разделе Интеграции AI.", "VALIDATION_ERROR", 400);
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) {
    return fail("Поле 'Модель' обязательно", "VALIDATION_ERROR", 400);
  }

  const temperature = parseTemperature(body.temperature);
  if (temperature === null) {
    return fail("Temperature должно быть числом от 0 до 2", "VALIDATION_ERROR", 400);
  }
  const maxTokens = parseMaxTokens(body.maxTokens);
  if (maxTokens === null && body.maxTokens !== undefined && body.maxTokens !== null && body.maxTokens !== "") {
    return fail("maxTokens должно быть целым числом от 1 до 500000", "VALIDATION_ERROR", 400);
  }

  const status = isAgentStatus(body.status) ? body.status : "ACTIVE";

  const item = await prisma.agent.create({
    data: {
      tenantId: auth.tenantId,
      createdById: auth.userId,
      providerIntegrationId: integration.id,
      name,
      description: toNullableText(body.description),
      model,
      temperature,
      maxTokens,
      status,
      configJson: body.configJson && typeof body.configJson === "object" ? body.configJson : undefined,
      ...(useOpenRouter
        ? {
            configJson: {
              ...(body.configJson && typeof body.configJson === "object" ? (body.configJson as Record<string, unknown>) : {}),
              useOpenRouter: true,
            },
          }
        : {}),
    },
    include: { providerIntegration: { select: { provider: true, displayName: true, status: true } } },
  });

  return ok({ item }, 201);
}
