import type { Prisma } from "@prisma/client";
import { prisma } from "@ai/db";
import { chunkTextStructured, createDocumentWithChunks } from "@/lib/knowledge-ingest";
import { htmlToStructuredMarkdown } from "@/lib/knowledge-chunker";
import { resolveKnowledgeBaseSettings } from "@/lib/knowledge-settings";

const MAX_BYTES = 2 * 1024 * 1024;
const FETCH_MS = 18_000;

function isPrivateHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "ip6-localhost") {
    return true;
  }
  // IPv6 / loopback
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) {
    return true;
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

export function normalizeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }
    if (isPrivateHostname(u.hostname)) {
      return null;
    }
    return u;
  } catch {
    return null;
  }
}

export async function fetchUrlLimited(
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<{ html: string; bytes: number } | { error: string }> {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? FETCH_MS;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
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
    if (len > maxBytes) {
      return { error: "Слишком большой ответ (Content-Length)" };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
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

  const settings = await resolveKnowledgeBaseSettings(input.tenantId, input.knowledgeBaseId);

  const u = normalizeUrl(item.sourceUrl);
  if (!u) {
    await prisma.knowledgeItem.update({
      where: { id: item.id },
      data: {
        status: "FAILED",
        metadata: {
          ...((item.metadata ?? {}) as object),
          urlError: "Некорректный или запрещённый URL",
        },
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
          ...((item.metadata ?? {}) as object),
          urlError: fetched.error,
          fetchedAt: new Date().toISOString(),
        },
      },
    });
    return { ok: false, message: fetched.error };
  }

  const plain = htmlToStructuredMarkdown(fetched.html);
  if (plain.replace(/\s+/g, " ").trim().length < 40) {
    await prisma.knowledgeItem.update({
      where: { id: item.id },
      data: {
        status: "FAILED",
        metadata: {
          ...((item.metadata ?? {}) as object),
          urlError: "Мало текста после очистки HTML",
        },
      },
    });
    return { ok: false, message: "Мало текста на странице" };
  }

  const pieces = chunkTextStructured(plain, settings.chunkSize, settings.chunkOverlap);
  if (pieces.length === 0) {
    await prisma.knowledgeItem.update({
      where: { id: item.id },
      data: {
        status: "FAILED",
        metadata: {
          ...((item.metadata ?? {}) as object),
          urlError: "Не удалось разбить текст",
        },
      },
    });
    return { ok: false, message: "Не удалось разбить текст" };
  }

  const objectKey = `url/${input.tenantId}/${item.id}.txt`;
  const metaBase = (item.metadata ?? {}) as object;

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Удаляем старый Document (и чанки каскадом), если переиндексируем существующий URL-материал.
      await tx.document.deleteMany({ where: { knowledgeItemId: item.id } });
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
            chunkSize: settings.chunkSize,
            chunkOverlap: settings.chunkOverlap,
            urlError: null,
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

/** Извлекает URL-ы из текста sitemap.xml (простой regex по `<loc>`). */
export function parseSitemapUrls(xml: string, limit = 500): string[] {
  const urls: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1];
    if (!raw) continue;
    urls.push(raw.trim());
    if (urls.length >= limit) {
      break;
    }
  }
  return urls;
}
