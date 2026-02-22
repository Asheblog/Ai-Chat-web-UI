-- Restore user profile columns dropped by 20251104145707_add_user_approval.
ALTER TABLE "users" ADD COLUMN "avatar_path" TEXT;
ALTER TABLE "users" ADD COLUMN "personalPrompt" TEXT;
