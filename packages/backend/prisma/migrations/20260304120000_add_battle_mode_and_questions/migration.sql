-- AlterTable
ALTER TABLE "battle_runs" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'multi_model';

-- AlterTable
ALTER TABLE "battle_results" ADD COLUMN "questionIndex" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "battle_results" ADD COLUMN "questionId" TEXT;
ALTER TABLE "battle_results" ADD COLUMN "questionTitle" TEXT;

-- CreateIndex
CREATE INDEX "battle_results_battleRunId_questionIndex_attemptIndex_idx" ON "battle_results"("battleRunId", "questionIndex", "attemptIndex");
