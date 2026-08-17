-- Promote the endpoint configuration to a stable connection group.  A
-- credential remains in `connections`, so historical credential IDs can be
-- remapped to their new group identity before the old table is replaced.
PRAGMA foreign_keys=OFF;

CREATE TABLE "connection_groups" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "ownerUserId" INTEGER,
  "displayName" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "vendor" TEXT,
  "baseUrl" TEXT NOT NULL,
  "enable" BOOLEAN NOT NULL DEFAULT true,
  "authType" TEXT NOT NULL DEFAULT 'bearer',
  "headersJson" TEXT NOT NULL DEFAULT '',
  "azureApiVersion" TEXT,
  "prefixId" TEXT,
  "tagsJson" TEXT NOT NULL DEFAULT '[]',
  "defaultCapabilitiesJson" TEXT NOT NULL DEFAULT '{}',
  "connectionType" TEXT NOT NULL DEFAULT 'external',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "connection_groups_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "connection_groups_ownerUserId_idx" ON "connection_groups"("ownerUserId");

-- The endpoint signature deliberately includes all configuration that affects
-- wire behavior.  System groups get deterministic -2/-3 suffixes for equal
-- display-name seeds; user-owned groups are scoped by owner and may share a
-- display name.
INSERT INTO "connection_groups" (
  "ownerUserId", "displayName", "provider", "vendor", "baseUrl", "enable",
  "authType", "headersJson", "azureApiVersion", "prefixId", "tagsJson",
  "defaultCapabilitiesJson", "connectionType", "createdAt", "updatedAt"
)
WITH distinct_endpoints AS (
  SELECT
    "ownerUserId", "provider", "vendor", "baseUrl", "authType", "headersJson",
    "azureApiVersion", "prefixId", "tagsJson", "defaultCapabilitiesJson",
    "connectionType",
    MIN("createdAt") AS "createdAt",
    MAX("updatedAt") AS "updatedAt",
    MAX(CASE WHEN "enable" THEN 1 ELSE 0 END) AS "enable",
    COALESCE(NULLIF(TRIM("prefixId"), ''), "provider") AS seed
  FROM "connections"
  GROUP BY "ownerUserId", "provider", "vendor", "baseUrl", "authType",
    "headersJson", "azureApiVersion", "prefixId", "tagsJson",
    "defaultCapabilitiesJson", "connectionType"
),
named_endpoints AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY CASE WHEN "ownerUserId" IS NULL THEN seed ELSE NULL END
      ORDER BY "baseUrl", COALESCE("vendor", ''), COALESCE("prefixId", '')
    ) AS system_name_rank
  FROM distinct_endpoints
)
SELECT
  "ownerUserId",
  CASE
    WHEN "ownerUserId" IS NULL AND system_name_rank > 1
      THEN seed || '-' || system_name_rank
    ELSE seed
  END,
  "provider", "vendor", "baseUrl", "enable", "authType", "headersJson",
  "azureApiVersion", "prefixId", "tagsJson", "defaultCapabilitiesJson",
  "connectionType", "createdAt", "updatedAt"
FROM named_endpoints;

CREATE TEMP TABLE "_connection_group_map" (
  "credential_id" INTEGER PRIMARY KEY,
  "group_id" INTEGER NOT NULL
);
INSERT INTO "_connection_group_map" ("credential_id", "group_id")
SELECT c."id", g."id"
FROM "connections" c
JOIN "connection_groups" g ON
  c."ownerUserId" IS g."ownerUserId"
  AND c."provider" = g."provider"
  AND c."vendor" IS g."vendor"
  AND c."baseUrl" = g."baseUrl"
  AND c."authType" = g."authType"
  AND c."headersJson" = g."headersJson"
  AND c."azureApiVersion" IS g."azureApiVersion"
  AND c."prefixId" IS g."prefixId"
  AND c."tagsJson" = g."tagsJson"
  AND c."defaultCapabilitiesJson" = g."defaultCapabilitiesJson"
  AND c."connectionType" = g."connectionType";

-- Preserve one catalog row per group/model.  Manual overrides win, then the
-- most recent fetch wins.  The window is evaluated before rebuilding.
CREATE TEMP TABLE "_model_catalog_winners" AS
SELECT *
FROM (
  SELECT mc.*, m."group_id",
    ROW_NUMBER() OVER (
      PARTITION BY m."group_id", mc."modelId"
      ORDER BY mc."manualOverride" DESC, mc."lastFetchedAt" DESC, mc."id" DESC
    ) AS row_rank
  FROM "model_catalog" mc
  JOIN "_connection_group_map" m ON m."credential_id" = mc."connectionId"
)
WHERE row_rank = 1;

CREATE TABLE "model_catalog_new" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "connection_group_id" INTEGER NOT NULL,
  "modelId" TEXT NOT NULL, "rawId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL, "connectionType" TEXT NOT NULL,
  "modelType" TEXT NOT NULL DEFAULT 'chat', "tagsJson" TEXT NOT NULL DEFAULT '[]',
  "metaJson" TEXT NOT NULL DEFAULT '{}', "capabilitiesJson" TEXT NOT NULL DEFAULT '{}',
  "manualOverride" BOOLEAN NOT NULL DEFAULT false,
  "lastFetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" DATETIME NOT NULL,
  CONSTRAINT "model_catalog_connection_group_id_fkey"
    FOREIGN KEY ("connection_group_id") REFERENCES "connection_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "model_catalog_new"
