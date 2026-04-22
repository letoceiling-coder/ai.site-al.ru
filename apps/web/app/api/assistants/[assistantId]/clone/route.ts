import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

type Context = { params: Promise<{ assistantId: string }> };

async function pickUniqueName(tenantId: string, baseName: string): Promise<string> {
  const shortBase = baseName.slice(0, 180);
  const candidate = `${shortBase} (копия)`;
  const exists = await prisma.assistant.findFirst({
    where: { tenantId, name: candidate, deletedAt: null },
    select: { id: true },
  });
  if (!exists) {
    return candidate;
  }
  for (let i = 2; i < 500; i += 1) {
    const next = `${shortBase} (копия ${i})`;
    const duplicate = await prisma.assistant.findFirst({
      where: { tenantId, name: next, deletedAt: null },
      select: { id: true },
    });
    if (!duplicate) {
      return next;
    }
  }
  return `${shortBase} (копия ${Date.now()})`;
}

export async function POST(_request: Request, context: Context) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { assistantId } = await context.params;
  const source = await prisma.assistant.findFirst({
    where: { id: assistantId, tenantId: auth.tenantId, deletedAt: null },
    include: { knowledgeLinks: { select: { knowledgeBaseId: true } } },
  });
  if (!source) {
    return fail("Ассистент не найден", "NOT_FOUND", 404);
  }

  const newName = await pickUniqueName(auth.tenantId, source.name);

  // Чистим историю промпта — новый ассистент стартует с пустой историей.
  const baseSettings =
    source.settingsJson && typeof source.settingsJson === "object" && !Array.isArray(source.settingsJson)
      ? { ...(source.settingsJson as Record<string, unknown>) }
      : {};
  delete baseSettings.promptHistory;

  const kbIds = source.knowledgeLinks.map((l: { knowledgeBaseId: string }) => l.knowledgeBaseId);

  const created = await prisma.assistant.create({
    data: {
      tenantId: auth.tenantId,
      createdById: auth.userId,
      providerIntegrationId: source.providerIntegrationId,
      agentId: source.agentId,
      name: newName,
      systemPrompt: source.systemPrompt,
      status: "DRAFT",
      version: 1,
      ...(Object.keys(baseSettings).length > 0 ? { settingsJson: baseSettings } : {}),
      ...(kbIds.length
        ? {
            knowledgeLinks: {
              create: kbIds.map((knowledgeBaseId: string) => ({
                tenantId: auth.tenantId,
                knowledgeBaseId,
              })),
            },
          }
        : {}),
    },
    include: {
      providerIntegration: { select: { id: true, provider: true, displayName: true, status: true } },
      agent: { select: { id: true, name: true, model: true, status: true } },
      knowledgeLinks: { select: { knowledgeBaseId: true } },
    },
  });

  return ok({ item: created }, 201);
}
