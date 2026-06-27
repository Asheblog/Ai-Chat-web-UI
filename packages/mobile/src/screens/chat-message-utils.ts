import type { ChatMessage } from "../chat-types";

export function normalizeMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    content: contentToText(message.content),
    createdAt: String(message.createdAt),
  };
}

export function appendAssistantContent(messages: ChatMessage[], targetId: number | string, delta: string) {
  return messages.map((message) =>
    message.id === targetId
      ? {
          ...message,
          content: `${contentToText(message.content)}${delta}`,
          streamStatus: "streaming",
        }
      : message,
  );
}

export function appendAssistantReasoning(messages: ChatMessage[], targetId: number | string, delta: string) {
  return messages.map((message) =>
    message.id === targetId
      ? {
          ...message,
          reasoning: `${message.reasoning ?? ""}${delta}`,
          streamStatus: "streaming",
        }
      : message,
  );
}

export function contentToText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }
  if (content && typeof content === "object") {
    const maybeText = (content as { text?: unknown; content?: unknown }).text ?? (content as { content?: unknown }).content;
    if (typeof maybeText === "string") {
      return maybeText;
    }
  }
  return "";
}
