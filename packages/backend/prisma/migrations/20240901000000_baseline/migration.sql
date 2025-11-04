-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "hashedPassword" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "preferredModelId" TEXT,
    "preferredConnectionId" INTEGER,
    "preferredModelRawId" TEXT
);

-- CreateTable
CREATE TABLE "chat_sessions" (
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

-- CreateTable
CREATE TABLE "messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "clientMessageId" TEXT,
    "reasoning" TEXT,
    "reasoningDurationSeconds" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "messageId" INTEGER NOT NULL,
    "relativePath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "usage_metrics" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "messageId" INTEGER,
    "model" TEXT NOT NULL,
    "provider" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "contextLimit" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_metrics_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "usage_metrics_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "usage_quota" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "identifier" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "dailyLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "lastResetAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    CONSTRAINT "usage_quota_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "connections" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ownerUserId" INTEGER,
    "provider" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "enable" BOOLEAN NOT NULL DEFAULT true,
    "authType" TEXT NOT NULL DEFAULT 'bearer',
    "apiKey" TEXT NOT NULL DEFAULT '',
    "headersJson" TEXT NOT NULL DEFAULT '',
    "azureApiVersion" TEXT,
    "prefixId" TEXT,
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "modelIdsJson" TEXT NOT NULL DEFAULT '[]',
    "connectionType" TEXT NOT NULL DEFAULT 'external',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "connections_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "model_catalog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "connectionId" INTEGER NOT NULL,
    "modelId" TEXT NOT NULL,
    "rawId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "connectionType" TEXT NOT NULL,
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "lastFetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "model_catalog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "chat_sessions_expiresAt_idx" ON "chat_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "chat_sessions_anonymousKey_idx" ON "chat_sessions"("anonymousKey");

-- CreateIndex
CREATE UNIQUE INDEX "messages_sessionId_clientMessageId_key" ON "messages"("sessionId", "clientMessageId");

-- CreateIndex
CREATE INDEX "message_attachments_messageId_idx" ON "message_attachments"("messageId");

-- CreateIndex
CREATE INDEX "usage_metrics_sessionId_idx" ON "usage_metrics"("sessionId");

-- CreateIndex
CREATE INDEX "usage_metrics_messageId_idx" ON "usage_metrics"("messageId");

-- CreateIndex
CREATE INDEX "usage_quota_userId_idx" ON "usage_quota"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "usage_quota_scope_identifier_key" ON "usage_quota"("scope", "identifier");

-- CreateIndex
CREATE INDEX "model_catalog_connectionId_idx" ON "model_catalog"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "model_catalog_connectionId_modelId_key" ON "model_catalog"("connectionId", "modelId");

