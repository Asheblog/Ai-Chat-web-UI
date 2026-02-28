-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN "knowledgeBaseIdsJson" TEXT NOT NULL DEFAULT [];

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "variablesJson" TEXT NOT NULL DEFAULT [],
    "pinnedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "prompt_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "prompt_templates_userId_pinnedAt_idx" ON "prompt_templates"("userId", "pinnedAt");
CREATE INDEX "prompt_templates_userId_updatedAt_idx" ON "prompt_templates"("userId", "updatedAt");
