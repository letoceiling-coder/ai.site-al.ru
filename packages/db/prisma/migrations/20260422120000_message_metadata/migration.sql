-- AlterTable: add optional metadata JSON to Message for RAG-audit (citations, chunkIds, kbIds, toolEvents)
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
