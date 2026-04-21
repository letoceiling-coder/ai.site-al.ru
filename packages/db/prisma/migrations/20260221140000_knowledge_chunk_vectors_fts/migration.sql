-- Расширение pgvector (на managed-БД может быть уже включено администратором).
CREATE EXTENSION IF NOT EXISTS vector;

-- Эмбеддинги для семантического поиска (косинусная близость в приложении).
ALTER TABLE "Chunk" ADD COLUMN "embedding" vector(1536);

-- Полнотекстовый индекс по содержимому чанка (simple — предсказуемо для RU/EN).
ALTER TABLE "Chunk" ADD COLUMN "content_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS "Chunk_content_tsv_idx" ON "Chunk" USING GIN ("content_tsv");

-- HNSW для быстрого приближённого поиска по косинусу (pgvector 0.5+).
CREATE INDEX IF NOT EXISTS "Chunk_embedding_hnsw_idx" ON "Chunk" USING hnsw ("embedding" vector_cosine_ops);
