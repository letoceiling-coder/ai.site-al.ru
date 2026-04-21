import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import {
  decodeSecret,
  getProviderMeta,
  testProviderConnection,
  type AiProviderId,
  type ProviderEnum,
} from "@/lib/integrations";

type Context = {
  params: Promise<{ provider: string }>;
};

export async function POST(_: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const { provider } = await context.params;
  const meta = getProviderMeta(provider);
  if (!meta) {
    return fail("Unknown provider", "UNKNOWN_PROVIDER", 404);
  }

  if (provider === "openrouter") {
    const setting = await prisma.systemSetting.findFirst({
      where: { tenantId: auth.tenantId, key: "openrouter" },
    });
    const value = (setting?.value ?? {}) as {
      apiKey?: string;
      model?: string;
      autoRouting?: boolean;
      enabled?: boolean;
    };
    const apiKey = typeof value.apiKey === "string" ? value.apiKey.trim() : "";
    if (!apiKey) {
      return fail("API key is missing", "API_KEY_MISSING", 400);
    }
    const testResult = await testProviderConnection("openrouter", apiKey);
    const nextValue = {
      ...value,
      lastTestAt: new Date().toISOString(),
      lastTestOk: testResult.ok,
      lastTestMessage: testResult.message,
      lastTestBy: auth.userId,
    };
    await prisma.systemSetting.upsert({
      where: {
        tenantId_key: {
          tenantId: auth.tenantId,
          key: "openrouter",
        },
      },
      create: {
        tenantId: auth.tenantId,
        key: "openrouter",
        value: nextValue,
      },
      update: {
        value: nextValue,
      },
    });
    return ok({
      provider,
      connected: testResult.ok,
      message: testResult.message,
    });
  }

  const integration: any = await prisma.providerIntegration.findFirst({
    where: {
      tenantId: auth.tenantId,
      provider: meta.enumValue as ProviderEnum,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!integration) {
    return fail("Integration is not configured", "NOT_CONFIGURED", 400);
  }

  const apiKey = decodeSecret(integration.encryptedSecret);
  if (!apiKey) {
    return fail("API key is missing", "API_KEY_MISSING", 400);
  }

  const testResult = await testProviderConnection(provider as AiProviderId, apiKey);
  const metadata = {
    ...(integration.metadata ?? {}),
    lastTestAt: new Date().toISOString(),
    lastTestOk: testResult.ok,
    lastTestMessage: testResult.message,
    lastTestBy: auth.userId,
  };

  await prisma.providerIntegration.update({
    where: { id: integration.id },
    data: { metadata },
  });

  return ok({
    provider,
    connected: testResult.ok,
    message: testResult.message,
  });
}
