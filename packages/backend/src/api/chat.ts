import { Hono } from 'hono';
import { registerChatMessageRoutes } from '../modules/chat/routes/messages';
import { registerChatAttachmentRoutes } from '../modules/chat/routes/attachments';
import { registerChatStreamRoutes } from '../modules/chat/routes/stream';
import { registerChatCompletionRoutes } from '../modules/chat/routes/completion';
import { registerChatControlRoutes } from '../modules/chat/routes/control';
import { registerChatUsageRoutes } from '../modules/chat/routes/usage';
export const createChatApi = () => {
  const chat = new Hono();

  registerChatMessageRoutes(chat);
  registerChatAttachmentRoutes(chat);
  registerChatStreamRoutes(chat);
  registerChatCompletionRoutes(chat);
  registerChatControlRoutes(chat);
  registerChatUsageRoutes(chat);

  return chat;
};

export default createChatApi();
