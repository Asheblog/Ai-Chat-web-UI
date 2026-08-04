-- AlterTable
ALTER TABLE "messages" ADD COLUMN "image_descriptions_json" TEXT;

-- CreateTable
CREATE TABLE "execution_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "mode" TEXT,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "inputJson" TEXT NOT NULL DEFAULT '{}',
    "outputJson" TEXT NOT NULL DEFAULT '{}',
    "metricsJson" TEXT NOT NULL DEFAULT '{}',
    "errorJson" TEXT NOT NULL DEFAULT '{}',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "execution_steps" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" INTEGER NOT NULL,
    "stepKey" TEXT NOT NULL,
    "agentRole" TEXT,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dependenciesJson" TEXT NOT NULL DEFAULT '[]',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "resultJson" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "execution_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "execution_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "execution_artifacts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" INTEGER NOT NULL,
    "stepId" INTEGER,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "dataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "execution_artifacts_runId_fkey" FOREIGN KEY ("runId") REFERENCES "execution_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "execution_artifacts_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "execution_steps" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "execution_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" INTEGER NOT NULL,
    "stepId" INTEGER,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ts" DATETIME NOT NULL,
    "agentRole" TEXT,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "execution_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "execution_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "execution_events_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "execution_steps" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_connections" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ownerUserId" INTEGER,
    "provider" TEXT NOT NULL,
    "vendor" TEXT,
    "baseUrl" TEXT NOT NULL,
    "enable" BOOLEAN NOT NULL DEFAULT true,
    "authType" TEXT NOT NULL DEFAULT 'bearer',
    "secret_vault_id" INTEGER,
    "apiKeyLabel" TEXT,
    "headersJson" TEXT NOT NULL DEFAULT '',
    "azureApiVersion" TEXT,
    "prefixId" TEXT,
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "modelIdsJson" TEXT NOT NULL DEFAULT '[]',
    "defaultCapabilitiesJson" TEXT NOT NULL DEFAULT '{}',
    "connectionType" TEXT NOT NULL DEFAULT 'external',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "connections_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_connections" ("apiKeyLabel", "authType", "azureApiVersion", "baseUrl", "connectionType", "createdAt", "defaultCapabilitiesJson", "enable", "headersJson", "id", "modelIdsJson", "ownerUserId", "prefixId", "provider", "secret_vault_id", "tagsJson", "updatedAt", "vendor") SELECT "apiKeyLabel", "authType", "azureApiVersion", "baseUrl", "connectionType", "createdAt", "defaultCapabilitiesJson", "enable", "headersJson", "id", "modelIdsJson", "ownerUserId", "prefixId", "provider", "secret_vault_id", "tagsJson", "updatedAt", "vendor" FROM "connections";
DROP TABLE "connections";
ALTER TABLE "new_connections" RENAME TO "connections";
CREATE TABLE "new_document_chunks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "documentId" INTEGER NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "pageNumber" INTEGER,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "vectorId" TEXT,
    "sectionId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "document_chunks_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "document_sections" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_document_chunks" ("chunkIndex", "content", "createdAt", "documentId", "id", "metadata", "pageEnd", "pageNumber", "pageStart", "sectionId", "tokenCount", "vectorId") SELECT "chunkIndex", "content", "createdAt", "documentId", "id", "metadata", "pageEnd", "pageNumber", "pageStart", "sectionId", "tokenCount", "vectorId" FROM "document_chunks";
DROP TABLE "document_chunks";
ALTER TABLE "new_document_chunks" RENAME TO "document_chunks";
CREATE INDEX "document_chunks_documentId_idx" ON "document_chunks"("documentId");
CREATE INDEX "document_chunks_documentId_pageNumber_idx" ON "document_chunks"("documentId", "pageNumber");
CREATE INDEX "document_chunks_documentId_pageStart_idx" ON "document_chunks"("documentId", "pageStart");
CREATE INDEX "document_chunks_documentId_pageEnd_idx" ON "document_chunks"("documentId", "pageEnd");
CREATE INDEX "document_chunks_sectionId_idx" ON "document_chunks"("sectionId");
CREATE UNIQUE INDEX "document_chunks_documentId_chunkIndex_key" ON "document_chunks"("documentId", "chunkIndex");
CREATE TABLE "new_mcp_bindings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "connection_id" INTEGER NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tool_set_revision" INTEGER NOT NULL DEFAULT 1,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mcp_bindings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "mcp_connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_mcp_bindings" ("connection_id", "created_at", "created_by", "enabled", "id", "scope_id", "scope_type", "tool_set_revision", "updated_at") SELECT "connection_id", "created_at", "created_by", "enabled", "id", "scope_id", "scope_type", "tool_set_revision", "updated_at" FROM "mcp_bindings";
DROP TABLE "mcp_bindings";
ALTER TABLE "new_mcp_bindings" RENAME TO "mcp_bindings";
CREATE INDEX "mcp_bindings_scope_type_scope_id_idx" ON "mcp_bindings"("scope_type", "scope_id");
CREATE UNIQUE INDEX "mcp_bindings_connection_id_scope_type_scope_id_key" ON "mcp_bindings"("connection_id", "scope_type", "scope_id");
CREATE TABLE "new_mcp_connections" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "installation_id" INTEGER NOT NULL,
    "owner_user_id" INTEGER,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config_json" TEXT NOT NULL DEFAULT '{}',
    "secret_vault_id" INTEGER,
    "tool_set_revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_health_check_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mcp_connections_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "mcp_installations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_mcp_connections" ("config_json", "created_at", "enabled", "id", "installation_id", "last_health_check_at", "name", "owner_user_id", "secret_vault_id", "status", "tool_set_revision", "updated_at") SELECT "config_json", "created_at", "enabled", "id", "installation_id", "last_health_check_at", "name", "owner_user_id", "secret_vault_id", "status", "tool_set_revision", "updated_at" FROM "mcp_connections";
