-- CreateTable
CREATE TABLE "battle_runs" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER,
  "anonymousKey" TEXT,
  "title" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "expectedAnswer" TEXT NOT NULL,
  "judgeModelId" TEXT NOT NULL,
  "judgeConnectionId" INTEGER,
  "judgeRawId" TEXT,
  "judgeThreshold" REAL NOT NULL DEFAULT 0.8,
  "runsPerModel" INTEGER NOT NULL DEFAULT 1,
  "passK" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "configJson" TEXT NOT NULL DEFAULT '{}',
  "summaryJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "battle_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "battle_results" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "battleRunId" INTEGER NOT NULL,
  "modelId" TEXT NOT NULL,
  "connectionId" INTEGER,
  "rawId" TEXT,
  "attemptIndex" INTEGER NOT NULL,
  "featuresJson" TEXT NOT NULL DEFAULT '{}',
  "customBodyJson" TEXT NOT NULL DEFAULT '{}',
  "customHeadersJson" TEXT NOT NULL DEFAULT '[]',
  "output" TEXT NOT NULL DEFAULT '',
  "usageJson" TEXT NOT NULL DEFAULT '{}',
  "durationMs" INTEGER,
  "error" TEXT,
  "judgePass" BOOLEAN,
  "judgeScore" REAL,
  "judgeReason" TEXT,
  "judgeFallbackUsed" BOOLEAN NOT NULL DEFAULT 0,
  "judgeRawJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "battle_results_battleRunId_fkey" FOREIGN KEY ("battleRunId") REFERENCES "battle_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "battle_shares" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "battleRunId" INTEGER NOT NULL,
  "token" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "createdByUserId" INTEGER,
  "createdByAnonymousKey" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME,
  "revokedAt" DATETIME,
  CONSTRAINT "battle_shares_battleRunId_fkey" FOREIGN KEY ("battleRunId") REFERENCES "battle_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "battle_shares_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "battle_runs_userId_idx" ON "battle_runs"("userId");

-- CreateIndex
CREATE INDEX "battle_runs_anonymousKey_idx" ON "battle_runs"("anonymousKey");

-- CreateIndex
CREATE INDEX "battle_runs_status_idx" ON "battle_runs"("status");

-- CreateIndex
CREATE INDEX "battle_runs_createdAt_idx" ON "battle_runs"("createdAt");

-- CreateIndex
CREATE INDEX "battle_results_battleRunId_idx" ON "battle_results"("battleRunId");

-- CreateIndex
CREATE INDEX "battle_results_modelId_idx" ON "battle_results"("modelId");

-- CreateIndex
CREATE INDEX "battle_results_connectionId_idx" ON "battle_results"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "battle_shares_token_key" ON "battle_shares"("token");

-- CreateIndex
CREATE INDEX "battle_shares_battleRunId_idx" ON "battle_shares"("battleRunId");

-- CreateIndex
CREATE INDEX "battle_shares_createdByUserId_idx" ON "battle_shares"("createdByUserId");

-- CreateIndex
CREATE INDEX "battle_shares_createdByAnonymousKey_idx" ON "battle_shares"("createdByAnonymousKey");
