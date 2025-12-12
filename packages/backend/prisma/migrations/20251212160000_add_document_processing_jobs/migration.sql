-- Add processing progress fields to documents
ALTER TABLE "documents" ADD COLUMN "processingStage" TEXT DEFAULT 'pending';
ALTER TABLE "documents" ADD COLUMN "processingProgress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "documents" ADD COLUMN "processingStartedAt" DATETIME;
ALTER TABLE "documents" ADD COLUMN "processingHeartbeatAt" DATETIME;
ALTER TABLE "documents" ADD COLUMN "processingFinishedAt" DATETIME;

-- CreateTable: document_processing_jobs - 文档处理任务表
CREATE TABLE "document_processing_jobs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "documentId" INTEGER NOT NULL UNIQUE,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "nextRunAt" DATETIME,
    "workerId" TEXT,
    "lockedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "document_processing_jobs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex: document_processing_jobs 表索引
CREATE INDEX "document_processing_jobs_status_idx" ON "document_processing_jobs"("status");
CREATE INDEX "document_processing_jobs_nextRunAt_idx" ON "document_processing_jobs"("nextRunAt");
