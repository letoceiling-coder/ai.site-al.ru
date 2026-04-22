/**
 * Фоновый воркер извлечения текста из «тяжёлых» файлов (PDF, DOCX, >1 MB).
 *
 * Веб-ингест при загрузке таких файлов создаёт:
 *   - KnowledgeItem.status = "QUEUED"
 *   - Document.parsingStatus = "QUEUED"  (без Chunk-ов)
 * Этот воркер находит такие документы, открывает файл по `objectKey`,
 * извлекает текст, чанкирует его (markdown-aware), сохраняет `Chunk`s
 * и ставит `EmbeddingJob`, после чего помечает Document как COMPLETED.
 *
 * Запускается через POST /api/knowledge/parse/worker (секрет + cron).
 */

import { join, basename } from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@ai/db";
import { chunkTextStructured, extractTextFromFile } from "@/lib/knowledge-ingest";
import { resolveKnowledgeBaseSettings } from "@/lib/knowledge-settings";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
const SKIP_EMBEDDING_JOBS = process.env.DISABLE_EMBEDDING_JOBS === "true";

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Собрать абсолютный путь к файлу из `Document.objectKey` (обычно `uploads/<tenantId>/<file>`). */
function absolutePathFromObjectKey(objectKey: string): string {
  const clean = objectKey.replace(/^[\\/]+/, "").replace(/\\/g, "/");
  return join(process.cwd(), "public", clean);
}

/** Имя файла для определения расширения/парсера — берём оригинальное, если есть, иначе basename. */
function resolveFilename(itemMeta: unknown, objectKey: string, fallbackTitle: string): string {
  if (itemMeta && typeof itemMeta === "object") {
    const m = itemMeta as Record<string, unknown>;
    if (typeof m.originalFilename === "string" && m.originalFilename.trim()) {
      return m.originalFilename.trim();
    }
  }
  const base = basename(objectKey);
  if (base && base.includes(".")) return base;
  return fallbackTitle;
}

export type ParseJobRunResult = {
  claimed: number;
  completed: number;
  failed: number;
};

/**
 * Забирает до `maxJobs` документов в статусе QUEUED, парсит их, чанкирует, записывает чанки,
 * переводит Document и KnowledgeItem в COMPLETED/FAILED. Между документами — последовательно,
 * чтобы не переполнять память при больших PDF.
 */
export async function runParseJobsBatch(maxJobs = 2): Promise<ParseJobRunResult> {
  const result: ParseJobRunResult = { claimed: 0, completed: 0, failed: 0 };

  // Забираем кандидатов (атомарно помечаем RUNNING, чтобы два воркера не взяли один документ).
  // Используем UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) — классический паттерн PG.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Document"
    SET "parsingStatus" = 'RUNNING', "updatedAt" = NOW()
    WHERE id IN (
      SELECT id FROM "Document"
      WHERE "parsingStatus" = 'QUEUED'
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${maxJobs}
    )
    RETURNING id
  `;
  const claimed = rows.map((r: { id: string }) => r.id);

  result.claimed = claimed.length;
  if (claimed.length === 0) {
    return result;
  }

  for (const documentId of claimed) {
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      include: { knowledgeItem: true },
    });
    if (!doc) {
      result.failed += 1;
      continue;
    }

    const item = doc.knowledgeItem;
    const filename = resolveFilename(item.metadata, doc.objectKey, item.title || doc.objectKey);
    const absPath = absolutePathFromObjectKey(doc.objectKey);

    const t0 = Date.now();
    try {
      const buffer = await readFile(absPath);

      // SHA может уже быть в KnowledgeItem.metadata (посчитан при ingest). Если нет — посчитаем.
      let sha256: string | null = null;
      if (item.metadata && typeof item.metadata === "object") {
        const m = item.metadata as Record<string, unknown>;
        if (typeof m.contentSha256 === "string") sha256 = m.contentSha256;
      }
      if (!sha256) sha256 = createHash("sha256").update(buffer).digest("hex");

      const extracted = await extractTextFromFile(buffer, doc.mimeType, filename);
      const text = (extracted.text ?? "").trim();

      if (!text) {
        throw new Error(`Пустой текст после извлечения${extracted.note ? ` (${extracted.note})` : ""}`);
      }

      const settings = await resolveKnowledgeBaseSettings(item.tenantId, item.knowledgeBaseId);
      const pieces = chunkTextStructured(text, settings.chunkSize, settings.chunkOverlap);
      if (pieces.length === 0) {
        throw new Error("Не удалось разбить текст на фрагменты");
      }

      const ingestMs = Date.now() - t0;

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Страховка: если воркер перезапустился и чанки уже были частично — чистим.
        await tx.chunk.deleteMany({ where: { documentId: doc.id } });

        await tx.chunk.createMany({
          data: pieces.map((piece, idx) => ({
            tenantId: item.tenantId,
            documentId: doc.id,
            idx,
            content: piece.content,
            tokenCount: estimateTokens(piece.content),
            metadata: piece.metadata
              ? ({
                  breadcrumbs: piece.metadata.breadcrumbs,
                  heading: piece.metadata.heading,
                  headingLevel: piece.metadata.headingLevel,
                } as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          })),
        });

        await tx.document.update({
          where: { id: doc.id },
          data: {
            parsingStatus: "COMPLETED",
          },
        });

        await tx.knowledgeItem.update({
          where: { id: item.id },
          data: {
            status: "COMPLETED",
            content: text.slice(0, 8000),
            metadata: {
              ...((item.metadata ?? {}) as object),
              contentSha256: sha256,
              chunkCount: pieces.length,
              extractedCharCount: text.length,
              ingestMs,
              ingestNote: extracted.note ?? null,
              parserError: null,
              parseCompletedAt: new Date().toISOString(),
            } as object,
          },
        });

        if (!SKIP_EMBEDDING_JOBS) {
          await tx.embeddingJob.create({
            data: {
              tenantId: item.tenantId,
              documentId: doc.id,
              provider: "OPENAI",
              model: EMBEDDING_MODEL,
              status: "QUEUED",
            },
          });
        }
      });

      result.completed += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.document.update({
        where: { id: doc.id },
        data: { parsingStatus: "FAILED" },
      }).catch(() => undefined);
      await prisma.knowledgeItem.update({
        where: { id: item.id },
        data: {
          status: "FAILED",
          metadata: {
            ...((item.metadata ?? {}) as object),
            parserError: msg.slice(0, 2000),
            parseFailedAt: new Date().toISOString(),
          } as object,
        },
      }).catch(() => undefined);
      result.failed += 1;
    }
  }

  return result;
}
