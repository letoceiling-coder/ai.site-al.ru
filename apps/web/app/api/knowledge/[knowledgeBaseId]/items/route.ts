import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

type Ctx = { params: Promise<{ knowledgeBaseId: string }> };
type CreatePayload = { title?: unknown; content?: unknown; sourceType?: unknown; sourceUrl?: unknown };

export async function GET(_: Request, context: Ctx) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { knowledgeBaseId } = await context.params;
  const base = await prisma.knowledgeBase.findFirst({
    where: { id: knowledgeBaseId, tenantId: auth.tenantId, deletedAt: null },
  });
  if (!base) {
    return fail("База не найдена", "NOT_FOUND", 404);
  }
  const items = await prisma.knowledgeItem.findMany({
    where: { knowledgeBaseId, tenantId: auth.tenantId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      content: true,
      sourceType: true,
      sourceUrl: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      document: {
        select: {
          id: true,
          parsingStatus: true,
          _count: { select: { chunks: true } },
        },
      },
    },
  });
  return ok({ items });
}

export async function POST(request: Request, context: Ctx) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { knowledgeBaseId } = await context.params;
  const base = await prisma.knowledgeBase.findFirst({
    where: { id: knowledgeBaseId, tenantId: auth.tenantId, deletedAt: null },
  });
  if (!base) {
    return fail("База не найдена", "NOT_FOUND", 404);
  }
  const body = (await request.json().catch(() => ({}))) as CreatePayload;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return fail("Укажите заголовок", "VALIDATION_ERROR", 400);
  }
  const st = body.sourceType === "URL" ? "URL" : "TEXT";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (st === "TEXT" && !content) {
    return fail("Введите текст фрагмента", "VALIDATION_ERROR", 400);
  }
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() || null : null;
  if (st === "URL" && !sourceUrl) {
    return fail("Укажите URL", "VALIDATION_ERROR", 400);
  }
  const item = await prisma.knowledgeItem.create({
    data: {
      tenantId: auth.tenantId,
      knowledgeBaseId,
      sourceType: st,
      title,
      content: st === "TEXT" ? content : null,
      sourceUrl: st === "URL" ? sourceUrl : null,
      status: st === "TEXT" && content ? "COMPLETED" : "QUEUED",
    },
  });
  return ok({ item }, 201);
}
