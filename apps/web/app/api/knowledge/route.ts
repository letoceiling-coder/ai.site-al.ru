import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

type CreatePayload = { name?: unknown; description?: unknown; visibility?: unknown };

export async function GET() {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const rows = await prisma.knowledgeBase.findMany({
    where: { tenantId: auth.tenantId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
  });
  const items = await Promise.all(
    rows.map(async (row: (typeof rows)[number]) => {
      const c = await prisma.knowledgeItem.count({ where: { knowledgeBaseId: row.id, tenantId: auth.tenantId } });
      return { ...row, itemCount: c };
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
  const row = await prisma.knowledgeBase.create({
    data: {
      tenantId: auth.tenantId,
      name,
      description,
      visibility: vis,
    },
  });
  return ok({ knowledgeBase: row }, 201);
}
