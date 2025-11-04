-- Add default model preference fields to users table
ALTER TABLE "users"
  ADD COLUMN "preferredModelId" TEXT,
  ADD COLUMN "preferredConnectionId" INTEGER,
  ADD COLUMN "preferredModelRawId" TEXT;