SELECT "id", "group_id", "modelId", "rawId", "name", "provider", "connectionType",
  "modelType", "tagsJson", "metaJson", "capabilitiesJson", "manualOverride",
  "lastFetchedAt", "expiresAt"
FROM "_model_catalog_winners";
DROP TABLE "model_catalog";
ALTER TABLE "model_catalog_new" RENAME TO "model_catalog";
CREATE UNIQUE INDEX "model_catalog_connection_group_id_modelId_key" ON "model_catalog"("connection_group_id", "modelId");
CREATE INDEX "model_catalog_connection_group_id_idx" ON "model_catalog"("connection_group_id");
CREATE INDEX "model_catalog_modelType_idx" ON "model_catalog"("modelType");

UPDATE "chat_sessions"
SET "connectionId" = (
  SELECT "group_id" FROM "_connection_group_map" WHERE "credential_id" = "chat_sessions"."connectionId"
)
WHERE "connectionId" IN (SELECT "credential_id" FROM "_connection_group_map");
UPDATE "users"
SET "preferredConnectionId" = (
  SELECT "group_id" FROM "_connection_group_map" WHERE "credential_id" = "users"."preferredConnectionId"
)
WHERE "preferredConnectionId" IN (SELECT "credential_id" FROM "_connection_group_map");
UPDATE "battle_runs"
SET "judgeConnectionId" = (
  SELECT "group_id" FROM "_connection_group_map" WHERE "credential_id" = "battle_runs"."judgeConnectionId"
)
WHERE "judgeConnectionId" IN (SELECT "credential_id" FROM "_connection_group_map");
UPDATE "battle_results"
SET "connectionId" = (
  SELECT "group_id" FROM "_connection_group_map" WHERE "credential_id" = "battle_results"."connectionId"
)
WHERE "connectionId" IN (SELECT "credential_id" FROM "_connection_group_map");

-- SQLite cannot retarget a foreign key in place.  Rebuild sessions after
-- remapping the stored value so the retained `connectionId` column now refers
-- to a stable group ID.
CREATE TABLE "chat_sessions_new" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" INTEGER,
  "anonymousKey" TEXT,
  "expiresAt" DATETIME,
  "connectionId" INTEGER,
  "modelRawId" TEXT,
  "title" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pinnedAt" DATETIME,
  "reasoningEnabled" BOOLEAN,
  "reasoningEffort" TEXT,
  "ollamaThink" BOOLEAN,
  "systemPrompt" TEXT,
  "knowledgeBaseIdsJson" TEXT NOT NULL DEFAULT '[]',
  CONSTRAINT "chat_sessions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chat_sessions_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "connection_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "chat_sessions_new" (
  "id", "userId", "anonymousKey", "expiresAt", "connectionId", "modelRawId",
  "title", "createdAt", "pinnedAt", "reasoningEnabled", "reasoningEffort",
  "ollamaThink", "systemPrompt", "knowledgeBaseIdsJson"
)
SELECT
  "id", "userId", "anonymousKey", "expiresAt", "connectionId", "modelRawId",
  "title", "createdAt", "pinnedAt", "reasoningEnabled", "reasoningEffort",
  "ollamaThink", "systemPrompt", "knowledgeBaseIdsJson"
FROM "chat_sessions";
DROP TABLE "chat_sessions";
ALTER TABLE "chat_sessions_new" RENAME TO "chat_sessions";
CREATE INDEX "chat_sessions_expiresAt_idx" ON "chat_sessions"("expiresAt");
CREATE INDEX "chat_sessions_anonymousKey_idx" ON "chat_sessions"("anonymousKey");
CREATE INDEX "chat_sessions_userId_pinnedAt_idx" ON "chat_sessions"("userId", "pinnedAt");
CREATE INDEX "chat_sessions_anonymousKey_pinnedAt_idx" ON "chat_sessions"("anonymousKey", "pinnedAt");

CREATE TABLE "connections_new" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "connection_group_id" INTEGER NOT NULL,
  "enable" BOOLEAN NOT NULL DEFAULT true,
  "secret_vault_id" INTEGER,
  "apiKeyLabel" TEXT,
  "modelIdsJson" TEXT NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "connections_connection_group_id_fkey"
    FOREIGN KEY ("connection_group_id") REFERENCES "connection_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "connections_new" (
  "id", "connection_group_id", "enable", "secret_vault_id", "apiKeyLabel",
  "modelIdsJson", "createdAt", "updatedAt"
)
SELECT c."id", m."group_id", c."enable", c."secret_vault_id", c."apiKeyLabel",
  c."modelIdsJson", c."createdAt", c."updatedAt"
FROM "connections" c
JOIN "_connection_group_map" m ON m."credential_id" = c."id";
DROP TABLE "connections";
ALTER TABLE "connections_new" RENAME TO "connections";
CREATE INDEX "connections_connection_group_id_idx" ON "connections"("connection_group_id");

DROP TABLE "_model_catalog_winners";
DROP TABLE "_connection_group_map";
PRAGMA foreign_keys=ON;
