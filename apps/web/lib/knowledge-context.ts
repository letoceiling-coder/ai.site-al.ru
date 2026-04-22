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

/* ----------------------------- RRF -----------------------------------
 * Reciprocal Rank Fusion: при наличии нескольких ранжированных списков
 * (FTS, vector, recency, ILIKE, static) объединяем их устойчивым способом:
 *
 *   score(key) = Σ_lists  weight_l / (k + rank_l(key))
 *
 * Плюсы vs «взвешенная сумма скорингов»:
 *  - не нужно нормализовать несопоставимые метрики (ts_rank vs cosine);
 *  - добавление/удаление сигнала не ломает всю калибровку;
 *  - хорошо работает на разреженных списках (когда нет вектора или FTS).
 *
 * k=60 — классический выбор по оригинальной статье (Cormack et al. 2009).
 * ------------------------------------------------------------------- */
const RRF_K = 60;

type RankedList<TRow> = {
  name: string;
  weight: number;
  rows: TRow[];
  /** Получить стабильный ключ строки для слияния. */
  keyOf: (row: TRow) => string;
};

type RrfMergeEntry<TRow> = {
  key: string;
  rrfScore: number;
  /** Лучшая (самая ранняя в наиболее приоритетном списке) версия строки. */
  row: TRow;
  /** Для отладки/аудита: какие источники сколько дали. */
  contributions: Array<{ name: string; rank: number; part: number }>;
};

function rrfMerge<TRow>(lists: RankedList<TRow>[]): RrfMergeEntry<TRow>[] {
  const map = new Map<string, RrfMergeEntry<TRow>>();
  for (const list of lists) {
    list.rows.forEach((row, index) => {
      const key = list.keyOf(row);
      if (!key) {
        return;
      }
      const rank = index + 1;
      const part = list.weight / (RRF_K + rank);
      const prev = map.get(key);
      if (prev) {
        prev.rrfScore += part;
        prev.contributions.push({ name: list.name, rank, part });
      } else {
        map.set(key, {
          key,
          row,
          rrfScore: part,
          contributions: [{ name: list.name, rank, part }],
        });
      }
    });
  }
  return Array.from(map.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

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
  if (terms.length > 0) {
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
          LIMIT 40
        `;
      } catch {
        ilikeRows = [];
      }
    }
  }

  // Свежесть (recency): отдельный сигнал, независимо от совпадения по тексту.
  // Даёт шанс только что добавленным материалам попасть в контекст, даже если
  // FTS пока не построил по ним статистику.
  let recencyRows: ChunkRow[] = [];
  try {
    recencyRows = await prisma.$queryRaw<ChunkRow[]>`
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
      LIMIT 30
    `;
  } catch {
    recencyRows = [];
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

  // Построение объединённого рейтинга через RRF. Веса подобраны эмпирически:
  // FTS и vector — главные сигналы релевантности; ILIKE — подстраховка для
  // частичных совпадений/кириллических стеммов; recency — бонус свежести.
  const chunkRowKey = (r: ChunkRow) => `chunk:${r.id}`;
  const merged = rrfMerge<ChunkRow>([
    { name: "fts", weight: 1.0, rows: ftsRows, keyOf: chunkRowKey },
    { name: "vector", weight: 1.0, rows: vectorRows, keyOf: chunkRowKey },
    { name: "ilike", weight: 0.6, rows: ilikeRows, keyOf: chunkRowKey },
    { name: "recency", weight: 0.4, rows: recencyRows, keyOf: chunkRowKey },
  ]);

  const scored = new Map<string, ContextPart>();
  for (const entry of merged) {
    const row = entry.row;
    const body = row.content?.trim();
    if (!body) {
      continue;
    }
    scored.set(entry.key, {
      key: entry.key,
      score: entry.rrfScore,
      body,
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

  let ilikeRows: SearchChunkRow[] = [];
  if (terms.length > 0) {
    const parts = terms
      .map(sanitizeIlike)
      .filter(Boolean)
      .slice(0, 8)
      .map((t) => Prisma.sql`c.content ILIKE ${`%${t}%`}`);
    if (parts.length > 0) {
      const orc = Prisma.join(parts, " OR ");
      try {
        ilikeRows = await prisma.$queryRaw<SearchChunkRow[]>`
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
      } catch {
        ilikeRows = [];
      }
    }
  }

  let vectorRows: SearchChunkRow[] = [];
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
          LIMIT 24
        `)) as SearchChunkRow[];
      }
    } catch {
      vectorRows = [];
    }
  }

  const searchKey = (r: SearchChunkRow) => (r?.content?.trim() ? r.id : "");
  const merged = rrfMerge<SearchChunkRow>([
    { name: "fts", weight: 1.0, rows: ftsRows, keyOf: searchKey },
    { name: "vector", weight: 1.0, rows: vectorRows, keyOf: searchKey },
    { name: "ilike", weight: 0.6, rows: ilikeRows, keyOf: searchKey },
  ]);

  const sorted = merged.slice(0, kSafe);
  return sorted.map<KnowledgeSearchHit>(({ row, rrfScore }) => ({
    chunkId: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    knowledgeBaseName: row.knowledgeBaseName ?? "",
    knowledgeItemId: row.knowledgeItemId,
    title: row.title,
    snippet: toSnippet(row.content, terms),
    sourceType: normalizeSourceType(row.sourceType),
    sourceUrl: row.sourceUrl?.trim() || null,
    // Нормализуем к диапазону 0..100 для удобства логов/UI. Чистый RRF-score
    // даёт ~0.02–0.05 максимум, умножим на 1000 и округлим.
    score: Number((rrfScore * 1000).toFixed(2)),
  }));
}
