-- SQLite migration for adding reasoning columns
-- Safe to run multiple times: uses conditional checks via CREATE TEMP TABLE if needed (not available in raw DDL),
-- but since SQLite lacks IF NOT EXISTS for columns, rely on idempotent execution by catching errors at caller.

ALTER TABLE messages ADD COLUMN reasoning TEXT;
ALTER TABLE messages ADD COLUMN reasoningDurationSeconds INTEGER;

