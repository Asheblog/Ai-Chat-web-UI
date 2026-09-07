-- AlterTable
ALTER TABLE "connection_groups" ADD COLUMN "thinking_dialect" TEXT NOT NULL DEFAULT 'off';

-- Migrate legacy vendor thinking dialects
UPDATE "connection_groups" SET "thinking_dialect" = 'deepseek_compat'
WHERE "vendor" IN ('deepseek', 'openai_interleave');

-- Retire vendor values (column retained, always null going forward)
UPDATE "connection_groups" SET "vendor" = NULL
WHERE "vendor" IN ('deepseek', 'openai_interleave');
