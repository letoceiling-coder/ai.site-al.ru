import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

type ProviderType = "OPENAI" | "ANTHROPIC" | "GEMINI" | "XAI" | "REPLICATE" | "ELEVENLABS";
type AgentStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

const providerDefaults: Record<ProviderType, string[]> = {
  OPENAI: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"],
  ANTHROPIC: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest"],
  GEMINI: ["gemini-2.0-flash", "gemini-1.5-pro"],
  XAI: ["grok-2-1212", "grok-beta"],
  REPLICATE: ["meta/llama-3.1-8b-instruct", "mistralai/mistral-7b-instruct-v0.2"],
  ELEVENLABS: ["eleven_multilingual_v2", "eleven_flash_v2_5"],
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

  const [agents, integrations, modelOptions] = await Promise.all([
    prisma.agent.findMany({
      where: { tenantId: auth.tenantId, deletedAt: null },
      include: { providerIntegration: { select: { provider: true, displayName: true, status: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.providerIntegration.findMany({
      where: { tenantId: auth.tenantId },
      select: { id: true, provider: true, displayName: true, status: true },
      orderBy: { createdAt: "asc" },
    }),
    buildModelOptions(auth.tenantId),
  ]);

  return ok({
    agents,
    integrations,
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
  const integration = await prisma.providerIntegration.findFirst({
    where: { id: providerIntegrationId, tenantId: auth.tenantId },
    select: { id: true },
  });
  if (!integration) {
    return fail("Интеграция не найдена", "NOT_FOUND", 404);
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

  const status = isAgentStatus(body.status) ? body.status : "DRAFT";

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
    },
    include: { providerIntegration: { select: { provider: true, displayName: true, status: true } } },
  });

  return ok({ item }, 201);
}
