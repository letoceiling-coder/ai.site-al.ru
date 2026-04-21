import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import {
  fetchUrlLimited,
  normalizeUrl,
  parseSitemapUrls,
  processQueuedUrlKnowledgeItem,
} from "@/lib/url-ingest";
import { resolveKnowledgeBaseSettings } from "@/lib/knowledge-settings";
import { deriveTitleFromText } from "@/lib/knowledge-ingest";

export const runtime = "nodejs";
export const maxDuration = 300;

type Payload = {
  urls?: unknown;
  sitemap?: unknown;
  limit?: unknown;
};

type Ctx = { params: Promise<{ knowledgeBaseId: string }> };

const MAX_URLS_PER_REQUEST = 40;

function titleFromUrl(u: string): string {
  try {
    const url = new URL(u);
    const last = url.pathname.split("/").filter(Boolean).pop() ?? url.hostname;
    const pretty = decodeURIComponent(last)
      .replace(/[-_]+/g, " ")
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .trim();
    const title = pretty ? `${pretty} — ${url.hostname}` : url.hostname;
    return title.slice(0, 200);
  } catch {
    return u.slice(0, 120);
  }
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
  const settings = await resolveKnowledgeBaseSettings(auth.tenantId, knowledgeBaseId);
  const body = (await request.json().catch(() => ({}))) as Payload;
  const sitemapUrl = typeof body.sitemap === "string" ? body.sitemap.trim() : "";
  const limit = typeof body.limit === "number" && body.limit > 0 ? Math.min(MAX_URLS_PER_REQUEST, Math.round(body.limit)) : MAX_URLS_PER_REQUEST;

  let rawUrls: string[] = [];
  if (Array.isArray(body.urls)) {
    rawUrls = body.urls.filter((v): v is string => typeof v === "string");
  } else if (typeof body.urls === "string") {
    rawUrls = body.urls.split(/\s+|,|;/);
  }

  if (sitemapUrl) {
    const sm = normalizeUrl(sitemapUrl);
    if (!sm) {
      return fail("Некорректный URL sitemap", "VALIDATION_ERROR", 400);
    }
    const fetched = await fetchUrlLimited(sm.toString(), { maxBytes: 4 * 1024 * 1024 });
    if ("error" in fetched) {
      return fail(`Sitemap: ${fetched.error}`, "SITEMAP_FETCH_ERROR", 502);
    }
    const fromSm = parseSitemapUrls(fetched.html, limit);
    rawUrls = [...fromSm, ...rawUrls];
  }

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of rawUrls) {
    const u = normalizeUrl(raw);
    if (!u) {
      continue;
    }
    const key = u.toString();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    urls.push(key);
    if (urls.length >= limit) {
      break;
    }
  }

  if (urls.length === 0) {
    return fail("Нет ни одного корректного URL", "VALIDATION_ERROR", 400);
  }

  const results: Array<{
    url: string;
    itemId: string | null;
    ok: boolean;
    message?: string;
  }> = [];

  let created = 0;
  let failed = 0;

  for (const url of urls) {
    let itemId: string | null = null;
    try {
      const existing = await prisma.knowledgeItem.findFirst({
        where: {
          tenantId: auth.tenantId,
          knowledgeBaseId,
          sourceType: "URL",
          sourceUrl: url,
        },
      });
      if (existing) {
        itemId = existing.id;
      } else {
        const item = await prisma.knowledgeItem.create({
          data: {
            tenantId: auth.tenantId,
            knowledgeBaseId,
            sourceType: "URL",
            title: settings.autoTitle ? titleFromUrl(url) : deriveTitleFromText(url, url),
            sourceUrl: url,
            status: "QUEUED",
            metadata: { urlQueuedAt: new Date().toISOString(), source: sitemapUrl ? "sitemap" : "batch" } as object,
          },
        });
        itemId = item.id;
      }
      if (!itemId) {
        throw new Error("Не удалось создать запись");
      }
      const proc = await processQueuedUrlKnowledgeItem({
        tenantId: auth.tenantId,
        knowledgeBaseId,
        itemId,
      });
      if (proc.ok) {
        created += 1;
        results.push({ url, itemId, ok: true });
      } else {
        failed += 1;
        results.push({ url, itemId, ok: false, message: proc.message });
      }
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ url, itemId, ok: false, message: msg });
    }
  }

  return ok({
    total: urls.length,
    created,
    failed,
    results,
  });
}
