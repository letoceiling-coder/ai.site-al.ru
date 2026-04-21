import { Prisma } from "@prisma/client";
import { prisma } from "@ai/db";
import { fetchEmbeddingsBatch, vectorLiteralForSql } from "@/lib/embeddings-api";
import { resolveTenantEmbeddingConfig } from "@/lib/tenant-embedding-config";

const BATCH = 16;

export async function runEmbeddingJobsBatch(maxJobs = 4) {
  const jobs = await prisma.embeddingJob.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: maxJobs,
  });

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
          await prisma.$executeRaw(Prisma.sql`
            UPDATE "Chunk" SET embedding = ${Prisma.raw(`${lit}::vector`)} WHERE id = ${chunkId}
          `);
        }
      }

      await prisma.embeddingJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", finishedAt: new Date() },
      });
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
    }
  }
}
