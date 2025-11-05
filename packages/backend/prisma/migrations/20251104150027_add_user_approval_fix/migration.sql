-- Ensure unique index for usage quotas exists（兼容历史库，避免删除 SQLite 自动索引）
CREATE UNIQUE INDEX IF NOT EXISTS "usage_quota_scope_identifier_key" ON "usage_quota"("scope", "identifier");
