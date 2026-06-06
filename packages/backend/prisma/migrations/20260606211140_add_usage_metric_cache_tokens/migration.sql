-- AlterTable
ALTER TABLE "UsageMetric" ADD COLUMN "promptCacheHitTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageMetric" ADD COLUMN "promptCacheMissTokens" INTEGER NOT NULL DEFAULT 0;
