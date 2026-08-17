-- Remap SystemSetting soft-refs from legacy credential ids to ConnectionGroup ids.
-- Credential rows keep their historical ids; groups are linked via connection_group_id.
-- Skip values that already match a connection_groups.id (already remapped / new writes).

UPDATE "system_settings"
SET "value" = (
  SELECT CAST("connection_group_id" AS TEXT)
  FROM "connections"
  WHERE "connections"."id" = CAST("system_settings"."value" AS INTEGER)
)
WHERE "key" IN (
  'title_summary_connection_id',
  'image_transcription_connection_id',
  'rag_embedding_connection_id'
)
AND TRIM(COALESCE("value", '')) != ''
AND CAST("value" AS INTEGER) NOT IN (SELECT "id" FROM "connection_groups")
AND EXISTS (
  SELECT 1
  FROM "connections"
  WHERE "connections"."id" = CAST("system_settings"."value" AS INTEGER)
);

-- reasoning_compat_profiles_v1 embeds connectionId inside JSON keys.
-- Remap profile.connectionId and rebuild profile.key when the id is a legacy credential.
-- SQLite json1: rewrite via a temp table of remapped profiles is impractical for nested
-- key regeneration; runtime dual-read in ReasoningCompatibilityService handles this.
