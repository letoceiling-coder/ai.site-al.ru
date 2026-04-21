import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import { prisma } from "@ai/db";

const CHUNK_TARGET = 1800;
const CHUNK_OVERLAP = 200;
const MAX_CHUNKS_PER_DOC = 400;

export type IngestSource = {
  url: string;
  name: string;
  mimeType: string;
  size: number;
};

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Разбиение текста на перекрывающиеся сегменты для RAG. */
export function chunkPlainText(text: string, target = CHUNK_TARGET, overlap = CHUNK_OVERLAP): string[] {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) {
    return [];
  }
  if (t.length <= target) {
    return [t];
  }
  const out: string[] = [];
  let start = 0;
  while (start < t.length && out.length < MAX_CHUNKS_PER_DOC) {
    let end = Math.min(t.length, start + target);
    if (end < t.length) {
      const slice = t.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "), slice.lastIndexOf("? "));
      if (lastBreak > target * 0.35) {
        end = start + lastBreak + 1;
      }
    }
    const piece = t.slice(start, end).trim();
    if (piece) {
      out.push(piece);
    }
    if (end >= t.length) {
      break;
    }
    start = Math.max(end - overlap, start + 1);
  }
  return out;
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
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const tr = await parser.getText();
      return { text: (tr.text ?? "").trim(), note: "PDF" };
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

export async function ingestSourcesToKnowledgeBase(input: {
  tenantId: string;
  knowledgeBaseId: string;
  sources: IngestSource[];
}): Promise<{ created: number; errors: string[] }> {
  const errors: string[] = [];
  let created = 0;

  const base = await prisma.knowledgeBase.findFirst({
    where: { id: input.knowledgeBaseId, tenantId: input.tenantId, deletedAt: null },
  });
  if (!base) {
    throw new Error("KNOWLEDGE_BASE_NOT_FOUND");
  }

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

    const { text, note } = await extractTextFromFile(buffer, src.mimeType, src.name);
    if (!text.trim()) {
      errors.push(`${src.name}: пустой текст${note ? ` (${note})` : ""}`);
      continue;
    }

    const pieces = chunkPlainText(text);
    if (pieces.length === 0) {
      errors.push(`${src.name}: не удалось разбить на фрагменты`);
      continue;
    }

    const titleBase = src.name.replace(/\.[^.]+$/, "") || src.name;
    const objectKey = rel.replace(/^public[\\/]/, "").replace(/\\/g, "/");

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
            chunkCount: pieces.length,
            ingestNote: note ?? null,
          } as object,
        },
      });
      const doc = await tx.document.create({
        data: {
          tenantId: input.tenantId,
          knowledgeItemId: item.id,
          objectKey,
          mimeType: src.mimeType || "application/octet-stream",
          fileSize: src.size,
          parsingStatus: "COMPLETED",
        },
      });
      await tx.chunk.createMany({
        data: pieces.map((content, idx) => ({
          tenantId: input.tenantId,
          documentId: doc.id,
          idx,
          content,
          tokenCount: estimateTokens(content),
        })),
      });
    });

    created += 1;
  }

  return { created, errors };
}
