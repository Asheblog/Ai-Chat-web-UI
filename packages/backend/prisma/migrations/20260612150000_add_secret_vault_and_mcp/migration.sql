-- Secret Vault
CREATE TABLE "secret_vault" (
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
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "secret_vault_scope_scopeId_idx" ON "secret_vault"("scope", "scopeId");
CREATE INDEX "secret_vault_kind_idx" ON "secret_vault"("kind");
CREATE INDEX "secret_vault_ref_type_ref_id_idx" ON "secret_vault"("ref_type", "ref_id");

-- MCP Installations
CREATE TABLE "mcp_installations" (
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
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "mcp_installations_namespace_key_key" ON "mcp_installations"("namespace_key");
CREATE INDEX "mcp_installations_source_type_idx" ON "mcp_installations"("source_type");
CREATE INDEX "mcp_installations_status_idx" ON "mcp_installations"("status");
CREATE INDEX "mcp_installations_registry_source_idx" ON "mcp_installations"("registry_source");

-- MCP Connections
CREATE TABLE "mcp_connections" (
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
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_connections_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "mcp_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "mcp_connections_installation_id_idx" ON "mcp_connections"("installation_id");
CREATE INDEX "mcp_connections_owner_user_id_idx" ON "mcp_connections"("owner_user_id");
CREATE INDEX "mcp_connections_status_idx" ON "mcp_connections"("status");

-- MCP Bindings
CREATE TABLE "mcp_bindings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "connection_id" INTEGER NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tool_set_revision" INTEGER NOT NULL DEFAULT 1,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_bindings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "mcp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mcp_bindings_connection_id_scope_type_scope_id_key" ON "mcp_bindings"("connection_id", "scope_type", "scope_id");
CREATE INDEX "mcp_bindings_scope_type_scope_id_idx" ON "mcp_bindings"("scope_type", "scope_id");

-- MCP Tool Cache
CREATE TABLE "mcp_tool_cache" (
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
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_tool_cache_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "mcp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mcp_tool_cache_connection_id_original_name_key" ON "mcp_tool_cache"("connection_id", "original_name");
CREATE INDEX "mcp_tool_cache_connection_id_tool_set_revision_idx" ON "mcp_tool_cache"("connection_id", "tool_set_revision");
CREATE INDEX "mcp_tool_cache_pinned_idx" ON "mcp_tool_cache"("pinned");

-- Add secret_vault_id column to connections
ALTER TABLE "connections" ADD COLUMN "secret_vault_id" INTEGER REFERENCES "secret_vault"("id") ON DELETE SET NULL;
