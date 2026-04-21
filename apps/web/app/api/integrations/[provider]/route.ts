import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { encodeSecret, getProviderMeta, type ProviderEnum } from "@/lib/integrations";

type Context = {
  params: Promise<{ provider: string }>;
};

export async function PUT(request: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const { provider } = await context.params;
  const meta = getProviderMeta(provider);
  if (!meta) {
    return fail("Unknown provider", "UNKNOWN_PROVIDER", 404);
  }

  const body = (await request.json().catch(() => ({}))) as {
    apiKey?: string;
    enabled?: boolean;
    model?: string;
    autoRouting?: boolean;
  };

  const enabled = Boolean(body.enabled);
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const autoRouting = body.autoRouting !== false;

  if (provider === "openrouter") {
    const existing = await prisma.systemSetting.findFirst({
      where: { tenantId: auth.tenantId, key: "openrouter" },
    });
    const current = (existing?.value ?? {}) as {
      apiKey?: string;
      model?: string;
      autoRouting?: boolean;
      lastTestAt?: string;
      lastTestOk?: boolean;
      lastTestMessage?: string;
    };
    const nextValue = {
      ...current,
      enabled,
      apiKey: apiKey || current.apiKey || "",
      model: model || current.model || "openai/gpt-4.1-mini",
      autoRouting,
      configuredBy: auth.userId,
      configuredAt: new Date().toISOString(),
    };
    const upserted = await prisma.systemSetting.upsert({
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
    return ok({ integration: upserted });
  }

  const existing: any = await prisma.providerIntegration.findFirst({
    where: {
      tenantId: auth.tenantId,
      provider: meta.enumValue as ProviderEnum,
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    const updated = await prisma.providerIntegration.update({
      where: { id: existing.id },
      data: {
        status: enabled ? "ACTIVE" : "DISABLED",
        encryptedSecret: apiKey ? encodeSecret(apiKey) : existing.encryptedSecret,
        metadata: {
          ...(existing.metadata ?? {}),
          configuredBy: auth.userId,
          configuredAt: new Date().toISOString(),
        },
      },
    });
    return ok({ integration: updated });
  }

  const created = await prisma.providerIntegration.create({
    data: {
      tenantId: auth.tenantId,
      provider: meta.enumValue as ProviderEnum,
      displayName: meta.title,
      encryptedSecret: apiKey ? encodeSecret(apiKey) : "",
      status: enabled ? "ACTIVE" : "DISABLED",
      metadata: {
        configuredBy: auth.userId,
        configuredAt: new Date().toISOString(),
      },
    },
  });

  return ok({ integration: created });
}
