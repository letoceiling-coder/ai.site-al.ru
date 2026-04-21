import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

type Ctx = { params: Promise<{ knowledgeBaseId: string; itemId: string }> };

export async function DELETE(_: Request, context: Ctx) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { knowledgeBaseId, itemId } = await context.params;
  const base = await prisma.knowledgeBase.findFirst({
    where: { id: knowledgeBaseId, tenantId: auth.tenantId, deletedAt: null },
  });
  if (!base) {
    return fail("База не найдена", "NOT_FOUND", 404);
  }
  const res = await prisma.knowledgeItem.deleteMany({
    where: { id: itemId, knowledgeBaseId, tenantId: auth.tenantId },
  });
  if (res.count === 0) {
    return fail("Запись не найдена", "NOT_FOUND", 404);
  }
  return ok({ ok: true });
}

export async function PUT(request: Request, context: Ctx) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { knowledgeBaseId, itemId } = await context.params;
  const base = await prisma.knowledgeBase.findFirst({
    where: { id: knowledgeBaseId, tenantId: auth.tenantId, deletedAt: null },
  });
  if (!base) {
    return fail("База не найдена", "NOT_FOUND", 404);
  }
  const existing = await prisma.knowledgeItem.findFirst({
    where: { id: itemId, knowledgeBaseId, tenantId: auth.tenantId },
  });
  if (!existing) {
    return fail("Запись не найдена", "NOT_FOUND", 404);
  }
  const body = (await request.json().catch(() => ({}))) as { title?: unknown; content?: unknown };
  const title = typeof body.title === "string" ? body.title.trim() : undefined;
  if (title === "") {
    return fail("Заголовок не может быть пустым", "VALIDATION_ERROR", 400);
  }
  const data: { title?: string; content?: string | null; status?: "COMPLETED" } = {};
  if (title !== undefined) {
    data.title = title;
  }
  if (body.content !== undefined) {
    const c = typeof body.content === "string" ? body.content.trim() : null;
    data.content = c;
    if (c && existing.sourceType === "TEXT") {
      data.status = "COMPLETED";
    }
  }
  if (Object.keys(data).length === 0) {
    return fail("Нет полей", "VALIDATION_ERROR", 400);
  }
  const item = await prisma.knowledgeItem.update({ where: { id: itemId }, data });
  return ok({ item });
}
