import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { aiProviders, decodeSecret, getIntegrationRow } from "@/lib/integrations";

export async function GET() {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const rows = await Promise.all(
    aiProviders.map(async (provider) => {
      if (provider.id === "openrouter") {
        const setting = await prisma.systemSetting.findFirst({
          where: { tenantId: auth.tenantId, key: "openrouter" },
        });
        const value = (setting?.value ?? {}) as {
          enabled?: boolean;
          apiKey?: string;
          model?: string;
          autoRouting?: boolean;
          lastTestAt?: string;
          lastTestOk?: boolean;
          lastTestMessage?: string;
        };
        return {
          provider: provider.id,
          title: provider.title,
          docsUrl: provider.docsUrl,
          enabled: Boolean(value.enabled),
          configured: Boolean(value.apiKey),
          updatedAt: setting?.updatedAt ?? null,
          lastTestAt: value.lastTestAt ?? null,
          lastTestOk: value.lastTestOk ?? null,
          lastTestMessage: value.lastTestMessage ?? null,
          config: {
            model: value.model ?? "openai/gpt-4.1-mini",
            autoRouting: value.autoRouting !== false,
          },
        };
      }
      const integration: any = await getIntegrationRow(auth.tenantId, provider.enumValue);
      const metadata = (integration?.metadata ?? {}) as Record<string, unknown>;
      return {
        provider: provider.id,
        title: provider.title,
        docsUrl: provider.docsUrl,
        enabled: integration?.status === "ACTIVE",
        configured: Boolean(decodeSecret(integration?.encryptedSecret)),
        updatedAt: integration?.updatedAt ?? null,
        lastTestAt: metadata.lastTestAt ?? null,
        lastTestOk: metadata.lastTestOk ?? null,
        lastTestMessage: metadata.lastTestMessage ?? null,
        config: null,
      };
    }),
  );

  return ok({ integrations: rows });
}
