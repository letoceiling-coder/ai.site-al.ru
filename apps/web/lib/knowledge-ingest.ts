import { createHash } from "node:crypto";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "@ai/db";
import {
  DEFAULT_KNOWLEDGE_SETTINGS,
  resolveKnowledgeBaseSettings,
  type KnowledgeSettings,
} from "@/lib/knowledge-settings";
import { chunkStructured, type ChunkPiece } from "@/lib/knowledge-chunker";

const CHUNK_TARGET = DEFAULT_KNOWLEDGE_SETTINGS.chunkSize;
const CHUNK_OVERLAP = DEFAULT_KNOWLEDGE_SETTINGS.chunkOverlap;

/** Выше этого размера текстовый фрагмент режется на Document + Chunk, как файлы. */
export const TEXT_CHUNK_THRESHOLD = 2200;

/** Максимум символов в одном запросе добавления текста. */
export const MAX_KNOWLEDGE_TEXT_CHARS = 500_000;

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
const SKIP_EMBEDDING_JOBS = process.env.DISABLE_EMBEDDING_JOBS === "true";

export type IngestSource = {
  url: string;
  name: string;
  mimeType: string;
  size: number;
};

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Авто-заголовок из первого осмысленного предложения. */
export function deriveTitleFromText(text: string, fallback = "Без названия", maxLen = 80): string {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) {
    return fallback;
  }
  const parts = cleaned
    .split(/[\n.!?](?=\s|$)/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4);
  const raw = (parts.find((p) => /[A-Za-zА-Яа-я0-9]/.test(p)) ?? cleaned).trim();
  return raw.length <= maxLen ? raw : `${raw.slice(0, maxLen - 1).trim()}…`;
}

/**
 * Разбиение текста на перекрывающиеся сегменты для RAG.
 * Использует markdown-aware chunker: если есть `#`-заголовки, режет по ним и сохраняет
 * breadcrumbs (путь по заголовкам) в metadata каждого чанка.
 */
export function chunkTextStructured(
  text: string,
  target = CHUNK_TARGET,
  overlap = CHUNK_OVERLAP,
): ChunkPiece[] {
  return chunkStructured(text, { target, overlap });
}

/** Backward-совместимая обёртка, возвращающая только строки (без metadata). */
export function chunkPlainText(text: string, target = CHUNK_TARGET, overlap = CHUNK_OVERLAP): string[] {
  return chunkTextStructured(text, target, overlap).map((p) => p.content);
}

function publicPathFromUploadUrl(url: string, tenantId: string): string | null {
  const prefix = `/uploads/${tenantId}/`;
  if (!url.startsWith(prefix)) {
    return null;
  }
  const rest = url.slice(prefix.length);
  if (!rest || rest.includes("..") || rest.includes("\\")) {
    return null;
  }
  return join("public", "uploads", tenantId, rest);
}

export async function extractTextFromFile(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<{ text: string; note?: string }> {
  const lower = filename.toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (mime.startsWith("text/") || mime === "application/json" || lower.endsWith(".md") || lower.endsWith(".txt")) {
    return { text: buffer.toString("utf8") };
  }

  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    const t0 = Date.now();
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const tr = await parser.getText();
      const text = (tr.text ?? "").trim();
      const pdfMs = Date.now() - t0;
      return { text, note: `PDF, извлечение ${pdfMs}ms` };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    const mammoth = await import("mammoth");
    const res = await mammoth.extractRawText({ buffer });
    return { text: (res.value ?? "").trim(), note: "DOCX" };
  }

  if (mime === "application/msword" || lower.endsWith(".doc")) {
    return {
      text: "",
      note: "Старый .doc не поддерживается — сохраните как .docx или .pdf.",
    };
  }

  if (mime.startsWith("image/") || mime.startsWith("audio/")) {
    return {
      text: "",
      note: "Изображения и аудио в RAG не извлекаются автоматически — добавьте текст вручную или опишите файл.",
    };
  }

  return { text: "", note: `Формат не поддерживается для авто-извлечения: ${mime || "unknown"}` };
}

type AnyPiece = string | ChunkPiece;

function normalizePiece(p: AnyPiece): ChunkPiece {
  if (typeof p === "string") {
    return { content: p, metadata: null };
  }
  return p;
}

