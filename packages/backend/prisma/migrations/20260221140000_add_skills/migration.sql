-- CreateTable
CREATE TABLE "skills" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'builtin',
    "sourceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "defaultVersionId" INTEGER,
    "createdByUserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "skills_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "skills_defaultVersionId_fkey" FOREIGN KEY ("defaultVersionId") REFERENCES "skill_versions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "skill_versions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "skillId" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_validation',
    "riskLevel" TEXT NOT NULL DEFAULT 'low',
    "entry" TEXT NOT NULL,
    "instruction" TEXT,
    "manifestJson" TEXT NOT NULL DEFAULT '{}',
    "packageHash" TEXT,
    "packagePath" TEXT,
    "sourceRef" TEXT,
    "sourceSubdir" TEXT,
    "approvedAt" DATETIME,
    "activatedAt" DATETIME,
    "createdByUserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "skill_versions_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "skill_bindings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "skillId" INTEGER NOT NULL,
    "versionId" INTEGER,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "policyJson" TEXT NOT NULL DEFAULT '{}',
    "overridesJson" TEXT NOT NULL DEFAULT '{}',
    "createdByUserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "skill_bindings_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "skill_bindings_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "skill_versions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "skill_approval_requests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "skillId" INTEGER NOT NULL,
    "versionId" INTEGER,
    "bindingId" INTEGER,
    "sessionId" INTEGER,
    "battleRunId" INTEGER,
    "messageId" INTEGER,
    "toolName" TEXT NOT NULL,
    "toolCallId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "requestPayloadJson" TEXT NOT NULL DEFAULT '{}',
    "decisionNote" TEXT,
    "requestedByActor" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "decidedByUserId" INTEGER,
    "expiresAt" DATETIME,
    CONSTRAINT "skill_approval_requests_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "skill_approval_requests_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "skill_versions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "skill_approval_requests_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "skill_bindings" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "skill_approval_requests_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "skill_approval_requests_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "skill_approval_requests_battleRunId_fkey" FOREIGN KEY ("battleRunId") REFERENCES "battle_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "skill_execution_audits" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "skillId" INTEGER NOT NULL,
    "versionId" INTEGER,
    "approvalRequestId" INTEGER,
    "sessionId" INTEGER,
    "battleRunId" INTEGER,
    "messageId" INTEGER,
    "toolName" TEXT NOT NULL,
    "toolCallId" TEXT,
    "requestPayloadJson" TEXT NOT NULL DEFAULT '{}',
    "responsePayloadJson" TEXT NOT NULL DEFAULT '{}',
    "approvalStatus" TEXT,
    "platform" TEXT,
    "durationMs" INTEGER,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "skill_execution_audits_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "skill_execution_audits_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "skill_versions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "skill_execution_audits_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "skill_approval_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "skill_execution_audits_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "skill_execution_audits_battleRunId_fkey" FOREIGN KEY ("battleRunId") REFERENCES "battle_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "skills_slug_key" ON "skills"("slug");
CREATE UNIQUE INDEX "skills_defaultVersionId_key" ON "skills"("defaultVersionId");
CREATE INDEX "skills_status_idx" ON "skills"("status");
CREATE INDEX "skills_createdByUserId_idx" ON "skills"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "skill_versions_skillId_version_key" ON "skill_versions"("skillId", "version");
CREATE INDEX "skill_versions_skillId_status_idx" ON "skill_versions"("skillId", "status");
CREATE INDEX "skill_versions_createdByUserId_idx" ON "skill_versions"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "skill_bindings_skillId_scopeType_scopeId_key" ON "skill_bindings"("skillId", "scopeType", "scopeId");
CREATE INDEX "skill_bindings_scopeType_scopeId_idx" ON "skill_bindings"("scopeType", "scopeId");
CREATE INDEX "skill_bindings_versionId_idx" ON "skill_bindings"("versionId");

-- CreateIndex
CREATE INDEX "skill_approval_requests_status_expiresAt_idx" ON "skill_approval_requests"("status", "expiresAt");
CREATE INDEX "skill_approval_requests_sessionId_idx" ON "skill_approval_requests"("sessionId");
CREATE INDEX "skill_approval_requests_battleRunId_idx" ON "skill_approval_requests"("battleRunId");
CREATE INDEX "skill_approval_requests_messageId_idx" ON "skill_approval_requests"("messageId");
CREATE INDEX "skill_approval_requests_toolCallId_idx" ON "skill_approval_requests"("toolCallId");

-- CreateIndex
CREATE INDEX "skill_execution_audits_sessionId_createdAt_idx" ON "skill_execution_audits"("sessionId", "createdAt");
CREATE INDEX "skill_execution_audits_battleRunId_createdAt_idx" ON "skill_execution_audits"("battleRunId", "createdAt");
CREATE INDEX "skill_execution_audits_messageId_createdAt_idx" ON "skill_execution_audits"("messageId", "createdAt");
CREATE INDEX "skill_execution_audits_toolCallId_idx" ON "skill_execution_audits"("toolCallId");
