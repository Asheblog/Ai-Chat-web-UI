-- AlterTable
ALTER TABLE "users" ADD COLUMN "avatar_path" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_latex_traces" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "task_trace_id" INTEGER NOT NULL,
    "matched_blocks" INTEGER NOT NULL DEFAULT 0,
    "unmatched_blocks" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "log_file_path" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "latex_traces_task_trace_id_fkey" FOREIGN KEY ("task_trace_id") REFERENCES "task_traces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_latex_traces" ("created_at", "id", "log_file_path", "matched_blocks", "metadata", "status", "task_trace_id", "unmatched_blocks", "updated_at") SELECT "created_at", "id", "log_file_path", "matched_blocks", "metadata", "status", "task_trace_id", "unmatched_blocks", "updated_at" FROM "latex_traces";
DROP TABLE "latex_traces";
ALTER TABLE "new_latex_traces" RENAME TO "latex_traces";
CREATE UNIQUE INDEX "latex_traces_task_trace_id_key" ON "latex_traces"("task_trace_id");
CREATE INDEX "latex_traces_status_idx" ON "latex_traces"("status");
CREATE TABLE "new_messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "parentMessageId" INTEGER,
    "variantIndex" INTEGER DEFAULT 1,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "clientMessageId" TEXT,
    "reasoning" TEXT,
    "reasoningDurationSeconds" INTEGER,
    "toolLogsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "streamStatus" TEXT NOT NULL DEFAULT 'done',
    "streamCursor" INTEGER NOT NULL DEFAULT 0,
    "streamReasoning" TEXT,
    "streamError" TEXT,
    CONSTRAINT "messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messages_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_messages" ("clientMessageId", "content", "createdAt", "id", "reasoning", "reasoningDurationSeconds", "role", "sessionId", "streamCursor", "streamError", "streamReasoning", "streamStatus", "toolLogsJson", "updatedAt") SELECT "clientMessageId", "content", "createdAt", "id", "reasoning", "reasoningDurationSeconds", "role", "sessionId", "streamCursor", "streamError", "streamReasoning", "streamStatus", "toolLogsJson", "updatedAt" FROM "messages";
DROP TABLE "messages";
ALTER TABLE "new_messages" RENAME TO "messages";
CREATE INDEX "messages_parentMessageId_idx" ON "messages"("parentMessageId");
CREATE UNIQUE INDEX "messages_sessionId_clientMessageId_key" ON "messages"("sessionId", "clientMessageId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
