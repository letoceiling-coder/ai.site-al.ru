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
      };
    }),
  );

  return ok({ integrations: rows });
}
