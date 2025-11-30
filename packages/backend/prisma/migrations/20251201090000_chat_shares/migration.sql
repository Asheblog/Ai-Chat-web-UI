-- CreateTable
CREATE TABLE "chat_shares" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "session_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message_ids_json" TEXT NOT NULL DEFAULT '[]',
    "payload_json" TEXT NOT NULL,
    "created_by_user_id" INTEGER,
    "created_by_anonymous_key" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME,
    "revoked_at" DATETIME,
    CONSTRAINT "chat_shares_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chat_shares_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_shares_token_key" ON "chat_shares"("token");

-- CreateIndex
CREATE INDEX "chat_shares_session_id_idx" ON "chat_shares"("session_id");

-- CreateIndex
CREATE INDEX "chat_shares_created_by_user_id_idx" ON "chat_shares"("created_by_user_id");
