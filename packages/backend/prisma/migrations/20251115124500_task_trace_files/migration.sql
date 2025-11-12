ALTER TABLE "task_traces" ADD COLUMN "eventCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "task_traces" ADD COLUMN "logFilePath" TEXT;
