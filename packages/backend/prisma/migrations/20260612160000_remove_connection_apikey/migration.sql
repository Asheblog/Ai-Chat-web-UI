-- Drop the deprecated apiKey column from connections table.
-- SQLite requires table rebuild to drop a column.
-- Old apiKey data is discarded (no backward migration per ADR 0023).

PRAGMA foreign_keys=OFF;

CREATE TABLE "connections_new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ownerUserId" INTEGER,
    "provider" TEXT NOT NULL,
    "vendor" TEXT,
    "baseUrl" TEXT NOT NULL,
    "enable" BOOLEAN NOT NULL DEFAULT true,
    "authType" TEXT NOT NULL DEFAULT 'bearer',
    "headersJson" TEXT NOT NULL DEFAULT '',
    "azureApiVersion" TEXT,
    "prefixId" TEXT,
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "modelIdsJson" TEXT NOT NULL DEFAULT '[]',
    "defaultCapabilitiesJson" TEXT NOT NULL DEFAULT '{}',
    "connectionType" TEXT NOT NULL DEFAULT 'external',
    "secret_vault_id" INTEGER,
    "apiKeyLabel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "connections_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "connections_new" (
    "id", "ownerUserId", "provider", "vendor", "baseUrl", "enable", "authType",
    "headersJson", "azureApiVersion", "prefixId", "tagsJson", "modelIdsJson",
    "defaultCapabilitiesJson", "connectionType",
    "secret_vault_id", "apiKeyLabel",
    "createdAt", "updatedAt"
) SELECT
    "id", "ownerUserId", "provider", "vendor", "baseUrl", "enable", "authType",
    "headersJson", "azureApiVersion", "prefixId", "tagsJson", "modelIdsJson",
    "defaultCapabilitiesJson", "connectionType",
    "secret_vault_id", "apiKeyLabel",
    "createdAt", "updatedAt"
FROM "connections";

DROP TABLE "connections";

ALTER TABLE "connections_new" RENAME TO "connections";

PRAGMA foreign_keys=ON;
