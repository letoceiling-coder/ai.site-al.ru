import type { AiProviderAdapter, ProviderName } from "./types";
import { IntegrationError } from "./base";

class PlaceholderAdapter implements AiProviderAdapter {
  constructor(public provider: ProviderName) {}

  async testConnection(apiKey: string): Promise<boolean> {
    return Boolean(apiKey);
  }

  async complete() {
    throw new IntegrationError(
      "Provider adapter is not implemented yet.",
      "NOT_IMPLEMENTED",
      this.provider,
    );
  }
}

const adapters = new Map<ProviderName, AiProviderAdapter>([
  ["openai", new PlaceholderAdapter("openai")],
  ["anthropic", new PlaceholderAdapter("anthropic")],
  ["gemini", new PlaceholderAdapter("gemini")],
  ["xai", new PlaceholderAdapter("xai")],
  ["replicate", new PlaceholderAdapter("replicate")],
  ["elevenlabs", new PlaceholderAdapter("elevenlabs")],
  ["telegram", new PlaceholderAdapter("telegram")],
  ["avito", new PlaceholderAdapter("avito")],
]);

export function getAdapter(provider: ProviderName) {
  const adapter = adapters.get(provider);
  if (!adapter) {
    throw new IntegrationError("Unknown provider", "PROVIDER_UNKNOWN", provider);
  }
  return adapter;
}

export * from "./types";
export * from "./base";
