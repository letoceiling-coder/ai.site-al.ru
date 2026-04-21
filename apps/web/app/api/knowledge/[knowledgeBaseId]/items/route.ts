import type { Prisma } from "@prisma/client";
import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import {
  chunkPlainText,
  createDocumentWithChunks,
  MAX_KNOWLEDGE_TEXT_CHARS,
  TEXT_CHUNK_THRESHOLD,
} from "@/lib/knowledge-ingest";
import { processQueuedUrlKnowledgeItem } from "@/lib/url-ingest";

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
  if (st === "TEXT" && content.length > MAX_KNOWLEDGE_TEXT_CHARS) {
    return fail(`Текст слишком длинный (максимум ${MAX_KNOWLEDGE_TEXT_CHARS} символов)`, "VALIDATION_ERROR", 400);
  }
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() || null : null;
  if (st === "URL" && !sourceUrl) {
    return fail("Укажите URL", "VALIDATION_ERROR", 400);
  }

  if (st === "TEXT" && content.length > TEXT_CHUNK_THRESHOLD) {
    const pieces = chunkPlainText(content);
    if (pieces.length === 0) {
      return fail("Не удалось разбить текст на фрагменты", "VALIDATION_ERROR", 400);
    }
    const item = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const row = await tx.knowledgeItem.create({
        data: {
          tenantId: auth.tenantId,
          knowledgeBaseId,
          sourceType: "TEXT",
          title,
          content: content.slice(0, 8000),
          status: "COMPLETED",
          metadata: {
            chunked: true,
            fullCharCount: content.length,
            chunkCount: pieces.length,
          } as object,
        },
      });
      await createDocumentWithChunks(tx, {
        tenantId: auth.tenantId,
        knowledgeItemId: row.id,
        objectKey: `inline/${auth.tenantId}/${row.id}.txt`,
        mimeType: "text/plain",
        fileSize: content.length,
        pieces,
      });
      return row;
    });
    return ok({ item }, 201);
  }

  if (st === "URL") {
    const item = await prisma.knowledgeItem.create({
      data: {
        tenantId: auth.tenantId,
        knowledgeBaseId,
        sourceType: "URL",
        title,
        content: null,
        sourceUrl,
        status: "QUEUED",
        metadata: { urlQueuedAt: new Date().toISOString() } as object,
      },
    });
    const proc = await processQueuedUrlKnowledgeItem({
      tenantId: auth.tenantId,
      knowledgeBaseId,
      itemId: item.id,
    });
    const fresh = await prisma.knowledgeItem.findFirst({
      where: { id: item.id, tenantId: auth.tenantId },
    });
    return ok({ item: fresh ?? item, urlIngest: proc }, 201);
  }

  const item = await prisma.knowledgeItem.create({
    data: {
      tenantId: auth.tenantId,
      knowledgeBaseId,
      sourceType: st,
      title,
      content: st === "TEXT" ? content : null,
      sourceUrl: null,
      status: st === "TEXT" && content ? "COMPLETED" : "QUEUED",
    },
  });
  return ok({ item }, 201);
}
