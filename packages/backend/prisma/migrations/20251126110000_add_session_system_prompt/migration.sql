-- 为会话增加可选的系统提示词字段
ALTER TABLE "chat_sessions" ADD COLUMN "systemPrompt" TEXT;
