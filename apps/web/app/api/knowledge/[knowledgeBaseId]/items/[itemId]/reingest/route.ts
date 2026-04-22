import type { Prisma } from "@prisma/client";
import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import {
  chunkTextStructured,
  createDocumentWithChunks,
  sha256OfText,
} from "@/lib/knowledge-ingest";
import { processQueuedUrlKnowledgeItem } from "@/lib/url-ingest";
import { resolveKnowledgeBaseSettings } from "@/lib/knowledge-settings";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ knowledgeBaseId: string; itemId: string }> };

export async function POST(_: Request, context: Ctx) {
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
  const item = await prisma.knowledgeItem.findFirst({
    where: { id: itemId, knowledgeBaseId, tenantId: auth.tenantId },
  });
  if (!item) {
    return fail("Запись не найдена", "NOT_FOUND", 404);
  }

  if (item.sourceType === "URL") {
    const proc = await processQueuedUrlKnowledgeItem({
      tenantId: auth.tenantId,
      knowledgeBaseId,
      itemId,
    });
    const fresh = await prisma.knowledgeItem.findFirst({ where: { id: itemId } });
    return ok({ item: fresh ?? item, urlIngest: proc });
  }

  if (item.sourceType === "TEXT") {
    const content = (item.content ?? "").trim();
    if (!content) {
      return fail("В записи нет текста для переиндексации", "VALIDATION_ERROR", 400);
    }
    const settings = await resolveKnowledgeBaseSettings(auth.tenantId, knowledgeBaseId);
    const pieces = chunkTextStructured(content, settings.chunkSize, settings.chunkOverlap);
    if (pieces.length === 0) {
      return fail("Не удалось разбить текст на фрагменты", "VALIDATION_ERROR", 400);
    }
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.document.deleteMany({ where: { knowledgeItemId: itemId } });
      await tx.knowledgeItem.update({
        where: { id: itemId },
        data: {
          status: "COMPLETED",
          metadata: {
            ...((item.metadata ?? {}) as object),
            reingestedAt: new Date().toISOString(),
            chunkCount: pieces.length,
            chunkSize: settings.chunkSize,
            chunkOverlap: settings.chunkOverlap,
            contentSha256: sha256OfText(content),
          } as object,
        },
      });
      await createDocumentWithChunks(tx, {
        tenantId: auth.tenantId,
        knowledgeItemId: itemId,
        objectKey: `inline/${auth.tenantId}/${itemId}.txt`,
        mimeType: "text/plain",
        fileSize: content.length,
        pieces,
      });
    });
    const fresh = await prisma.knowledgeItem.findFirst({ where: { id: itemId } });
    return ok({ item: fresh ?? item });
  }

  // FILE: нет надёжного способа снова прочитать исходный файл без upload-пути; перезагрузите через "Файлы → RAG".
  return fail(
    "Для FILE используйте повторную загрузку файла (оригинал не сохраняется отдельно).",
    "UNSUPPORTED",
    400,
  );
}
