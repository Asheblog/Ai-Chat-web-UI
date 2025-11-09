ALTER TABLE "messages" ADD COLUMN "updatedAt" DATETIME;
UPDATE "messages" SET "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP);
ALTER TABLE "messages" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "messages" ALTER COLUMN "updatedAt" SET NOT NULL;

ALTER TABLE "messages" ADD COLUMN "streamStatus" TEXT;
UPDATE "messages" SET "streamStatus" = COALESCE("streamStatus", 'done');
ALTER TABLE "messages" ALTER COLUMN "streamStatus" SET NOT NULL;

ALTER TABLE "messages" ADD COLUMN "streamCursor" INTEGER;
UPDATE "messages" SET "streamCursor" = COALESCE("streamCursor", LENGTH("content"));
ALTER TABLE "messages" ALTER COLUMN "streamCursor" SET DEFAULT 0;
ALTER TABLE "messages" ALTER COLUMN "streamCursor" SET NOT NULL;

ALTER TABLE "messages" ADD COLUMN "streamReasoning" TEXT;
ALTER TABLE "messages" ADD COLUMN "streamError" TEXT;
