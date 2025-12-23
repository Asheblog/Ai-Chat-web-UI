ALTER TABLE "battle_results" ADD COLUMN "judgeStatus" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "battle_results" ADD COLUMN "judgeError" TEXT;

CREATE INDEX "battle_results_judgeStatus_idx" ON "battle_results"("judgeStatus");
