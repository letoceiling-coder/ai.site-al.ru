import { fail, ok } from "@/lib/http";
import { runParseJobsBatch } from "@/lib/knowledge-parse-worker";

export const runtime = "nodejs";
// PDF-парсинг может длиться дольше стандартных 10-30s; ставим 120s.
export const maxDuration = 120;

/**
 * POST /api/knowledge/parse/worker
 * Доступ через секрет (`x-parse-worker-secret` или совместимо `x-embedding-worker-secret`),
 * чтобы cron мог переиспользовать существующий ключ.
 */
export async function POST(request: Request) {
  const parseSecret = process.env.PARSE_WORKER_SECRET?.trim();
  const embeddingSecret = process.env.EMBEDDING_WORKER_SECRET?.trim();
  const expected = parseSecret || embeddingSecret;
  if (!expected) {
    return fail("PARSE_WORKER_SECRET (или EMBEDDING_WORKER_SECRET) не задан", "NOT_CONFIGURED", 503);
  }
  const hdr =
    request.headers.get("x-parse-worker-secret") ??
    request.headers.get("x-embedding-worker-secret") ??
    "";
  if (hdr !== expected) {
    return fail("Forbidden", "FORBIDDEN", 403);
  }

  const res = await runParseJobsBatch(2);
  return ok({ processed: true, ...res });
}
