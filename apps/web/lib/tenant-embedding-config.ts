import { prisma } from "@ai/db";
import { decodeSecret } from "@/lib/integrations";

export type TenantEmbeddingConfig = {
  /** OpenAI-совместимый embeddings endpoint */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Как помечать job'ы в БД */
  label: "openrouter" | "openai";
};

const DEFAULT_MODEL = process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
const OPENROUTER_EMBED_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL?.trim() || "openai/text-embedding-3-small";

/**
 * Ключ для эмбеддингов: сначала OpenRouter (если включён), иначе первая интеграция OpenAI тенанта.
 */
export async function resolveTenantEmbeddingConfig(tenantId: string): Promise<TenantEmbeddingConfig | null> {
  const openrouterRow = await prisma.systemSetting.findFirst({
    where: { tenantId, key: "openrouter" },
  });
  const openrouter = (openrouterRow?.value ?? {}) as {
    enabled?: boolean;
    apiKey?: string;
    model?: string;
  };
  if (openrouter.enabled && typeof openrouter.apiKey === "string" && openrouter.apiKey.trim()) {
    return {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: openrouter.apiKey.trim(),
      model: OPENROUTER_EMBED_MODEL,
      label: "openrouter",
    };
  }

  const openaiIntegration = await prisma.providerIntegration.findFirst({
    where: { tenantId, provider: "OPENAI", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  if (!openaiIntegration) {
    return null;
  }
  const apiKey = decodeSecret(openaiIntegration.encryptedSecret);
  if (!apiKey?.trim()) {
    return null;
  }
  return {
    baseUrl: "https://api.openai.com/v1",
    apiKey: apiKey.trim(),
    model: DEFAULT_MODEL,
    label: "openai",
  };
}
