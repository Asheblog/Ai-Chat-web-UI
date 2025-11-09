-- SQLite 不支持 ALTER COLUMN；直接以默认值添加新列，并在需要时补齐历史数据
ALTER TABLE "messages" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "messages" SET "updatedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP);

ALTER TABLE "messages" ADD COLUMN "streamStatus" TEXT NOT NULL DEFAULT 'done';
UPDATE "messages" SET "streamStatus" = COALESCE("streamStatus", 'done');

ALTER TABLE "messages" ADD COLUMN "streamCursor" INTEGER NOT NULL DEFAULT 0;
UPDATE "messages" SET "streamCursor" = COALESCE(LENGTH("content"), 0);

ALTER TABLE "messages" ADD COLUMN "streamReasoning" TEXT;
ALTER TABLE "messages" ADD COLUMN "streamError" TEXT;
