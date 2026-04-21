import { prisma } from "@ai/db";

export const aiProviders = [
  {
    id: "openai",
    enumValue: "OPENAI",
    title: "OpenAI",
    docsUrl: "https://platform.openai.com/docs/api-reference",
  },
  {
    id: "anthropic",
    enumValue: "ANTHROPIC",
    title: "Anthropic (Claude)",
    docsUrl: "https://docs.anthropic.com/en/api/overview",
  },
  {
    id: "gemini",
    enumValue: "GEMINI",
    title: "Google AI Studio (Gemini)",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
  },
  {
    id: "xai",
    enumValue: "XAI",
    title: "xAI (Grok)",
    docsUrl: "https://docs.x.ai/docs/overview",
  },
  {
    id: "replicate",
    enumValue: "REPLICATE",
    title: "Replicate",
    docsUrl: "https://replicate.com/docs/reference/http",
  },
  {
    id: "elevenlabs",
    enumValue: "ELEVENLABS",
    title: "ElevenLabs",
    docsUrl: "https://elevenlabs.io/docs/api-reference",
  },
  {
    id: "openrouter",
    enumValue: null,
    title: "OpenRouter",
    docsUrl: "https://openrouter.ai/docs/quickstart",
  },
] as const;

export type AiProviderId = (typeof aiProviders)[number]["id"];
export type ProviderEnum = (typeof aiProviders)[number]["enumValue"];

export function getProviderMeta(providerId: string) {
  return aiProviders.find((provider) => provider.id === providerId);
}

export function encodeSecret(secret: string) {
  return `b64:${Buffer.from(secret, "utf8").toString("base64")}`;
}

export function decodeSecret(secret: string | null | undefined) {
  if (!secret) {
    return "";
  }
  if (secret.startsWith("b64:")) {
    try {
      return Buffer.from(secret.slice(4), "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  try {
    const decoded = Buffer.from(secret, "base64").toString("utf8");
    const normalized = Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/g, "");
    const source = secret.replace(/=+$/g, "");
    if (normalized === source) {
      return decoded;
    }
    return secret;
  } catch {
    return secret;
  }
}

export async function getIntegrationRow(tenantId: string, providerEnum: ProviderEnum) {
  if (!providerEnum) {
    return null;
  }
  return prisma.providerIntegration.findFirst({
    where: {
      tenantId,
      provider: providerEnum,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

type TestResult = {
  ok: boolean;
  message: string;
};

async function readErrorDetail(response: Response) {
  const text = (await response.text()).trim();
  if (!text) {
    return "";
  }
  try {
    const json = JSON.parse(text) as {
      error?: { message?: string };
      message?: string;
      detail?: string;
    };
    return json.error?.message ?? json.message ?? json.detail ?? text.slice(0, 140);
  } catch {
    return text.slice(0, 140);
  }
}

function statusHint(provider: string, status: number) {
  if (provider === "Gemini") {
    if (status === 403) {
      return "Проверьте, что ключ из Google AI Studio активен и Generative Language API разрешен для проекта.";
    }
    if (status === 429) {
      return "Превышен лимит запросов или квота проекта Google.";
    }
  }
  if (provider === "xAI") {
    if (status === 403) {
      return "Ключ xAI не имеет нужных прав или заблокирован.";
    }
    if (status === 429) {
      return "Превышен rate limit или закончился баланс/квота xAI.";
    }
  }
  if (provider === "ElevenLabs") {
    if (status === 403) {
      return "Доступ запрещен: проверьте тариф/права API-ключа и ограничения аккаунта.";
    }
    if (status === 429) {
      return "Превышен rate limit или месячный лимит по тарифу ElevenLabs.";
    }
  }
  return "";
}

async function toResult(provider: string, response: Response): Promise<TestResult> {
  if (response.ok) {
    return { ok: true, message: `${provider} подключен` };
  }
  const detail = await readErrorDetail(response);
  const hint = statusHint(provider, response.status);
  const details = [detail, hint].filter(Boolean).join(" | ");
  const suffix = details ? `: ${details}` : "";
  return { ok: false, message: `${provider} error: ${response.status}${suffix}` };
}

async function testOpenAi(apiKey: string): Promise<TestResult> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  return toResult("OpenAI", response);
}

async function testAnthropic(apiKey: string): Promise<TestResult> {
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      Accept: "application/json",
    },
  });
  return toResult("Anthropic", response);
}

async function testGemini(apiKey: string): Promise<TestResult> {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: {
      "x-goog-api-key": apiKey,
      Accept: "application/json",
    },
  });
  return toResult("Gemini", response);
}

async function testXai(apiKey: string): Promise<TestResult> {
  const response = await fetch("https://api.x.ai/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  return toResult("xAI", response);
}

async function testReplicate(apiKey: string): Promise<TestResult> {
  const response = await fetch("https://api.replicate.com/v1/models", {
    headers: { Authorization: `Token ${apiKey}` },
  });
  return response.ok
    ? { ok: true, message: "Replicate подключен" }
    : { ok: false, message: `Replicate error: ${response.status}` };
}

async function testElevenLabs(apiKey: string): Promise<TestResult> {
  const response = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
    headers: {
      "xi-api-key": apiKey,
      Accept: "application/json",
    },
  });
  return toResult("ElevenLabs", response);
}

async function testOpenRouter(apiKey: string): Promise<TestResult> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "HTTP-Referer": "https://ai.site-al.ru",
      "X-Title": "ai.site-al.ru",
    },
  });
  return toResult("OpenRouter", response);
}

export async function testProviderConnection(providerId: AiProviderId, apiKey: string): Promise<TestResult> {
  const withTimeout = async (fn: () => Promise<TestResult>) => {
    const timeout = new Promise<TestResult>((resolve) => {
      setTimeout(() => resolve({ ok: false, message: "Timeout while testing integration" }), 12000);
    });
    const request = fn().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown network error";
      return { ok: false, message: `Network error: ${message}` };
    });
    return Promise.race([request, timeout]);
  };

  switch (providerId) {
    case "openai":
      return withTimeout(() => testOpenAi(apiKey));
    case "anthropic":
      return withTimeout(() => testAnthropic(apiKey));
    case "gemini":
      return withTimeout(() => testGemini(apiKey));
    case "xai":
      return withTimeout(() => testXai(apiKey));
    case "replicate":
      return withTimeout(() => testReplicate(apiKey));
    case "elevenlabs":
      return withTimeout(() => testElevenLabs(apiKey));
    case "openrouter":
      return withTimeout(() => testOpenRouter(apiKey));
    default:
      return { ok: false, message: "Unknown provider" };
  }
}
