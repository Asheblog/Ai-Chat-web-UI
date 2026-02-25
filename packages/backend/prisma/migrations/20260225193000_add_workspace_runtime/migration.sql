-- CreateTable
CREATE TABLE "workspace_sessions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "rootPath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sandboxProvider" TEXT NOT NULL DEFAULT 'docker',
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "workspace_sessions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "workspace_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workspaceSessionId" INTEGER NOT NULL,
    "messageId" INTEGER,
    "toolCallId" TEXT,
    "toolName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "exitCode" INTEGER,
    "stdoutPreview" TEXT,
    "stderrPreview" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "workspace_runs_workspaceSessionId_fkey" FOREIGN KEY ("workspaceSessionId") REFERENCES "workspace_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workspace_runs_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "workspace_artifacts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workspaceSessionId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "messageId" INTEGER,
    "relativePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "workspace_artifacts_workspaceSessionId_fkey" FOREIGN KEY ("workspaceSessionId") REFERENCES "workspace_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workspace_artifacts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workspace_artifacts_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_sessions_sessionId_key" ON "workspace_sessions"("sessionId");
CREATE INDEX "workspace_sessions_status_idx" ON "workspace_sessions"("status");
CREATE INDEX "workspace_sessions_lastUsedAt_idx" ON "workspace_sessions"("lastUsedAt");

-- CreateIndex
CREATE INDEX "workspace_runs_workspaceSessionId_createdAt_idx" ON "workspace_runs"("workspaceSessionId", "createdAt");
CREATE INDEX "workspace_runs_messageId_createdAt_idx" ON "workspace_runs"("messageId", "createdAt");

-- CreateIndex
CREATE INDEX "workspace_artifacts_sessionId_messageId_createdAt_idx" ON "workspace_artifacts"("sessionId", "messageId", "createdAt");
CREATE INDEX "workspace_artifacts_expiresAt_deletedAt_idx" ON "workspace_artifacts"("expiresAt", "deletedAt");
CREATE INDEX "workspace_artifacts_workspaceSessionId_createdAt_idx" ON "workspace_artifacts"("workspaceSessionId", "createdAt");
