import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import {
  DEFAULT_KNOWLEDGE_SETTINGS,
  normalizeKnowledgeSettings,
  settingsFromTemplate,
} from "@/lib/knowledge-settings";

type CreatePayload = {
  name?: unknown;
  description?: unknown;
  visibility?: unknown;
  settings?: unknown;
  template?: unknown;
};

export async function GET(request: Request) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const rows = await prisma.knowledgeBase.findMany({
    where: {
      tenantId: auth.tenantId,
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const items = await Promise.all(
    rows.map(async (row: (typeof rows)[number]) => {
      const c = await prisma.knowledgeItem.count({ where: { knowledgeBaseId: row.id, tenantId: auth.tenantId } });
      return {
        ...row,
        settings: normalizeKnowledgeSettings(row.settingsJson),
        itemCount: c,
      };
    }),
  );
  return ok({ knowledgeBases: items });
}

export async function POST(request: Request) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const body = (await request.json().catch(() => ({}))) as CreatePayload;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return fail("Укажите название базы", "VALIDATION_ERROR", 400);
  }
  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const vis = body.visibility === "PUBLIC" || body.visibility === "PRIVATE" ? body.visibility : "PRIVATE";

  const templateCode = typeof body.template === "string" ? body.template.trim().slice(0, 60) : "";
  const templateDefaults = templateCode ? settingsFromTemplate(templateCode) : {};
  const userSettings = body.settings && typeof body.settings === "object" ? body.settings : {};
  const merged = {
    ...DEFAULT_KNOWLEDGE_SETTINGS,
    ...templateDefaults,
    ...(userSettings as object),
    ...(templateCode ? { template: templateCode } : {}),
  };
  const settings = normalizeKnowledgeSettings(merged);

  const row = await prisma.knowledgeBase.create({
    data: {
      tenantId: auth.tenantId,
      name,
      description,
      visibility: vis,
      settingsJson: settings as unknown as object,
    },
  });
  return ok({ knowledgeBase: { ...row, settings } }, 201);
}
