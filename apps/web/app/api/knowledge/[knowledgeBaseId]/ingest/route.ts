import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { ingestSourcesToKnowledgeBase, type IngestSource } from "@/lib/knowledge-ingest";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ knowledgeBaseId: string }> };

type Body = { files?: unknown };

function parseSources(body: Body): IngestSource[] | null {
  if (!Array.isArray(body.files)) {
    return null;
  }
  const out: IngestSource[] = [];
  for (const row of body.files.slice(0, 8)) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const o = row as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url.trim() : "";
    const name = typeof o.name === "string" ? o.name.trim() : "file";
    const mimeType = typeof o.mimeType === "string" ? o.mimeType : "application/octet-stream";
    const size = typeof o.size === "number" && o.size > 0 ? o.size : 0;
    if (!url) {
      continue;
    }
    out.push({ url, name, mimeType, size });
  }
  return out.length ? out : null;
}

export async function POST(request: Request, context: Ctx) {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { knowledgeBaseId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Body;
  const sources = parseSources(body);
  if (!sources?.length) {
    return fail("Передайте files: [{ url, name, mimeType, size }] после загрузки через /api/uploads", "VALIDATION_ERROR", 400);
  }

  try {
    const result = await ingestSourcesToKnowledgeBase({
      tenantId: auth.tenantId,
      knowledgeBaseId,
      sources,
    });
    if (result.created === 0 && result.errors.length) {
      return fail(result.errors.join(" · "), "INGEST_ERROR", 422);
    }
    return ok({
      created: result.created,
      errors: result.errors,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "KNOWLEDGE_BASE_NOT_FOUND") {
      return fail("База не найдена", "NOT_FOUND", 404);
    }
    throw e;
  }
}
