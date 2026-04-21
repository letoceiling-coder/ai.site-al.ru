import { prisma } from "@ai/db";

const providerDefaults: Record<string, string[]> = {
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
  for (const [provider, defaults] of Object.entries(providerDefaults)) {
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
  const base = modelOptions.OPENROUTER ?? providerDefaults.OPENROUTER;
  modelOptions.OPENROUTER = presetModel ? Array.from(new Set([presetModel, ...base])) : base;

  return { connectedIntegrations, modelOptions };
}
