import { Prisma } from "@prisma/client";
import { prisma } from "@ai/db";
import { fetchEmbeddingsBatch, vectorLiteralForSql } from "@/lib/embeddings-api";
import { resolveTenantEmbeddingConfig } from "@/lib/tenant-embedding-config";

const DEFAULT_MAX = 12_000;

/** Единый формат цитаты, сохраняемый в Message.metadata.citations */
export type KnowledgeCitation = {
  marker: string; // "#1", "#2" ...
  chunkId: string | null;
  knowledgeBaseId: string;
  knowledgeBaseName: string | null;
  knowledgeItemId: string;
  title: string;
  sourceType: "FILE" | "TEXT" | "URL" | null;
  sourceUrl: string | null;
};

type ChunkRow = {
  id: string;
  content: string;
  title: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string | null;
  knowledgeItemId: string;
  sourceType: string | null;
  sourceUrl: string | null;
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

function normalizeSourceType(raw: string | null | undefined): "FILE" | "TEXT" | "URL" | null {
  if (raw === "FILE" || raw === "TEXT" || raw === "URL") {
    return raw;
  }
  return null;
}

type ContextPart = {
  key: string; // уникальный ключ для мерджа (chunkId или item:<id>)
  body: string; // уже готовая подстрока с маркером: "⟨#N⟩ [title]\n<text>"
  score: number;
  citation: Omit<KnowledgeCitation, "marker"> & { marker?: string };
};

export type KnowledgeContextResult = {
  /** Текст, готовый для вставки в системный промпт. Пустая строка — ничего не нашли. */
  text: string;
  /** Цитаты, реально попавшие в текст. Маркеры `#1`, `#2`… */
  citations: KnowledgeCitation[];
  /** true если есть хотя бы одна цитата (удобно для ветки «требовать ссылки» в промпте). */
  hasCitations: boolean;
};

/**
 * Собирает контекст из баз знаний: полнотекст (GIN), ILIKE, свежие чанки, семантика (pgvector),
 * плюс короткие TEXT/URL без документа. Возвращает текст с маркерами `⟨#N⟩` + список цитат.
 * Не загружает все чанки разом — только ограниченные выборки из БД.
 */
export async function buildKnowledgeContextForBases(
  tenantId: string,
  knowledgeBaseIds: string[],
  userQuery: string,
  maxChars: number = DEFAULT_MAX,
): Promise<KnowledgeContextResult> {
  if (knowledgeBaseIds.length === 0) {
    return { text: "", citations: [], hasCitations: false };
  }

  const terms = extractTerms(userQuery);
  const kbSql = kbInClause(knowledgeBaseIds);
  const qFts = terms.slice(0, 14).join(" ").slice(0, 400);

  let ftsRows: ChunkRow[] = [];
  if (qFts.length >= 2) {
    try {
      ftsRows = await prisma.$queryRaw<ChunkRow[]>`
        SELECT c.id, c.content, ki.title AS title,
          ki."knowledgeBaseId" AS "knowledgeBaseId",
          kb.name AS "knowledgeBaseName",
          ki.id AS "knowledgeItemId",
          ki."sourceType"::text AS "sourceType",
          ki."sourceUrl" AS "sourceUrl",
          ts_rank_cd(c.content_tsv, plainto_tsquery('simple', ${qFts})) AS rank
        FROM "Chunk" c
        INNER JOIN "Document" d ON d.id = c."documentId"
        INNER JOIN "KnowledgeItem" ki ON ki.id = d."knowledgeItemId"
        INNER JOIN "KnowledgeBase" kb ON kb.id = ki."knowledgeBaseId"
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
          SELECT c.id, c.content, ki.title AS title,
            ki."knowledgeBaseId" AS "knowledgeBaseId",
            kb.name AS "knowledgeBaseName",
            ki.id AS "knowledgeItemId",
            ki."sourceType"::text AS "sourceType",
            ki."sourceUrl" AS "sourceUrl",
            0::float AS rank
          FROM "Chunk" c
          INNER JOIN "Document" d ON d.id = c."documentId"
          INNER JOIN "KnowledgeItem" ki ON ki.id = d."knowledgeItemId"
          INNER JOIN "KnowledgeBase" kb ON kb.id = ki."knowledgeBaseId"
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
        SELECT c.id, c.content, ki.title AS title,
          ki."knowledgeBaseId" AS "knowledgeBaseId",
          kb.name AS "knowledgeBaseName",
          ki.id AS "knowledgeItemId",
          ki."sourceType"::text AS "sourceType",
          ki."sourceUrl" AS "sourceUrl",
          0::float AS rank
        FROM "Chunk" c
        INNER JOIN "Document" d ON d.id = c."documentId"
        INNER JOIN "KnowledgeItem" ki ON ki.id = d."knowledgeItemId"
        INNER JOIN "KnowledgeBase" kb ON kb.id = ki."knowledgeBaseId"
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
            ki."knowledgeBaseId" AS "knowledgeBaseId",
            kb.name AS "knowledgeBaseName",
            ki.id AS "knowledgeItemId",
            ki."sourceType"::text AS "sourceType",
            ki."sourceUrl" AS "sourceUrl",
            (c.embedding <=> ${Prisma.raw(`${lit}::vector`)}) AS dist
          FROM "Chunk" c
          INNER JOIN "Document" d ON d.id = c."documentId"
          INNER JOIN "KnowledgeItem" ki ON ki.id = d."knowledgeItemId"
          INNER JOIN "KnowledgeBase" kb ON kb.id = ki."knowledgeBaseId"
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

  const scored = new Map<string, ContextPart>();
  const push = (row: ChunkRow, score: number) => {
    const t = row.content?.trim();
    if (!t) {
      return;
    }
    const key = `chunk:${row.id}`;
    const prev = scored.get(key);
    if (prev && prev.score >= score) {
      return;
    }
    scored.set(key, {
      key,
      score,
      body: t, // маркер припишем позже, когда будем знать финальный номер
      citation: {
        chunkId: row.id,
        knowledgeBaseId: row.knowledgeBaseId,
        knowledgeBaseName: row.knowledgeBaseName,
        knowledgeItemId: row.knowledgeItemId,
        title: row.title,
        sourceType: normalizeSourceType(row.sourceType),
        sourceUrl: row.sourceUrl?.trim() || null,
      },
    });
  };

  for (const r of ftsRows) {
    push(r, 100 + (Number(r.rank) || 0) * 80);
  }
  for (const r of ilikeRows) {
    push(r, 45 + keywordHits(r.content, terms) * 5);
  }
  for (const r of recentRows) {
    push(r, 18 + keywordHits(r.content, terms) * 3);
  }
  for (const r of vectorRows) {
    const dist = Number(r.dist);
    const vPart = Number.isFinite(dist) ? 38 / (1 + dist * 12) : 12;
    push(r, 28 + vPart);
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
      select: {
        id: true,
        title: true,
        content: true,
        sourceUrl: true,
        sourceType: true,
        knowledgeBaseId: true,
        knowledgeBase: { select: { name: true } },
      },
    })
    .catch(() => [] as never);

  const staticParts: ContextPart[] = [];
  for (const it of staticItems as Array<{
    id: string;
    title: string;
    content: string | null;
    sourceUrl: string | null;
    sourceType: string | null;
    knowledgeBaseId: string;
    knowledgeBase: { name: string } | null;
  }>) {
    const commonCitation = {
      chunkId: null,
      knowledgeBaseId: it.knowledgeBaseId,
      knowledgeBaseName: it.knowledgeBase?.name ?? null,
      knowledgeItemId: it.id,
      title: it.title,
      sourceType: normalizeSourceType(it.sourceType),
      sourceUrl: it.sourceUrl?.trim() || null,
    };
    if (it.content?.trim()) {
      staticParts.push({
        key: `item:${it.id}:text`,
        body: it.content.trim(),
        score: 25 + keywordHits(it.content, terms) * 4,
        citation: commonCitation,
      });
    } else if (it.sourceUrl?.trim()) {
      staticParts.push({
        key: `item:${it.id}:url`,
        body: it.sourceUrl.trim(),
        score: 8,
        citation: commonCitation,
      });
    }
  }

  const ordered: ContextPart[] = [
    ...[...scored.values()].sort((a, b) => b.score - a.score),
    ...staticParts.sort((a, b) => b.score - a.score),
  ];

  if (ordered.length === 0) {
    return { text: "", citations: [], hasCitations: false };
  }

  let out = "";
  const citations: KnowledgeCitation[] = [];
  for (const p of ordered) {
    const marker = `#${citations.length + 1}`;
    const header = `⟨${marker}⟩ [${p.citation.title || "Без названия"}]`;
    const piece = `${header}\n${p.body}`;
    const next = out ? `${out}\n\n${piece}` : piece;
    if (next.length > maxChars) {
      if (!out) {
        const trimmed = piece.slice(0, maxChars);
        citations.push({ ...p.citation, marker });
        return { text: trimmed, citations, hasCitations: true };
      }
      const room = maxChars - out.length - 2;
      if (room > header.length + 20) {
        citations.push({ ...p.citation, marker });
        return { text: `${out}\n\n${piece.slice(0, room)}`, citations, hasCitations: true };
      }
      return { text: out, citations, hasCitations: citations.length > 0 };
    }
    out = next;
    citations.push({ ...p.citation, marker });
  }
  return { text: out, citations, hasCitations: citations.length > 0 };
}

/* ---------------------------------------------------------------------
 * Структурированный поиск (для tool `search_knowledge_base`).
 * Возвращает список цитат с метаданными (kbId, itemId, title, sourceUrl).
 * ------------------------------------------------------------------- */

export type KnowledgeSearchHit = {
  chunkId: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  knowledgeItemId: string;
  title: string;
  snippet: string;
  sourceType: "FILE" | "TEXT" | "URL" | null;
  sourceUrl: string | null;
  score: number;
};

type SearchChunkRow = {
  id: string;
  content: string;
  title: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string | null;
  knowledgeItemId: string;
  sourceType: string | null;
  sourceUrl: string | null;
  rank?: number | null;
  dist?: number | null;
};

const SNIPPET_MAX_CHARS = 900;

function toSnippet(content: string, terms: string[]): string {
  const t = content.trim();
  if (!t) {
    return "";
  }
  if (t.length <= SNIPPET_MAX_CHARS) {
    return t;
  }
  if (terms.length > 0) {
    const low = t.toLowerCase();
    for (const term of terms) {
      const idx = low.indexOf(term.toLowerCase());
      if (idx >= 0) {
        const start = Math.max(0, idx - 120);
        const end = Math.min(t.length, start + SNIPPET_MAX_CHARS);
        const prefix = start > 0 ? "…" : "";
        const suffix = end < t.length ? "…" : "";
        return `${prefix}${t.slice(start, end)}${suffix}`;
      }
    }
  }
  return `${t.slice(0, SNIPPET_MAX_CHARS)}…`;
}

export async function searchKnowledgeForTool(
  tenantId: string,
  knowledgeBaseIds: string[],
  userQuery: string,
  topK: number = 5,
): Promise<KnowledgeSearchHit[]> {
  if (knowledgeBaseIds.length === 0) {
    return [];
  }
  const kSafe = Math.max(1, Math.min(10, Math.floor(topK || 5)));
  const terms = extractTerms(userQuery);
  const kbSql = kbInClause(knowledgeBaseIds);
  const qFts = terms.slice(0, 14).join(" ").slice(0, 400);

  const scored = new Map<string, { row: SearchChunkRow; score: number }>();
  const push = (row: SearchChunkRow, score: number) => {
    if (!row?.content?.trim()) {
      return;
    }
    const prev = scored.get(row.id);
    if (!prev || score > prev.score) {
      scored.set(row.id, { row, score });
    }
  };

  let ftsRows: SearchChunkRow[] = [];
  if (qFts.length >= 2) {
    try {
      ftsRows = await prisma.$queryRaw<SearchChunkRow[]>`
        SELECT c.id, c.content, ki.title AS title,
          ki."knowledgeBaseId" AS "knowledgeBaseId",
          kb.name AS "knowledgeBaseName",
          ki.id AS "knowledgeItemId",
          ki."sourceType"::text AS "sourceType",
          ki."sourceUrl" AS "sourceUrl",
          ts_rank_cd(c.content_tsv, plainto_tsquery('simple', ${qFts})) AS rank
        FROM "Chunk" c
        INNER JOIN "Document" d ON d.id = c."documentId"
        INNER JOIN "KnowledgeItem" ki ON ki.id = d."knowledgeItemId"
        INNER JOIN "KnowledgeBase" kb ON kb.id = ki."knowledgeBaseId"
        WHERE c."tenantId" = ${tenantId}
          AND ki."knowledgeBaseId" IN (${kbSql})
          AND c.content_tsv @@ plainto_tsquery('simple', ${qFts})
        ORDER BY rank DESC
        LIMIT 40
      `;
    } catch {
      ftsRows = [];
    }
  }
  for (const r of ftsRows) {
    push(r, 100 + (Number(r.rank) || 0) * 80);
  }

  if (scored.size < kSafe && terms.length > 0) {
    const parts = terms
      .map(sanitizeIlike)
      .filter(Boolean)
      .slice(0, 8)
      .map((t) => Prisma.sql`c.content ILIKE ${`%${t}%`}`);
    if (parts.length > 0) {
      const orc = Prisma.join(parts, " OR ");
      try {
        const ilikeRows = await prisma.$queryRaw<SearchChunkRow[]>`
          SELECT c.id, c.content, ki.title AS title,
            ki."knowledgeBaseId" AS "knowledgeBaseId",
            kb.name AS "knowledgeBaseName",
            ki.id AS "knowledgeItemId",
            ki."sourceType"::text AS "sourceType",
            ki."sourceUrl" AS "sourceUrl",
            0::float AS rank
          FROM "Chunk" c
          INNER JOIN "Document" d ON d.id = c."documentId"
          INNER JOIN "KnowledgeItem" ki ON ki.id = d."knowledgeItemId"
          INNER JOIN "KnowledgeBase" kb ON kb.id = ki."knowledgeBaseId"
          WHERE c."tenantId" = ${tenantId}
            AND ki."knowledgeBaseId" IN (${kbSql})
            AND (${orc})
          ORDER BY ki."updatedAt" DESC
          LIMIT 40
        `;
        for (const r of ilikeRows) {
          push(r, 45 + keywordHits(r.content, terms) * 5);
        }
      } catch {
        /* ignore */
      }
    }
  }

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
        const vectorRows = (await prisma.$queryRaw(Prisma.sql`
          SELECT c.id, c.content, ki.title AS title,
            ki."knowledgeBaseId" AS "knowledgeBaseId",
            kb.name AS "knowledgeBaseName",
            ki.id AS "knowledgeItemId",
            ki."sourceType"::text AS "sourceType",
            ki."sourceUrl" AS "sourceUrl",
            (c.embedding <=> ${Prisma.raw(`${lit}::vector`)}) AS dist
          FROM "Chunk" c
          INNER JOIN "Document" d ON d.id = c."documentId"
          INNER JOIN "KnowledgeItem" ki ON ki.id = d."knowledgeItemId"
          INNER JOIN "KnowledgeBase" kb ON kb.id = ki."knowledgeBaseId"
          WHERE c."tenantId" = ${tenantId}
            AND ki."knowledgeBaseId" IN (${kbSql})
            AND c.embedding IS NOT NULL
          ORDER BY dist ASC
          LIMIT 24
        `)) as SearchChunkRow[];
        for (const r of vectorRows) {
          const dist = Number(r.dist);
          const vPart = Number.isFinite(dist) ? 38 / (1 + dist * 12) : 12;
          push(r, 28 + vPart);
        }
      }
    } catch {
      /* ignore */
    }
  }

  const sorted = [...scored.values()].sort((a, b) => b.score - a.score).slice(0, kSafe);
  return sorted.map<KnowledgeSearchHit>(({ row, score }) => ({
    chunkId: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    knowledgeBaseName: row.knowledgeBaseName ?? "",
    knowledgeItemId: row.knowledgeItemId,
    title: row.title,
    snippet: toSnippet(row.content, terms),
    sourceType: normalizeSourceType(row.sourceType),
    sourceUrl: row.sourceUrl?.trim() || null,
    score: Number(score.toFixed(2)),
  }));
}
