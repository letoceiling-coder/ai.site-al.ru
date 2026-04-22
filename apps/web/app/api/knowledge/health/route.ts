import { prisma } from "@ai/db";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";

export const runtime = "nodejs";

/**
 * GET /api/knowledge/health
 * Сводные метрики для страницы «Здоровье базы знаний». Только по текущему тенанту.
 * Все агрегаты — через SQL, без выкачивания строк в память.
 */
export async function GET() {
  const auth = await getAuthContext();
  if (!auth) {
    return fail("Unauthorized", "UNAUTHORIZED", 401);
  }
  const tenantId = auth.tenantId;
  const STUCK_RUNNING_SEC = 15 * 60; // 15 минут — порог «зависшего» воркера

  // ── totals ──────────────────────────────────────────────────────────
  const [knowledgeBases, knowledgeItems, documents] = await Promise.all([
    prisma.knowledgeBase.count({ where: { tenantId, deletedAt: null } }),
    prisma.knowledgeItem.count({ where: { tenantId } }),
    prisma.document.count({ where: { tenantId } }),
  ]);

  const chunkRow = (await prisma.$queryRaw<{ total: bigint; with_emb: bigint }[]>`
    SELECT COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE c.embedding IS NOT NULL)::bigint AS with_emb
    FROM "Chunk" c
    WHERE c."tenantId" = ${tenantId}
  `)[0] ?? { total: 0n, with_emb: 0n };
  const chunks = Number(chunkRow.total);
  const chunksWithEmbedding = Number(chunkRow.with_emb);
  const embeddingCoveragePct = chunks > 0 ? Math.round((chunksWithEmbedding / chunks) * 1000) / 10 : 0;

  // ── KnowledgeItem by status ─────────────────────────────────────────
  const itemStatusRows = await prisma.knowledgeItem.groupBy({
    by: ["status"],
    where: { tenantId },
    _count: { _all: true },
  });
  const itemStatus: Record<string, number> = { QUEUED: 0, RUNNING: 0, COMPLETED: 0, FAILED: 0 };
  for (const row of itemStatusRows) {
    itemStatus[row.status] = row._count._all;
  }

  // ── Document.parsingStatus (очередь парсинга) ───────────────────────
  const docStatusRows = await prisma.document.groupBy({
    by: ["parsingStatus"],
    where: { tenantId },
    _count: { _all: true },
  });
  const docStatus: Record<string, number> = { QUEUED: 0, RUNNING: 0, COMPLETED: 0, FAILED: 0 };
  for (const row of docStatusRows) {
    docStatus[row.parsingStatus] = row._count._all;
  }

  const oldestParseQueuedRow = await prisma.document.findFirst({
    where: { tenantId, parsingStatus: "QUEUED" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const parseStuck = await prisma.document.count({
    where: {
      tenantId,
      parsingStatus: "RUNNING",
      updatedAt: { lt: new Date(Date.now() - STUCK_RUNNING_SEC * 1000) },
    },
  });

  // ── EmbeddingJob (очередь эмбеддингов) ──────────────────────────────
  const embStatusRows = await prisma.embeddingJob.groupBy({
    by: ["status"],
    where: { tenantId },
    _count: { _all: true },
  });
  const embStatus: Record<string, number> = { QUEUED: 0, RUNNING: 0, COMPLETED: 0, FAILED: 0 };
  for (const row of embStatusRows) {
    embStatus[row.status] = row._count._all;
  }
  const oldestEmbQueuedRow = await prisma.embeddingJob.findFirst({
    where: { tenantId, status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const embStuck = await prisma.embeddingJob.count({
    where: {
      tenantId,
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - STUCK_RUNNING_SEC * 1000) },
    },
  });

  // ── Per-base breakdown (top 10 по числу чанков) ─────────────────────
  type PerBaseRow = {
    id: string;
    name: string;
    items: bigint;
    chunks: bigint;
    with_emb: bigint;
    last_updated: Date | null;
  };
  const perBaseRows = await prisma.$queryRaw<PerBaseRow[]>`
    SELECT kb.id, kb.name,
      COUNT(DISTINCT ki.id)::bigint AS items,
      COUNT(c.id)::bigint AS chunks,
      COUNT(c.id) FILTER (WHERE c.embedding IS NOT NULL)::bigint AS with_emb,
      MAX(ki."updatedAt") AS last_updated
    FROM "KnowledgeBase" kb
    LEFT JOIN "KnowledgeItem" ki
      ON ki."knowledgeBaseId" = kb.id AND ki."tenantId" = ${tenantId}
    LEFT JOIN "Document" d ON d."knowledgeItemId" = ki.id
    LEFT JOIN "Chunk" c ON c."documentId" = d.id
    WHERE kb."tenantId" = ${tenantId} AND kb."deletedAt" IS NULL
    GROUP BY kb.id, kb.name
    ORDER BY chunks DESC, items DESC
    LIMIT 10
  `;
  const perBase = perBaseRows.map((r: PerBaseRow) => {
    const items = Number(r.items);
    const chunks = Number(r.chunks);
    const withEmb = Number(r.with_emb);
    return {
      id: r.id,
      name: r.name,
      items,
      chunks,
      chunksWithEmbedding: withEmb,
      coveragePct: chunks > 0 ? Math.round((withEmb / chunks) * 1000) / 10 : 0,
      lastUpdatedAt: r.last_updated ? r.last_updated.toISOString() : null,
    };
  });

  // ── Recent failures (объединяем KnowledgeItem FAILED / EmbeddingJob FAILED) ──
  const failedItems = await prisma.knowledgeItem.findMany({
    where: { tenantId, status: "FAILED" },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: {
      updatedAt: true,
      title: true,
      metadata: true,
      knowledgeBase: { select: { name: true } },
    },
  });
  const failedEmb = await prisma.embeddingJob.findMany({
    where: { tenantId, status: "FAILED" },
    orderBy: { finishedAt: "desc" },
    take: 5,
    select: {
      finishedAt: true,
      startedAt: true,
      errorText: true,
      document: {
        select: {
          knowledgeItem: { select: { title: true, knowledgeBase: { select: { name: true } } } },
        },
      },
    },
  });

  type FailedItem = (typeof failedItems)[number];
  type FailedEmb = (typeof failedEmb)[number];
  const recentFailures = [
    ...failedItems.map((f: FailedItem) => {
      let msg = "";
      if (f.metadata && typeof f.metadata === "object") {
        const m = f.metadata as Record<string, unknown>;
        if (typeof m.parserError === "string") msg = m.parserError;
        else if (typeof m.urlError === "string") msg = m.urlError;
      }
      return {
        at: f.updatedAt.toISOString(),
        scope: "item" as const,
        title: f.title,
        knowledgeBase: f.knowledgeBase?.name ?? "",
        message: (msg || "Ошибка ingest").slice(0, 500),
      };
    }),
    ...failedEmb.map((f: FailedEmb) => ({
      at: (f.finishedAt ?? f.startedAt ?? new Date(0)).toISOString(),
      scope: "embedding" as const,
      title: f.document?.knowledgeItem?.title ?? "—",
      knowledgeBase: f.document?.knowledgeItem?.knowledgeBase?.name ?? "",
      message: (f.errorText ?? "Ошибка эмбеддинга").slice(0, 500),
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  // ── p95 ingestMs (по последним 500 успешным items) ──────────────────
  const sample = await prisma.knowledgeItem.findMany({
    where: { tenantId, status: "COMPLETED" },
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: { metadata: true },
  });
  const ingestTimings: number[] = [];
  for (const row of sample) {
    if (row.metadata && typeof row.metadata === "object") {
      const m = row.metadata as Record<string, unknown>;
      const v = typeof m.ingestMs === "number" ? m.ingestMs : null;
      if (v && Number.isFinite(v) && v > 0) ingestTimings.push(v);
    }
  }
  ingestTimings.sort((a, b) => a - b);
  const p95 =
    ingestTimings.length > 0
      ? ingestTimings[Math.min(ingestTimings.length - 1, Math.floor(ingestTimings.length * 0.95))]
      : null;

  const now = Date.now();
  const ageSec = (d: Date | null | undefined) => (d ? Math.max(0, Math.round((now - d.getTime()) / 1000)) : null);

  return ok({
    generatedAt: new Date().toISOString(),
    totals: {
      knowledgeBases,
      knowledgeItems,
      documents,
      chunks,
      chunksWithEmbedding,
      embeddingCoveragePct,
    },
    items: itemStatus,
    parseQueue: {
      ...docStatus,
      oldestQueuedAgeSec: ageSec(oldestParseQueuedRow?.createdAt ?? null),
      stuckRunning: parseStuck,
    },
    embeddingQueue: {
      ...embStatus,
      oldestQueuedAgeSec: ageSec(oldestEmbQueuedRow?.createdAt ?? null),
      stuckRunning: embStuck,
    },
    perBase,
    recentFailures,
    ingestMsP95: p95,
  });
}
