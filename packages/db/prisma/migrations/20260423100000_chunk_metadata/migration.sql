-- AlterTable: add optional metadata JSON to Chunk (breadcrumbs, heading, structural hints)
ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
