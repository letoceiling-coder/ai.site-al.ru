import { prisma } from "@ai/db";

// Справочник моделей на 22 апреля 2026. Новые модели — в начале списка.
// Удалены модели, по которым API возвращает 404 (o1-mini, gpt-4.5-preview,
// claude-3-*-latest алиасы, все gemini-1.5-*). Сохранены текущие legacy.
export const PROVIDER_MODEL_DEFAULTS: Record<string, string[]> = {
  OPENAI: [
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.3",
    "gpt-5.2",
    "gpt-5.2-pro",
    "gpt-5.1",
    "gpt-5",
    "gpt-5-pro",
    "gpt-5-mini",
    "gpt-5-nano",
    "o3",
    "o3-pro",
    "o3-mini",
    "o4-mini",
    "o1",
    "o1-pro",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
  ],
  ANTHROPIC: [
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "claude-opus-4-6",
    "claude-sonnet-4-5",
    "claude-opus-4-5",
    "claude-opus-4-1",
  ],
  GEMINI: [
    "gemini-3.1-pro",
    "gemini-3-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ],
  XAI: ["grok-4", "grok-3", "grok-3-mini", "grok-3-beta"],
  REPLICATE: [
    "meta/llama-3.3-70b-instruct",
    "meta/llama-3.1-405b-instruct",
    "meta/llama-3.1-70b-instruct",
    "meta/llama-3.1-8b-instruct",
    "mistralai/mistral-large-2411",
  ],
  ELEVENLABS: ["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2_5"],
  OPENROUTER: [
    "openai/gpt-5.4-mini",
    "openai/gpt-5.4",
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-haiku-4-5",
    "google/gemini-2.5-flash",
    "google/gemini-2.5-pro",
  ],
};

export function isConnectedIntegration(integration: {
  status: string;
  encryptedSecret: string;
  metadata: unknown;
}) {
  if (integration.status !== "ACTIVE") {
    return false;
  }
  if (!integration.encryptedSecret) {
    return false;
  }
  const metadata = integration.metadata as { lastTestOk?: boolean } | null;
  return metadata?.lastTestOk === true;
}

export async function buildModelOptions(tenantId: string) {
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
  for (const [provider, defaults] of Object.entries(PROVIDER_MODEL_DEFAULTS)) {
    if (!options[provider] || options[provider].length === 0) {
      options[provider] = defaults;
    }
  }
  return options;
}

export type ConnectedIntegrationRow = {
  id: string;
  provider: string;
  displayName: string;
  status: string;
};

export async function getConnectedIntegrationsWithModels(tenantId: string) {
  const [integrations, modelOptions, openrouterSetting] = await Promise.all([
    prisma.providerIntegration.findMany({
      where: { tenantId },
      select: { id: true, provider: true, displayName: true, status: true, encryptedSecret: true, metadata: true },
      orderBy: { createdAt: "asc" },
    }),
    buildModelOptions(tenantId),
    prisma.systemSetting.findFirst({
      where: { tenantId, key: "openrouter" },
      select: { value: true },
    }),
  ]);

  const connectedIntegrations: ConnectedIntegrationRow[] = integrations
    .filter((i: (typeof integrations)[number]) => isConnectedIntegration(i))
    .map((i: (typeof integrations)[number]) => ({
      id: i.id,
      provider: i.provider,
      displayName: i.displayName,
      status: i.status,
    }));

  const openrouter = (openrouterSetting?.value ?? {}) as {
    enabled?: boolean;
    model?: string;
    lastTestOk?: boolean;
  };
  if (openrouter.enabled && openrouter.lastTestOk) {
    connectedIntegrations.unshift({
      id: "openrouter",
      provider: "OPENROUTER",
      displayName: "OpenRouter",
      status: "ACTIVE",
    });
  }
  const presetModel = typeof openrouter.model === "string" && openrouter.model.trim() ? openrouter.model.trim() : null;
  const base = modelOptions.OPENROUTER ?? PROVIDER_MODEL_DEFAULTS.OPENROUTER;
  modelOptions.OPENROUTER = presetModel ? Array.from(new Set([presetModel, ...base])) : base;

  return { connectedIntegrations, modelOptions };
}
