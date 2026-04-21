import { Prisma } from "@prisma/client";
import { prisma } from "@ai/db";
import { fetchEmbeddingsBatch, vectorLiteralForSql } from "@/lib/embeddings-api";
import { resolveTenantEmbeddingConfig } from "@/lib/tenant-embedding-config";

const DEFAULT_MAX = 12_000;

type ChunkRow = {
  id: string;
  content: string;
  title: string;
  rank?: number | null;
  dist?: number | null;
};

function extractTerms(userQuery: string) {
  return userQuery
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter((t) => t.length > 1);
}

function sanitizeIlike(term: string) {
  return term.replace(/[%_\\]/g, "").slice(0, 64);
}

function keywordHits(text: string, terms: string[]) {
  if (terms.length === 0) {
    return 0;
  }
  const low = text.toLowerCase();
  return terms.reduce((n, t) => (low.includes(t) ? n + 1 : n), 0);
}

function kbInClause(knowledgeBaseIds: string[]) {
  return Prisma.join(knowledgeBaseIds.map((id) => Prisma.sql`${id}`));
}

/**
 * Собирает контекст из баз знаний: полнотекст (GIN), ILIKE, свежие чанки, семантика (pgvector), плюс короткие текстовые записи без документа.
 * Не загружает все чанки разом — только ограниченные выборки из БД.
 */
