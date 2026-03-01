import { Hono } from 'hono';
import { registerChatMessageRoutes } from '../modules/chat/routes/messages';
import { registerChatAttachmentRoutes } from '../modules/chat/routes/attachments';
import { registerChatStreamRoutes } from '../modules/chat/routes/stream';
import { registerChatCompletionRoutes } from '../modules/chat/routes/completion';
import { registerChatControlRoutes } from '../modules/chat/routes/control';
import { registerChatUsageRoutes } from '../modules/chat/routes/usage';
import { registerTitleSummaryRoutes } from '../modules/chat/routes/title-summary';
import { registerChatWorkspaceRoutes } from '../modules/chat/routes/workspace';
import { registerChatCompressionRoutes } from '../modules/chat/routes/compression';
export const createChatApi = () => {
  const chat = new Hono();

  registerChatMessageRoutes(chat);
  registerChatCompressionRoutes(chat);
  registerChatAttachmentRoutes(chat);
  registerChatStreamRoutes(chat);
  registerChatCompletionRoutes(chat);
  registerChatControlRoutes(chat);
  registerChatUsageRoutes(chat);
  registerTitleSummaryRoutes(chat);
  registerChatWorkspaceRoutes(chat);

  return chat;
};

export default createChatApi();