DROP TABLE "mcp_connections";
ALTER TABLE "new_mcp_connections" RENAME TO "mcp_connections";
CREATE INDEX "mcp_connections_installation_id_idx" ON "mcp_connections"("installation_id");
CREATE INDEX "mcp_connections_owner_user_id_idx" ON "mcp_connections"("owner_user_id");
CREATE INDEX "mcp_connections_status_idx" ON "mcp_connections"("status");
CREATE TABLE "new_mcp_installations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "namespace_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'remote',
    "source_url" TEXT,
    "source_key" TEXT,
    "registry_source" TEXT,
    "transport" TEXT NOT NULL DEFAULT 'streamable_http',
    "endpoint" TEXT,
    "command" TEXT,
    "args_json" TEXT NOT NULL DEFAULT '[]',
    "env_json" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_mcp_installations" ("args_json", "command", "created_at", "created_by", "description", "endpoint", "env_json", "id", "name", "namespace_key", "registry_source", "source_key", "source_type", "source_url", "status", "transport", "updated_at") SELECT "args_json", "command", "created_at", "created_by", "description", "endpoint", "env_json", "id", "name", "namespace_key", "registry_source", "source_key", "source_type", "source_url", "status", "transport", "updated_at" FROM "mcp_installations";
DROP TABLE "mcp_installations";
ALTER TABLE "new_mcp_installations" RENAME TO "mcp_installations";
CREATE UNIQUE INDEX "mcp_installations_namespace_key_key" ON "mcp_installations"("namespace_key");
CREATE INDEX "mcp_installations_source_type_idx" ON "mcp_installations"("source_type");
CREATE INDEX "mcp_installations_status_idx" ON "mcp_installations"("status");
CREATE INDEX "mcp_installations_registry_source_idx" ON "mcp_installations"("registry_source");
CREATE TABLE "new_mcp_tool_cache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "connection_id" INTEGER NOT NULL,
    "original_name" TEXT NOT NULL,
    "description" TEXT,
    "input_schema_json" TEXT NOT NULL DEFAULT '{}',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "pinned_by" INTEGER,
    "pinned_at" DATETIME,
    "tool_set_revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mcp_tool_cache_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "mcp_connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_mcp_tool_cache" ("connection_id", "created_at", "description", "id", "input_schema_json", "original_name", "pinned", "pinned_at", "pinned_by", "tool_set_revision", "updated_at") SELECT "connection_id", "created_at", "description", "id", "input_schema_json", "original_name", "pinned", "pinned_at", "pinned_by", "tool_set_revision", "updated_at" FROM "mcp_tool_cache";
DROP TABLE "mcp_tool_cache";
ALTER TABLE "new_mcp_tool_cache" RENAME TO "mcp_tool_cache";
CREATE INDEX "mcp_tool_cache_connection_id_tool_set_revision_idx" ON "mcp_tool_cache"("connection_id", "tool_set_revision");
CREATE INDEX "mcp_tool_cache_pinned_idx" ON "mcp_tool_cache"("pinned");
CREATE UNIQUE INDEX "mcp_tool_cache_connection_id_original_name_key" ON "mcp_tool_cache"("connection_id", "original_name");
CREATE TABLE "new_secret_vault" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "ref_id" TEXT,
    "ref_type" TEXT,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_secret_vault" ("created_at", "created_by", "encrypted_value", "id", "kind", "label", "ref_id", "ref_type", "scope", "scopeId", "updated_at") SELECT "created_at", "created_by", "encrypted_value", "id", "kind", "label", "ref_id", "ref_type", "scope", "scopeId", "updated_at" FROM "secret_vault";
