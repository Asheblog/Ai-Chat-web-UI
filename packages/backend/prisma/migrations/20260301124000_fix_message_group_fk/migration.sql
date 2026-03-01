-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "messageGroupId" INTEGER,
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
    "streamStatus" TEXT NOT NULL DEFAULT done,
    "streamCursor" INTEGER NOT NULL DEFAULT 0,
    "streamReasoning" TEXT,
    "streamError" TEXT,
    CONSTRAINT "messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messages_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "messages_messageGroupId_fkey" FOREIGN KEY ("messageGroupId") REFERENCES "message_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_messages" ("clientMessageId", "content", "createdAt", "id", "messageGroupId", "parentMessageId", "reasoning", "reasoningDurationSeconds", "role", "sessionId", "streamCursor", "streamError", "streamReasoning", "streamStatus", "toolLogsJson", "updatedAt", "variantIndex") SELECT "clientMessageId", "content", "createdAt", "id", "messageGroupId", "parentMessageId", "reasoning", "reasoningDurationSeconds", "role", "sessionId", "streamCursor", "streamError", "streamReasoning", "streamStatus", "toolLogsJson", "updatedAt", "variantIndex" FROM "messages";
DROP TABLE "messages";
ALTER TABLE "new_messages" RENAME TO "messages";
CREATE UNIQUE INDEX "messages_sessionId_clientMessageId_key" ON "messages"("sessionId", "clientMessageId");
CREATE INDEX "messages_sessionId_messageGroupId_idx" ON "messages"("sessionId", "messageGroupId");
CREATE INDEX "messages_messageGroupId_idx" ON "messages"("messageGroupId");
CREATE INDEX "messages_parentMessageId_idx" ON "messages"("parentMessageId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