export async function buildKnowledgeContextForBases(
  tenantId: string,
  knowledgeBaseIds: string[],
  userQuery: string,
  maxChars: number = DEFAULT_MAX,
) {
  if (knowledgeBaseIds.length === 0) {
    return "";
  }

  const terms = extractTerms(userQuery);
  const kbSql = kbInClause(knowledgeBaseIds);
  const qFts = terms.slice(0, 14).join(" ").slice(0, 400);

  let ftsRows: ChunkRow[] = [];
  if (qFts.length >= 2) {
    try {
      ftsRows = await prisma.$queryRaw<ChunkRow[]>`
        SELECT c.id, c.content, ki.title AS title,
          ts_rank_cd(c.content_tsv, plainto_tsquery('simple', ${qFts})) AS rank
        FROM "Chunk" c
        INNER JOIN "Document" d ON d.id = c."documentId"
        INNER JOIN "KnowledgeItem" ki ON ki.id = d."knowledgeItemId"
        WHERE c."tenantId" = ${tenantId}
          AND ki."knowledgeBaseId" IN (${kbSql})
          AND c.content_tsv @@ plainto_tsquery('simple', ${qFts})
        ORDER BY rank DESC
        LIMIT 60
      `;
    } catch {
      ftsRows = [];
    }
  }

  let ilikeRows: ChunkRow[] = [];
  if (ftsRows.length < 22 && terms.length > 0) {
    const parts = terms
      .map(sanitizeIlike)
      .filter(Boolean)
      .slice(0, 8)
      .map((t) => Prisma.sql`c.content ILIKE ${`%${t}%`}`);
    if (parts.length > 0) {
      const orc = Prisma.join(parts, " OR ");
      try {
        ilikeRows = await prisma.$queryRaw<ChunkRow[]>`
          SELECT c.id, c.content, ki.title AS title, 0::float AS rank
          FROM "Chunk" c
          INNER JOIN "Document" d ON d.id = c."documentId"
          INNER JOIN "KnowledgeItem" ki ON ki.id = d."knowledgeItemId"
          WHERE c."tenantId" = ${tenantId}
            AND ki."knowledgeBaseId" IN (${kbSql})
            AND (${orc})
          ORDER BY ki."updatedAt" DESC
          LIMIT 50
        `;
      } catch {
        ilikeRows = [];
      }
    }
  }

  let recentRows: ChunkRow[] = [];
  if (ftsRows.length + ilikeRows.length < 28) {
    try {
      recentRows = await prisma.$queryRaw<ChunkRow[]>`
        SELECT c.id, c.content, ki.title AS title, 0::float AS rank
        FROM "Chunk" c
        INNER JOIN "Document" d ON d.id = c."documentId"
        INNER JOIN "KnowledgeItem" ki ON ki.id = d."knowledgeItemId"
        WHERE c."tenantId" = ${tenantId}
          AND ki."knowledgeBaseId" IN (${kbSql})
        ORDER BY ki."updatedAt" DESC, c.idx ASC
        LIMIT 55
      `;
    } catch {
      recentRows = [];
    }
  }

  let vectorRows: ChunkRow[] = [];
  const embCfg = await resolveTenantEmbeddingConfig(tenantId);
  const qTrim = userQuery.trim();
  if (embCfg && qTrim.length > 2) {
    try {
      const { vectors } = await fetchEmbeddingsBatch({
        baseUrl: embCfg.baseUrl,
        apiKey: embCfg.apiKey,
        model: embCfg.model,
        inputs: [qTrim.slice(0, 2000)],
      });
      const v = vectors[0];
      if (v?.length) {
        const lit = vectorLiteralForSql(v);
        vectorRows = (await prisma.$queryRaw(Prisma.sql`
          SELECT c.id, c.content, ki.title AS title,
            (c.embedding <=> ${Prisma.raw(`${lit}::vector`)}) AS dist
          FROM "Chunk" c
          INNER JOIN "Document" d ON d.id = c."documentId"
          INNER JOIN "KnowledgeItem" ki ON ki.id = d."knowledgeItemId"
          WHERE c."tenantId" = ${tenantId}
            AND ki."knowledgeBaseId" IN (${kbSql})
            AND c.embedding IS NOT NULL
          ORDER BY dist ASC
          LIMIT 32
        `)) as ChunkRow[];
      }
    } catch {
      vectorRows = [];
    }
  }

  const scored = new Map<string, { body: string; score: number }>();

  const push = (id: string, title: string, content: string, score: number) => {
    const t = content?.trim();
    if (!t) {
      return;
    }
    const body = `[${title}]\n${t}`;
    const prev = scored.get(id);
    if (!prev || score > prev.score) {
      scored.set(id, { body, score });
    }
  };

  for (const r of ftsRows) {
    push(r.id, r.title, r.content, 100 + (Number(r.rank) || 0) * 80);
  }
  for (const r of ilikeRows) {
    push(r.id, r.title, r.content, 45 + keywordHits(r.content, terms) * 5);
  }
  for (const r of recentRows) {
    push(r.id, r.title, r.content, 18 + keywordHits(r.content, terms) * 3);
  }
  for (const r of vectorRows) {
    const dist = Number(r.dist);
    const vPart = Number.isFinite(dist) ? 38 / (1 + dist * 12) : 12;
    push(r.id, r.title, r.content, 28 + vPart);
  }

  const staticItems = await prisma.knowledgeItem
    .findMany({
      where: {
        tenantId,
        knowledgeBaseId: { in: knowledgeBaseIds },
        OR: [
          {
            AND: [{ document: { is: null } }, { content: { not: null } }, { NOT: { content: "" } }],
          },
          {
            AND: [{ sourceType: "URL" }, { sourceUrl: { not: null } }, { document: { is: null } }],
          },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 35,
      select: { title: true, content: true, sourceUrl: true, sourceType: true },
    })
    .catch(() => []);

  const staticParts: { text: string; score: number }[] = [];
  for (const it of staticItems) {
    if (it.content?.trim()) {
      staticParts.push({
        text: `[${it.title}]\n${it.content.trim()}`,
        score: 25 + keywordHits(it.content, terms) * 4,
      });
    } else if (it.sourceUrl?.trim()) {
      staticParts.push({
        text: `[${it.title}]\n${it.sourceUrl.trim()}`,
        score: 8,
      });
    }
  }

  const orderedChunks = [...scored.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .map(([, v]) => v.body);

  const orderedStatic = staticParts.sort((a, b) => b.score - a.score).map((x) => x.text);

  const merged = [...orderedChunks, ...orderedStatic];

  if (merged.length === 0) {
    return "";
  }

  let out = "";
  for (const p of merged) {
    const next = out ? `${out}\n\n${p}` : p;
    if (next.length > maxChars) {
      if (!out) {
        return p.slice(0, maxChars);
      }
      const room = maxChars - out.length - 2;
      if (room > 20) {
        return `${out}\n\n${p.slice(0, room)}`;
      }
      return out.slice(0, maxChars);
    }
    out = next;
  }
  return out;
}
