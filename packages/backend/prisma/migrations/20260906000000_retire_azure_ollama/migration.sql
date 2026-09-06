-- Keep connection identities, credentials and historical conversations intact.
UPDATE "connection_groups" SET "enable" = false
WHERE "provider" IN ('azure_openai', 'ollama');

DELETE FROM "system_settings"
WHERE "key" IN ('ollama_think', 'image_transcription_ollama_think');

ALTER TABLE "connection_groups" DROP COLUMN "azureApiVersion";
ALTER TABLE "chat_sessions" DROP COLUMN "ollamaThink";