DROP TABLE "secret_vault";
ALTER TABLE "new_secret_vault" RENAME TO "secret_vault";
CREATE INDEX "secret_vault_scope_scopeId_idx" ON "secret_vault"("scope", "scopeId");
CREATE INDEX "secret_vault_kind_idx" ON "secret_vault"("kind");
CREATE INDEX "secret_vault_ref_type_ref_id_idx" ON "secret_vault"("ref_type", "ref_id");
CREATE TABLE "new_skill_approval_requests" (
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
    CONSTRAINT "skill_approval_requests_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_skill_approval_requests" ("battleRunId", "bindingId", "decidedAt", "decidedByUserId", "decisionNote", "expiresAt", "id", "messageId", "reason", "requestPayloadJson", "requestedAt", "requestedByActor", "sessionId", "skillId", "status", "toolCallId", "toolName", "versionId") SELECT "battleRunId", "bindingId", "decidedAt", "decidedByUserId", "decisionNote", "expiresAt", "id", "messageId", "reason", "requestPayloadJson", "requestedAt", "requestedByActor", "sessionId", "skillId", "status", "toolCallId", "toolName", "versionId" FROM "skill_approval_requests";
DROP TABLE "skill_approval_requests";
ALTER TABLE "new_skill_approval_requests" RENAME TO "skill_approval_requests";
CREATE INDEX "skill_approval_requests_status_expiresAt_idx" ON "skill_approval_requests"("status", "expiresAt");
CREATE INDEX "skill_approval_requests_sessionId_idx" ON "skill_approval_requests"("sessionId");
CREATE INDEX "skill_approval_requests_battleRunId_idx" ON "skill_approval_requests"("battleRunId");
CREATE INDEX "skill_approval_requests_messageId_idx" ON "skill_approval_requests"("messageId");
CREATE INDEX "skill_approval_requests_toolCallId_idx" ON "skill_approval_requests"("toolCallId");
CREATE TABLE "new_skill_execution_audits" (
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
    CONSTRAINT "skill_execution_audits_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "skill_approval_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_skill_execution_audits" ("approvalRequestId", "approvalStatus", "battleRunId", "createdAt", "durationMs", "error", "id", "messageId", "platform", "requestPayloadJson", "responsePayloadJson", "sessionId", "skillId", "toolCallId", "toolName", "versionId") SELECT "approvalRequestId", "approvalStatus", "battleRunId", "createdAt", "durationMs", "error", "id", "messageId", "platform", "requestPayloadJson", "responsePayloadJson", "sessionId", "skillId", "toolCallId", "toolName", "versionId" FROM "skill_execution_audits";
DROP TABLE "skill_execution_audits";
ALTER TABLE "new_skill_execution_audits" RENAME TO "skill_execution_audits";
CREATE INDEX "skill_execution_audits_sessionId_createdAt_idx" ON "skill_execution_audits"("sessionId", "createdAt");
CREATE INDEX "skill_execution_audits_battleRunId_createdAt_idx" ON "skill_execution_audits"("battleRunId", "createdAt");
CREATE INDEX "skill_execution_audits_messageId_createdAt_idx" ON "skill_execution_audits"("messageId", "createdAt");
CREATE INDEX "skill_execution_audits_toolCallId_idx" ON "skill_execution_audits"("toolCallId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "execution_runs_runKey_key" ON "execution_runs"("runKey");

-- CreateIndex
CREATE INDEX "execution_runs_sourceType_sourceId_idx" ON "execution_runs"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "execution_runs_status_createdAt_idx" ON "execution_runs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "execution_steps_runId_status_idx" ON "execution_steps"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "execution_steps_runId_stepKey_key" ON "execution_steps"("runId", "stepKey");

-- CreateIndex
CREATE INDEX "execution_artifacts_runId_stepId_idx" ON "execution_artifacts"("runId", "stepId");

-- CreateIndex
CREATE INDEX "execution_artifacts_kind_idx" ON "execution_artifacts"("kind");

-- CreateIndex
CREATE INDEX "execution_events_runId_ts_idx" ON "execution_events"("runId", "ts");

-- CreateIndex
CREATE INDEX "execution_events_type_status_idx" ON "execution_events"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "execution_events_runId_eventId_key" ON "execution_events"("runId", "eventId");

-- RedefineIndex
DROP INDEX "chat_shares_created_by_user_id_idx";
CREATE INDEX "chat_shares_createdByUserId_idx" ON "chat_shares"("createdByUserId");

-- RedefineIndex
DROP INDEX "chat_shares_session_id_idx";
CREATE INDEX "chat_shares_sessionId_idx" ON "chat_shares"("sessionId");

-- RedefineTable: 将 document_processing_jobs 内联 UNIQUE（sqlite_autoindex）重建为命名唯一索引。
-- SQLite 不允许直接 DROP autoindex，故采用 Prisma RedefineTables 模式整表重建（数据保留）。
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_document_processing_jobs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "documentId" INTEGER NOT NULL,
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
INSERT INTO "new_document_processing_jobs" ("attempts", "createdAt", "documentId", "id", "lastError", "lockedAt", "maxAttempts", "nextRunAt", "status", "updatedAt", "workerId") SELECT "attempts", "createdAt", "documentId", "id", "lastError", "lockedAt", "maxAttempts", "nextRunAt", "status", "updatedAt", "workerId" FROM "document_processing_jobs";
DROP TABLE "document_processing_jobs";
ALTER TABLE "new_document_processing_jobs" RENAME TO "document_processing_jobs";
CREATE INDEX "document_processing_jobs_status_idx" ON "document_processing_jobs"("status");
CREATE INDEX "document_processing_jobs_nextRunAt_idx" ON "document_processing_jobs"("nextRunAt");
CREATE UNIQUE INDEX "document_processing_jobs_documentId_key" ON "document_processing_jobs"("documentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
