import {
  appendContentText,
  appendReasoningText,
  contentToText,
  shouldAppendReasoningDelta,
  upsertToolEventFromChunk,
} from "@aichat/shared/stream-message-reducer";
import { mergeAndSortToolEvents } from "@aichat/shared/tool-events";

import type { ChatMessage, ChatStreamChunk } from "../chat-types";

export { contentToText };

export function normalizeMessage(message: ChatMessage): ChatMessage {
  const toolEvents =
    Array.isArray(message.toolEvents) && message.toolEvents.length > 0
      ? mergeAndSortToolEvents(message.toolEvents)
      : undefined;

  return {
    ...message,
    content: contentToText(message.content),
    createdAt: String(message.createdAt),
    toolEvents,
  };
}

export function appendAssistantContent(messages: ChatMessage[], targetId: number | string, delta: string) {
  return messages.map((message) =>
    message.id === targetId
      ? {
          ...message,
          content: appendContentText(message.content, delta),
          streamStatus: "streaming",
        }
      : message,
  );
}

export function appendAssistantReasoning(
  messages: ChatMessage[],
  targetId: number | string,
  delta: string,
  meta?: Record<string, unknown> | null,
) {
  if (!shouldAppendReasoningDelta(meta)) {
    return messages;
  }

  return messages.map((message) =>
    message.id === targetId
      ? {
          ...message,
          reasoning: appendReasoningText(message.reasoning, delta),
          streamStatus: "streaming",
        }
      : message,
  );
}

export function appendAssistantToolCall(
  messages: ChatMessage[],
  targetId: number | string,
  chunk: ChatStreamChunk,
  sessionId: number,
) {
  return messages.map((message) => {
    if (message.id !== targetId) {
      return message;
    }

    const toolEvents = upsertToolEventFromChunk(message.toolEvents ?? [], chunk, {
      sessionId,
      messageId: message.id,
      reasoningLength: (message.reasoning ?? "").length,
    });

    return {
      ...message,
      toolEvents: mergeAndSortToolEvents(toolEvents),
      streamStatus: "streaming",
    };
  });
}
