ALTER TABLE "battle_runs" ADD COLUMN "promptImagesJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "battle_runs" ADD COLUMN "expectedAnswerImagesJson" TEXT NOT NULL DEFAULT '[]';
