-- CreateTable
CREATE TABLE "usage_quota" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "identifier" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "dailyLimit" INTEGER NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "lastResetAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    CONSTRAINT "usage_quota_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_chat_sessions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER,
    "anonymousKey" TEXT,
    "expiresAt" DATETIME,
    "connectionId" INTEGER,
    "modelRawId" TEXT,
    "title" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reasoningEnabled" BOOLEAN,
    "reasoningEffort" TEXT,
    "ollamaThink" BOOLEAN,
    CONSTRAINT "chat_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chat_sessions_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_chat_sessions" ("connectionId", "createdAt", "id", "modelRawId", "ollamaThink", "reasoningEffort", "reasoningEnabled", "title", "userId") SELECT "connectionId", "createdAt", "id", "modelRawId", "ollamaThink", "reasoningEffort", "reasoningEnabled", "title", "userId" FROM "chat_sessions";
DROP TABLE "chat_sessions";
ALTER TABLE "new_chat_sessions" RENAME TO "chat_sessions";
CREATE UNIQUE INDEX "chat_sessions_anonymousKey_key" ON "chat_sessions"("anonymousKey");
CREATE INDEX "chat_sessions_expiresAt_idx" ON "chat_sessions"("expiresAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "usage_quota_userId_idx" ON "usage_quota"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "usage_quota_scope_identifier_key" ON "usage_quota"("scope", "identifier");

