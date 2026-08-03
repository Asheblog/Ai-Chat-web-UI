-- 修复 20251201090000_chat_shares 遗留的 snake_case 列名问题：
-- 该迁移按 snake_case 建列，而 schema.prisma 中 ChatShare 模型字段为 camelCase
-- 且无 @map，导致所有环境查询报 P2022（列不存在），管理后台分享列表 500。
-- 本迁移将列重命名为 camelCase，与项目其余表的列命名约定保持一致。
-- SQLite 的 RENAME COLUMN 会自动同步表内 FK 约束与索引中的列引用。

ALTER TABLE "chat_shares" RENAME COLUMN "session_id" TO "sessionId";
ALTER TABLE "chat_shares" RENAME COLUMN "message_ids_json" TO "messageIdsJson";
ALTER TABLE "chat_shares" RENAME COLUMN "payload_json" TO "payloadJson";
ALTER TABLE "chat_shares" RENAME COLUMN "created_by_user_id" TO "createdByUserId";
ALTER TABLE "chat_shares" RENAME COLUMN "created_by_anonymous_key" TO "createdByAnonymousKey";
ALTER TABLE "chat_shares" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "chat_shares" RENAME COLUMN "expires_at" TO "expiresAt";
ALTER TABLE "chat_shares" RENAME COLUMN "revoked_at" TO "revokedAt";
