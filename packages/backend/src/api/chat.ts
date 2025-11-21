import { Hono } from 'hono';
import { registerChatMessageRoutes } from '../modules/chat/routes/messages';
import { registerChatAttachmentRoutes } from '../modules/chat/routes/attachments';
import { registerChatStreamRoutes } from '../modules/chat/routes/stream';
import { registerChatCompletionRoutes } from '../modules/chat/routes/completion';
import { registerChatControlRoutes } from '../modules/chat/routes/control';
import { registerChatUsageRoutes } from '../modules/chat/routes/usage';
import { logTraffic as defaultLogTraffic } from '../utils/traffic-logger';

export interface ChatApiDeps {
  logTraffic?: typeof defaultLogTraffic
}

export const createChatApi = (deps: ChatApiDeps = {}) => {
  const chat = new Hono();
  const logTraffic = deps.logTraffic ?? defaultLogTraffic

  registerChatMessageRoutes(chat);
  registerChatAttachmentRoutes(chat);
  registerChatStreamRoutes(chat, { logTraffic });
  registerChatCompletionRoutes(chat, { logTraffic });
  registerChatControlRoutes(chat);
  registerChatUsageRoutes(chat);

  return chat;
};

export default createChatApi();
