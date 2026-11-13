ALTER TABLE "messages" DROP COLUMN "image_descriptions_json";

DELETE FROM "system_settings" WHERE "key" LIKE 'image_transcription_%';
