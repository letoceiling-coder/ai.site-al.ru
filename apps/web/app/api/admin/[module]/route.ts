import { adminModules } from "@ai/shared";
import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

type Params = {
  params: Promise<{ module: string }>;
};

function isAllowedModule(moduleName: string) {
  return adminModules.includes(moduleName as (typeof adminModules)[number]);
}

function decimalToNumber(value: unknown) {
  if (value && typeof value === "object" && "toNumber" in (value as Record<string, unknown>)) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return value;
}

function normalize(data: any): any {
  if (Array.isArray(data)) {
    return data.map(normalize);
  }
  if (data && typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      out[key] = normalize(decimalToNumber(value));
    }
    return out;
  }
  return data;
}

async function getList(module: string, tenantId: string) {
  switch (module) {
    case "integrations":
      return prisma.providerIntegration.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      });
    case "agents":
      return prisma.agent.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    case "knowledge":
      return prisma.knowledgeBase.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    case "assistants":
      return prisma.assistant.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    case "dialogs":
      return prisma.dialog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    case "api_keys":
      return prisma.apiKey.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    case "leads":
      return prisma.lead.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    case "telegram":
      return prisma.telegramBot.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    case "analytics":
      return prisma.analyticsSnapshot.findMany({
        where: { tenantId },
        orderBy: { snapshotDate: "desc" },
      });
    case "usage":
      return prisma.usageEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    case "settings":
      return prisma.systemSetting.findMany({ where: { tenantId }, orderBy: { updatedAt: "desc" } });
    case "avito":
      return prisma.avitoIntegration.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      });
    default:
      return [];
  }
}

async function ensureProviderIntegration(tenantId: string) {
  const existing = await prisma.providerIntegration.findFirst({
    where: { tenantId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    return existing;
  }
  return prisma.providerIntegration.create({
    data: {
      tenantId,
      provider: "OPENAI",
      displayName: "Default OpenAI",
      encryptedSecret: "pending-secret",
      status: "ACTIVE",
    },
  });
}

async function ensureAssistant(tenantId: string, userId: string) {
  const existing = await prisma.assistant.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    return existing;
  }
  const integration = await ensureProviderIntegration(tenantId);
  return prisma.assistant.create({
    data: {
      tenantId,
      createdById: userId,
      providerIntegrationId: integration.id,
      name: "Default Assistant",
      systemPrompt: "You are a helpful assistant.",
      status: "ACTIVE",
    },
  });
}

async function createItem(module: string, tenantId: string, userId: string, payload: any) {
  const name = typeof payload?.name === "string" && payload.name.trim() ? payload.name.trim() : "New Item";
  switch (module) {
    case "integrations":
      return prisma.providerIntegration.create({
        data: {
          tenantId,
          provider: payload?.provider ?? "OPENAI",
          displayName: name,
          encryptedSecret: payload?.encryptedSecret ?? "pending-secret",
          status: "ACTIVE",
          metadata: payload?.metadata ?? {},
        },
      });
    case "agents": {
      const integration = await ensureProviderIntegration(tenantId);
      return prisma.agent.create({
        data: {
          tenantId,
          createdById: userId,
          providerIntegrationId: integration.id,
          name,
          model: payload?.model ?? "gpt-4o-mini",
          description: payload?.description ?? null,
          status: "ACTIVE",
        },
      });
    }
    case "knowledge":
      return prisma.knowledgeBase.create({
        data: {
          tenantId,
          name,
          description: payload?.description ?? null,
          visibility: payload?.visibility ?? "PRIVATE",
        },
      });
    case "assistants": {
      const integration = await ensureProviderIntegration(tenantId);
      return prisma.assistant.create({
        data: {
          tenantId,
          createdById: userId,
          providerIntegrationId: integration.id,
          name,
          systemPrompt: payload?.systemPrompt ?? "You are a helpful assistant.",
          status: "ACTIVE",
        },
      });
    }
    case "dialogs": {
      const assistant = await ensureAssistant(tenantId, userId);
      return prisma.dialog.create({
        data: {
          tenantId,
          userId,
          assistantId: assistant.id,
          status: "OPEN",
        },
      });
    }
    case "api_keys": {
      const keyPrefix = `ak_${Math.random().toString(36).slice(2, 8)}`;
      const keyHash = `kh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      return prisma.apiKey.create({
        data: {
          tenantId,
          createdById: userId,
          name,
          keyPrefix,
          keyHash,
          scope: payload?.scope ?? "ASSISTANTS",
        },
      });
    }
    case "leads":
      return prisma.lead.create({
        data: {
          tenantId,
          fullName: name,
          source: payload?.source ?? "manual",
          status: payload?.status ?? "NEW",
          email: payload?.email ?? null,
          phone: payload?.phone ?? null,
        },
      });
    case "telegram":
      return prisma.telegramBot.create({
        data: {
          tenantId,
          name,
          botTokenEnc: payload?.botTokenEnc ?? "pending-token",
          webhookUrl: payload?.webhookUrl ?? null,
          status: "ACTIVE",
          configJson: payload?.configJson ?? {},
        },
      });
    case "analytics":
      return prisma.analyticsSnapshot.create({
        data: {
          tenantId,
          snapshotDate: new Date(),
          metadata: payload?.metadata ?? {},
        },
      });
    case "usage":
      return prisma.usageEvent.create({
        data: {
          tenantId,
          provider: payload?.provider ?? "OPENAI",
          model: payload?.model ?? "gpt-4o-mini",
          sourceType: payload?.sourceType ?? "manual",
          totalCostUsd: payload?.totalCostUsd ?? 0,
          tokensInput: payload?.tokensInput ?? 0,
          tokensOutput: payload?.tokensOutput ?? 0,
        },
      });
    case "settings":
      return prisma.systemSetting.upsert({
        where: {
          tenantId_key: {
            tenantId,
            key: payload?.key ?? `setting_${Date.now().toString(36)}`,
          },
        },
        create: {
          tenantId,
          key: payload?.key ?? `setting_${Date.now().toString(36)}`,
          value: payload?.value ?? { enabled: true },
        },
        update: {
          value: payload?.value ?? { enabled: true },
        },
      });
    case "avito":
      return prisma.avitoIntegration.create({
        data: {
          tenantId,
          name,
          clientId: payload?.clientId ?? "pending-client-id",
          clientSecretEnc: payload?.clientSecretEnc ?? "pending-client-secret",
          webhookUrl: payload?.webhookUrl ?? null,
          isActive: true,
        },
      });
    default:
      return null;
  }
}

export async function GET(_: Request, context: Params) {
  const { module } = await context.params;
  if (!isAllowedModule(module)) {
    return fail("Module not found", "NOT_FOUND", 404);
  }
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const items = await getList(module, auth.tenantId);
  return ok({
    module,
    items: normalize(items),
  });
}

export async function POST(request: Request, context: Params) {
  const { module } = await context.params;
  if (!isAllowedModule(module)) {
    return fail("Module not found", "NOT_FOUND", 404);
  }
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const item = await createItem(module, auth.tenantId, auth.userId, body);
  if (!item) {
    return fail("Module is not supported", "NOT_SUPPORTED", 400);
  }

  return ok(
    {
      module,
      created: true,
      item: normalize(item),
    },
    201,
  );
}
