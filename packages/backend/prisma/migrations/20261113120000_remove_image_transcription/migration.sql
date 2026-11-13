ALTER TABLE "messages" DROP COLUMN "image_descriptions_json";

-- 用 GLOB 而非 LIKE：GLOB 的 "_" 是字面量且区分大小写，LIKE 的 "_" 是单字符通配、
-- 且不区分 ASCII 大小写，会连带删掉 image-transcription_enabled / IMAGE_TRANSCRIPTION_ENABLED。
DELETE FROM "system_settings" WHERE "key" GLOB 'image_transcription_*';
