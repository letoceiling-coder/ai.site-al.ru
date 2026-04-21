import { fail, ok } from "@/lib/http";
import { runEmbeddingJobsBatch } from "@/lib/knowledge-embed-worker";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.EMBEDDING_WORKER_SECRET?.trim();
  if (!secret) {
    return fail("EMBEDDING_WORKER_SECRET не задан", "NOT_CONFIGURED", 503);
  }
  const hdr = request.headers.get("x-embedding-worker-secret") ?? "";
  if (hdr !== secret) {
    return fail("Forbidden", "FORBIDDEN", 403);
  }

  await runEmbeddingJobsBatch(6);
  return ok({ processed: true });
}
