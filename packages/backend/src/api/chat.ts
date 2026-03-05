import { Hono } from 'hono';
import { registerChatMessageRoutes } from '../modules/chat/routes/messages';
import type { ChatMessageRoutesDeps } from '../modules/chat/routes/messages';
import { registerChatAttachmentRoutes } from '../modules/chat/routes/attachments';
import type { ChatAttachmentRoutesDeps } from '../modules/chat/routes/attachments';
import { registerChatStreamRoutes } from '../modules/chat/routes/stream';
import type { ChatStreamRoutesDeps } from '../modules/chat/routes/stream';
import { registerChatCompletionRoutes } from '../modules/chat/routes/completion';
import type { ChatCompletionRoutesDeps } from '../modules/chat/routes/completion';
import { registerChatControlRoutes } from '../modules/chat/routes/control';
import type { ChatControlRoutesDeps } from '../modules/chat/routes/control';
import { registerChatUsageRoutes } from '../modules/chat/routes/usage';
import type { ChatUsageRoutesDeps } from '../modules/chat/routes/usage';
import { registerTitleSummaryRoutes } from '../modules/chat/routes/title-summary';
import type { TitleSummaryRoutesDeps } from '../modules/chat/routes/title-summary';
import { registerChatWorkspaceRoutes } from '../modules/chat/routes/workspace';
import type { ChatWorkspaceRoutesDeps } from '../modules/chat/routes/workspace';
import { registerChatCompressionRoutes } from '../modules/chat/routes/compression';
import type { ChatCompressionRoutesDeps } from '../modules/chat/routes/compression';

export interface ChatApiDeps {
  messageRoutes: ChatMessageRoutesDeps
  compressionRoutes: ChatCompressionRoutesDeps
  attachmentRoutes: ChatAttachmentRoutesDeps
  streamRoutes: ChatStreamRoutesDeps
  completionRoutes: ChatCompletionRoutesDeps
  controlRoutes: ChatControlRoutesDeps
  usageRoutes: ChatUsageRoutesDeps
  titleSummaryRoutes: TitleSummaryRoutesDeps
  workspaceRoutes: ChatWorkspaceRoutesDeps
}

export const createChatApi = (deps: ChatApiDeps) => {
  const chat = new Hono();

  registerChatMessageRoutes(chat, deps.messageRoutes);
  registerChatCompressionRoutes(chat, deps.compressionRoutes);
  registerChatAttachmentRoutes(chat, deps.attachmentRoutes);
  registerChatStreamRoutes(chat, deps.streamRoutes);
  registerChatCompletionRoutes(chat, deps.completionRoutes);
  registerChatControlRoutes(chat, deps.controlRoutes);
  registerChatUsageRoutes(chat, deps.usageRoutes);
  registerTitleSummaryRoutes(chat, deps.titleSummaryRoutes);
  registerChatWorkspaceRoutes(chat, deps.workspaceRoutes);

  return chat;
};

export default createChatApi;
