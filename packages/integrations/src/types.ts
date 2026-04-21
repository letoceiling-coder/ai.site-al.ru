export type ProviderName =
  | "openai"
  | "anthropic"
  | "gemini"
  | "xai"
  | "replicate"
  | "elevenlabs"
  | "telegram"
  | "avito";

export type CompletionInput = {
  model: string;
  systemPrompt?: string;
  userText: string;
};

export type CompletionOutput = {
  text: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
};

export interface AiProviderAdapter {
  provider: ProviderName;
  testConnection(apiKey: string): Promise<boolean>;
  complete(apiKey: string, input: CompletionInput): Promise<CompletionOutput>;
}
