import {
  appendContentText,
  appendReasoningText,
  contentToText,
  shouldAppendReasoningDelta,
  upsertToolEventFromChunk,
} from "@aichat/shared/stream-message-reducer";
import type { GeneratedImage } from "@aichat/shared/chat-stream-contract";
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

/**
 * 找到某条 assistant 消息对应的用户消息 id。
 * 优先使用服务端返回的 assistant.parentMessageId；缺失时回退到可见时间线中最近的前一条
 * user 消息（遇到压缩组即停止，避免拿更早的错误提问）。「重新生成」先用它复用已有提问
 * 生成新回复，成功后再调用 /api/chat/regenerate 删除被替换的旧回复，失败时旧答案不丢。
 * 找不到时返回 null，由调用方提示刷新，而不是静默发起错误的重生成。
 */
export function findReplyTargetUserId(
  messages: readonly ChatMessage[],
  assistantId: number | string,
  declaredParentMessageId?: number | null,
): number | null {
  // 后端历史接口已经返回 assistant.parentMessageId（chat-types 尚未声明），
  // 优先用它精确定位提问；压缩历史后可见列表里可能没有对应的 user 消息。
  if (
    typeof declaredParentMessageId === "number" &&
    Number.isInteger(declaredParentMessageId) &&
    declaredParentMessageId > 0
  ) {
    return declaredParentMessageId;
  }

  const assistantIndex = messages.findIndex((message) => message.id === assistantId);
  if (assistantIndex < 0) {
    return null;
  }

  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "compressedGroup") {
      // 父提问可能被压缩进该组，继续向前找会拿到更早的错误提问。
      return null;
    }
    if (message.role === "user" && typeof message.id === "number") {
      return message.id;
    }
  }

  return null;
}

export function appendAssistantGeneratedImages(
  messages: ChatMessage[],
  targetId: number | string,
  images: GeneratedImage[],
) {
  if (!Array.isArray(images) || images.length === 0) {
    return messages;
  }

  return messages.map((message) => {
    if (message.id !== targetId) {
      return message;
    }
    const existing = message.generatedImages ?? [];
    return {
      ...message,
      generatedImages: [...existing, ...images],
      streamStatus: "streaming",
    };
  });
}
