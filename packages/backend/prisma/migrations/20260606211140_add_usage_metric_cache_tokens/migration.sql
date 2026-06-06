-- AlterTable
ALTER TABLE "usage_metrics" ADD COLUMN "promptCacheHitTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "usage_metrics" ADD COLUMN "promptCacheMissTokens" INTEGER NOT NULL DEFAULT 0;
