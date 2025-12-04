-- Add personal prompt column for per-user chat instructions
ALTER TABLE "users" ADD COLUMN "personalPrompt" TEXT;
