import type { Prisma } from "@prisma/client";
import { prisma } from "@ai/db";
import { chunkPlainText, createDocumentWithChunks } from "@/lib/knowledge-ingest";

const MAX_BYTES = 2 * 1024 * 1024;
const FETCH_MS = 18_000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|br|h1|h2|h3|h4|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }
    return u;
  } catch {
    return null;
  }
}

async function fetchUrlLimited(url: string): Promise<{ html: string; bytes: number } | { error: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "ai.site-al.ru-knowledge-ingest/1.0",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_BYTES) {
      return { error: "Слишком большой ответ (Content-Length)" };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return { error: "Слишком большой ответ" };
    }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return { html, bytes: buf.byteLength };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch error";
    return { error: msg.includes("abort") ? "Таймаут загрузки" : msg };
  } finally {
    clearTimeout(t);
  }
}

/** Загрузка URL, очистка HTML, чанкование и привязка Document (после создания KnowledgeItem типа URL). */
export async function processQueuedUrlKnowledgeItem(input: {
  tenantId: string;
  knowledgeBaseId: string;
  itemId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const item = await prisma.knowledgeItem.findFirst({
    where: {
      id: input.itemId,
      tenantId: input.tenantId,
      knowledgeBaseId: input.knowledgeBaseId,
      sourceType: "URL",
    },
  });
  if (!item?.sourceUrl) {
    return { ok: false, message: "Запись не найдена" };
  }

  const u = normalizeUrl(item.sourceUrl);
  if (!u) {
    await prisma.knowledgeItem.update({
      where: { id: item.id },
      data: {
        status: "FAILED",
        metadata: { ...(item.metadata as object), urlError: "Некорректный URL" },
      },
    });
    return { ok: false, message: "Некорректный URL" };
  }

  const fetched = await fetchUrlLimited(u.toString());
  if ("error" in fetched) {
    await prisma.knowledgeItem.update({
      where: { id: item.id },
      data: {
        status: "FAILED",
        metadata: {
          ...(item.metadata as object),
          urlError: fetched.error,
          fetchedAt: new Date().toISOString(),
        },
      },
    });
    return { ok: false, message: fetched.error };
  }

  const plain = stripHtml(fetched.html);
  if (plain.length < 40) {
    await prisma.knowledgeItem.update({
      where: { id: item.id },
      data: {
        status: "FAILED",
        metadata: { ...(item.metadata as object), urlError: "Мало текста после очистки HTML" },
      },
    });
    return { ok: false, message: "Мало текста на странице" };
  }

  const pieces = chunkPlainText(plain);
  if (pieces.length === 0) {
    await prisma.knowledgeItem.update({
      where: { id: item.id },
      data: {
        status: "FAILED",
        metadata: { ...(item.metadata as object), urlError: "Не удалось разбить текст" },
      },
    });
    return { ok: false, message: "Не удалось разбить текст" };
  }

  const objectKey = `url/${input.tenantId}/${item.id}.txt`;
  const metaBase = (item.metadata ?? {}) as object;

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.knowledgeItem.update({
        where: { id: item.id },
        data: {
          status: "COMPLETED",
          content: plain.slice(0, 8000),
          metadata: {
            ...metaBase,
            urlFetchedAt: new Date().toISOString(),
            urlBytes: fetched.bytes,
            chunkCount: pieces.length,
          },
        },
      });
      await createDocumentWithChunks(tx, {
        tenantId: input.tenantId,
        knowledgeItemId: item.id,
        objectKey,
        mimeType: "text/plain",
        fileSize: plain.length,
        pieces,
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.knowledgeItem.update({
      where: { id: item.id },
      data: {
        status: "FAILED",
        metadata: { ...metaBase, urlError: msg },
      },
    });
    return { ok: false, message: msg };
  }

  return { ok: true };
}
