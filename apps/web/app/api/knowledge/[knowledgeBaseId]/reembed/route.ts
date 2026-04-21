import { Prisma } from "@prisma/client";
import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ knowledgeBaseId: string }> };

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";

/**
 * Создаёт EmbeddingJob для каждого Document базы, в котором есть чанки без embedding.
 * Ничего не пересчитывает сразу — воркер (`/api/knowledge/embeddings/worker`) обработает очередь.
 */
export async function POST(_: Request, context: Ctx) {
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

  const rows = (await prisma.$queryRaw(Prisma.sql`
    SELECT d.id AS "documentId",
      COUNT(c.id)::int AS "totalChunks",
      COUNT(CASE WHEN c.embedding IS NULL THEN 1 END)::int AS "missing"
    FROM "Document" d
    INNER JOIN "KnowledgeItem" ki ON ki.id = d."knowledgeItemId"
    LEFT JOIN "Chunk" c ON c."documentId" = d.id
    WHERE d."tenantId" = ${auth.tenantId}
      AND ki."knowledgeBaseId" = ${knowledgeBaseId}
    GROUP BY d.id
  `)) as Array<{ documentId: string; totalChunks: number; missing: number }>;

  const targets = rows.filter((r) => r.totalChunks > 0 && r.missing > 0);
  if (targets.length === 0) {
    return ok({ queued: 0, totalDocuments: rows.length, message: "Все чанки уже имеют эмбеддинги" });
  }

  // Снимаем старые QUEUED-задачи этих документов, чтобы не плодить дубли.
  await prisma.embeddingJob.updateMany({
    where: {
      tenantId: auth.tenantId,
      documentId: { in: targets.map((t) => t.documentId) },
      status: "QUEUED",
    },
    data: { status: "FAILED", errorText: "Отменено новым запросом reembed" },
  });

  await prisma.embeddingJob.createMany({
    data: targets.map((t) => ({
      tenantId: auth.tenantId,
      documentId: t.documentId,
      provider: "OPENAI",
      model: EMBEDDING_MODEL,
      status: "QUEUED",
    })),
  });

  return ok({
    queued: targets.length,
    totalDocuments: rows.length,
    missing: targets.reduce((n, t) => n + t.missing, 0),
  });
}
