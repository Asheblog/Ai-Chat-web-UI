-- SQLite migration to add session-level reasoning defaults
ALTER TABLE chat_sessions ADD COLUMN reasoningEnabled INTEGER;
ALTER TABLE chat_sessions ADD COLUMN reasoningEffort TEXT;
ALTER TABLE chat_sessions ADD COLUMN ollamaThink INTEGER;

