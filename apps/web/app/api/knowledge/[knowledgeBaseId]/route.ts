import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

type Ctx = { params: Promise<{ knowledgeBaseId: string }> };
type UpdatePayload = { name?: unknown; description?: unknown; visibility?: unknown };

export async function GET(_: Request, context: Ctx) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { knowledgeBaseId } = await context.params;
  const row = await prisma.knowledgeBase.findFirst({
    where: { id: knowledgeBaseId, tenantId: auth.tenantId, deletedAt: null },
  });
  if (!row) {
    return fail("База не найдена", "NOT_FOUND", 404);
  }
  const itemCount = await prisma.knowledgeItem.count({ where: { knowledgeBaseId, tenantId: auth.tenantId } });
  return ok({ knowledgeBase: { ...row, itemCount } });
}

export async function PUT(request: Request, context: Ctx) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { knowledgeBaseId } = await context.params;
  const row = await prisma.knowledgeBase.findFirst({
    where: { id: knowledgeBaseId, tenantId: auth.tenantId, deletedAt: null },
  });
  if (!row) {
    return fail("База не найдена", "NOT_FOUND", 404);
  }
  const body = (await request.json().catch(() => ({}))) as UpdatePayload;
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  if (name === "") {
    return fail("Название не может быть пустым", "VALIDATION_ERROR", 400);
  }
  const data: { name?: string; description?: string | null; visibility?: "PUBLIC" | "PRIVATE" } = {};
  if (name !== undefined) {
    data.name = name;
  }
  if (body.description !== undefined) {
    data.description = typeof body.description === "string" ? body.description.trim() || null : null;
  }
  if (body.visibility === "PUBLIC" || body.visibility === "PRIVATE") {
    data.visibility = body.visibility;
  }
  if (Object.keys(data).length === 0) {
    return fail("Нет полей для обновления", "VALIDATION_ERROR", 400);
  }
  const next = await prisma.knowledgeBase.update({ where: { id: knowledgeBaseId }, data });
  return ok({ knowledgeBase: next });
}

export async function DELETE(_: Request, context: Ctx) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { knowledgeBaseId } = await context.params;
  const row = await prisma.knowledgeBase.findFirst({
    where: { id: knowledgeBaseId, tenantId: auth.tenantId, deletedAt: null },
  });
  if (!row) {
    return fail("База не найдена", "NOT_FOUND", 404);
  }
  await prisma.knowledgeBase.update({
    where: { id: knowledgeBaseId },
    data: { deletedAt: new Date() },
  });
  return ok({ ok: true });
}
