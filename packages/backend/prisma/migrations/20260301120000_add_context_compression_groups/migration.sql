-- CreateTable
CREATE TABLE "message_groups" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT compression,
    "summary" TEXT NOT NULL,
    "compressedMessagesJson" TEXT NOT NULL DEFAULT '[]',
    "startMessageId" INTEGER,
    "endMessageId" INTEGER,
    "lastMessageId" INTEGER,
    "expanded" BOOLEAN NOT NULL DEFAULT false,
    "metadataJson" TEXT,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "message_groups_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "messageGroupId" INTEGER;

-- CreateIndex
CREATE INDEX "message_groups_sessionId_createdAt_idx" ON "message_groups"("sessionId", "createdAt");
CREATE INDEX "message_groups_sessionId_cancelledAt_createdAt_idx" ON "message_groups"("sessionId", "cancelledAt", "createdAt");
CREATE INDEX "message_groups_sessionId_expanded_idx" ON "message_groups"("sessionId", "expanded");
CREATE INDEX "messages_sessionId_messageGroupId_idx" ON "messages"("sessionId", "messageGroupId");
CREATE INDEX "messages_messageGroupId_idx" ON "messages"("messageGroupId");
