-- Add pinnedAt column for chat sessions and indexes to speed up pinned ordering
ALTER TABLE "chat_sessions" ADD COLUMN "pinnedAt" DATETIME;

-- Indexes for user-owned sessions
CREATE INDEX "chat_sessions_userId_pinnedAt_idx" ON "chat_sessions" ("userId", "pinnedAt");

-- Indexes for anonymous sessions
CREATE INDEX "chat_sessions_anonymousKey_pinnedAt_idx" ON "chat_sessions" ("anonymousKey", "pinnedAt");