/** Создаёт Document + Chunk + опционально EmbeddingJob (внутри переданной транзакции). */
export async function createDocumentWithChunks(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    knowledgeItemId: string;
    objectKey: string;
    mimeType: string;
    fileSize: number;
    /** Поддерживает как массив строк (legacy), так и ChunkPiece с metadata (breadcrumbs/heading). */
    pieces: AnyPiece[];
  },
) {
  const doc = await tx.document.create({
    data: {
      tenantId: params.tenantId,
      knowledgeItemId: params.knowledgeItemId,
      objectKey: params.objectKey,
      mimeType: params.mimeType,
      fileSize: params.fileSize,
      parsingStatus: "COMPLETED",
    },
  });
  const normalized = params.pieces.map(normalizePiece);
  if (normalized.length > 0) {
    await tx.chunk.createMany({
      data: normalized.map((piece, idx) => ({
        tenantId: params.tenantId,
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
  }
  if (!SKIP_EMBEDDING_JOBS && normalized.length > 0) {
    await tx.embeddingJob.create({
      data: {
        tenantId: params.tenantId,
        documentId: doc.id,
        provider: "OPENAI",
        model: EMBEDDING_MODEL,
        status: "QUEUED",
      },
    });
  }
  return doc;
}

async function removeDuplicateFileIngest(tenantId: string, knowledgeBaseId: string, sourceUrl: string, sha256: string) {
  const dup = await prisma.knowledgeItem.findFirst({
    where: {
      tenantId,
      knowledgeBaseId,
      sourceType: "FILE",
      OR: [
        { metadata: { path: ["sourceUrl"], equals: sourceUrl } },
        { metadata: { path: ["contentSha256"], equals: sha256 } },
      ],
    },
  });
  if (dup) {
    await prisma.knowledgeItem.delete({ where: { id: dup.id } });
  }
}

export async function ingestSourcesToKnowledgeBase(input: {
  tenantId: string;
  knowledgeBaseId: string;
  sources: IngestSource[];
  settings?: KnowledgeSettings;
}): Promise<{ created: number; errors: string[] }> {
  const errors: string[] = [];
  let created = 0;

  const base = await prisma.knowledgeBase.findFirst({
    where: { id: input.knowledgeBaseId, tenantId: input.tenantId, deletedAt: null },
  });
  if (!base) {
    throw new Error("KNOWLEDGE_BASE_NOT_FOUND");
  }
  const settings =
    input.settings ?? (await resolveKnowledgeBaseSettings(input.tenantId, input.knowledgeBaseId));

  for (const src of input.sources) {
    const rel = publicPathFromUploadUrl(src.url, input.tenantId);
    if (!rel) {
      errors.push(`${src.name}: недопустимый путь файла`);
      continue;
    }
    let buffer: Buffer;
    try {
      buffer = await readFile(join(process.cwd(), rel));
    } catch {
      errors.push(`${src.name}: файл не найден на сервере`);
      continue;
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");
    await removeDuplicateFileIngest(input.tenantId, input.knowledgeBaseId, src.url, sha256);

    const ingestT0 = Date.now();
    let parseNote: string | undefined;
    let text: string;
    try {
      const extracted = await extractTextFromFile(buffer, src.mimeType, src.name);
      text = extracted.text;
      parseNote = extracted.note;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${src.name}: ошибка разбора (${msg})`);
      continue;
    }

    if (!text.trim()) {
      errors.push(`${src.name}: пустой текст${parseNote ? ` (${parseNote})` : ""}`);
      continue;
    }

    const pieces = chunkTextStructured(text, settings.chunkSize, settings.chunkOverlap);
    if (pieces.length === 0) {
      errors.push(`${src.name}: не удалось разбить на фрагменты`);
      continue;
    }

    const titleBase = src.name.replace(/\.[^.]+$/, "") || src.name;
    const objectKey = rel.replace(/^public[\\/]/, "").replace(/\\/g, "/");
    const ingestMs = Date.now() - ingestT0;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const item = await tx.knowledgeItem.create({
        data: {
          tenantId: input.tenantId,
          knowledgeBaseId: input.knowledgeBaseId,
          sourceType: "FILE",
          title: titleBase.slice(0, 200),
          content: text.slice(0, 8000),
          status: "COMPLETED",
          metadata: {
            sourceUrl: src.url,
            mimeType: src.mimeType,
            size: src.size,
            contentSha256: sha256,
            chunkCount: pieces.length,
            extractedCharCount: text.length,
            ingestMs,
            ingestNote: parseNote ?? null,
            parserError: null,
            chunkSize: settings.chunkSize,
            chunkOverlap: settings.chunkOverlap,
          } as object,
        },
      });
      await createDocumentWithChunks(tx, {
        tenantId: input.tenantId,
        knowledgeItemId: item.id,
        objectKey,
        mimeType: src.mimeType || "application/octet-stream",
        fileSize: src.size,
        pieces,
      });
    });

    created += 1;
  }

  return { created, errors };
}
