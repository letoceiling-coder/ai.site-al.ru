import { Prisma } from "@prisma/client";
import { prisma } from "@ai/db";
import { fetchEmbeddingsBatch, vectorLiteralForSql } from "@/lib/embeddings-api";
import { resolveTenantEmbeddingConfig } from "@/lib/tenant-embedding-config";

const BATCH = 16;

/** Пороги «осиротевших» задач эмбеддинга (см. A7 в аудите). */
const QUEUED_EXPIRE_HOURS = 24;       // QUEUED дольше 24 часов — точно застрял
const RUNNING_STUCK_MINUTES = 30;     // RUNNING без апдейта 30 мин — воркер умер
const TERMINAL_RETENTION_DAYS = 30;   // COMPLETED/FAILED старше 30 дней — удаляем

export type ReconcileStats = {
  noopCompleted: number;    // QUEUED → COMPLETED (у документа уже нет чанков без эмбеддингов)
  queuedExpired: number;    // QUEUED → FAILED (>24ч)
  runningReset: number;     // RUNNING → FAILED (>30 мин)
  terminalPurged: number;   // удалены терминальные старше 30 дней
  orphanPurged: number;     // удалены задачи без связанного документа
};

/**
 * Убирает «мусор» из `EmbeddingJob`: зависшие, просроченные и бессмысленные задачи,
 * а также чистит старые терминальные записи, чтобы таблица не разрасталась.
 * Вызывается перед основной обработкой очереди, а также напрямую по cron.
 */
export async function reconcileEmbeddingJobs(): Promise<ReconcileStats> {
  const now = new Date();

  // 1) no-op QUEUED: у документа уже все чанки с эмбеддингами (или чанков нет вовсе).
  //    Переводим в COMPLETED, чтобы воркер не тратил на них квоту.
  const noopIds = (await prisma.$queryRaw<{ id: string }[]>`
    SELECT ej.id FROM "EmbeddingJob" ej
    WHERE ej.status = 'QUEUED'
      AND NOT EXISTS (
        SELECT 1 FROM "Chunk" c
        WHERE c."documentId" = ej."documentId"
          AND c.embedding IS NULL
      )
    LIMIT 200
  `).map((r: { id: string }) => r.id);
  const noopCompleted =
    noopIds.length > 0
      ? (await prisma.embeddingJob.updateMany({
          where: { id: { in: noopIds } },
          data: { status: "COMPLETED", finishedAt: now },
        })).count
      : 0;

  // 2) Просроченные QUEUED (>24ч) — в FAILED с понятной ошибкой.
  const queuedExpired = (
    await prisma.embeddingJob.updateMany({
      where: {
        status: "QUEUED",
        createdAt: { lt: new Date(now.getTime() - QUEUED_EXPIRE_HOURS * 3600 * 1000) },
      },
      data: {
        status: "FAILED",
        finishedAt: now,
        errorText: `Истёк срок ожидания в очереди (>${QUEUED_EXPIRE_HOURS}ч).`,
      },
    })
  ).count;

  // 3) Зависшие RUNNING (>30 минут) — сбрасываем в FAILED.
  //    НЕ возвращаем в QUEUED чтобы не зациклиться; пересчёт доступен через /reembed.
  const runningReset = (
    await prisma.embeddingJob.updateMany({
      where: {
        status: "RUNNING",
        OR: [
          { startedAt: { lt: new Date(now.getTime() - RUNNING_STUCK_MINUTES * 60 * 1000) } },
          { startedAt: null, updatedAt: { lt: new Date(now.getTime() - RUNNING_STUCK_MINUTES * 60 * 1000) } },
        ],
      },
      data: {
        status: "FAILED",
        finishedAt: now,
        errorText: `Воркер не завершил задачу за ${RUNNING_STUCK_MINUTES} мин, сброшено.`,
      },
    })
  ).count;

  // 4) Терминальные записи старше 30 дней — удаляем, чтобы не раздувать таблицу.
  const terminalPurged = (
    await prisma.embeddingJob.deleteMany({
      where: {
        status: { in: ["COMPLETED", "FAILED"] },
        updatedAt: { lt: new Date(now.getTime() - TERMINAL_RETENTION_DAYS * 86400 * 1000) },
      },
    })
  ).count;

  // 5) Страховка: задачи, у которых документ физически отсутствует (не должно случаться при onDelete: Cascade,
  //    но если кто-то удалит руками — чистим).
  const orphanPurged = Number(
    (await prisma.$executeRaw`
      DELETE FROM "EmbeddingJob" ej
      WHERE NOT EXISTS (SELECT 1 FROM "Document" d WHERE d.id = ej."documentId")
    `) ?? 0,
  );

  return { noopCompleted, queuedExpired, runningReset, terminalPurged, orphanPurged };
}

export async function runEmbeddingJobsBatch(maxJobs = 4) {
  const reconciled = await reconcileEmbeddingJobs();
  const jobs = await prisma.embeddingJob.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: maxJobs,
  });
  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    const emb = await resolveTenantEmbeddingConfig(job.tenantId);
    if (!emb) {
      await prisma.embeddingJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorText: "Нет настроенного API эмбеддингов (OpenRouter или OpenAI).",
        },
      });
      failed += 1;
      continue;
    }

    await prisma.embeddingJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    try {
      const chunks = (await prisma.$queryRaw`
        SELECT id, content FROM "Chunk"
        WHERE "documentId" = ${job.documentId}
          AND embedding IS NULL
        ORDER BY idx ASC
      `) as { id: string; content: string }[];

      if (chunks.length === 0) {
        await prisma.embeddingJob.update({
          where: { id: job.id },
          data: { status: "COMPLETED", finishedAt: new Date() },
        });
        processed += 1;
        continue;
      }

      for (let i = 0; i < chunks.length; i += BATCH) {
        const slice = chunks.slice(i, i + BATCH);
        const { vectors } = await fetchEmbeddingsBatch({
          baseUrl: emb.baseUrl,
          apiKey: emb.apiKey,
          model: emb.model,
          inputs: slice.map((c) => c.content),
        });
        for (let j = 0; j < slice.length; j++) {
          const vec = vectors[j];
          if (!vec?.length) {
            throw new Error("Пустой вектор эмбеддинга");
          }
          const lit = vectorLiteralForSql(vec);
          const chunkId = slice[j]!.id;
          // pgvector принимает текстовый литерал `[1,2,3]` → кастуем к vector.
          // Передаём как параметр (а не через Prisma.raw), чтобы избежать
          // SQL-синтаксической ошибки на необрамлённой квадратной скобке.
          await prisma.$executeRaw(Prisma.sql`
            UPDATE "Chunk" SET embedding = ${lit}::vector WHERE id = ${chunkId}
          `);
        }
      }

      await prisma.embeddingJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", finishedAt: new Date() },
      });
      processed += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.embeddingJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorText: msg.slice(0, 2000),
        },
      });
      failed += 1;
    }
  }
  return { processed, failed, reconciled };
}
