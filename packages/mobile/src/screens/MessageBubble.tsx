import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import type { ChatMessage } from "../chat-types";
import type { AppTheme } from "../theme";
import { spacing } from "../theme";
import { contentToText } from "./chat-message-utils";
import { MarkdownText } from "./MarkdownText";

type MessageBubbleProps = {
  message: ChatMessage;
  theme: AppTheme;
};

export function MessageBubble({ message, theme }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const content = contentToText(message.content);
  const hasReasoning = Boolean(message.reasoning?.trim());
  const isStreaming = message.streamStatus === "streaming";
  const isErrored = message.streamStatus === "error";
  const isCancelled = message.streamStatus === "cancelled";

  if (!isUser && !isAssistant) {
    return null;
  }

  return (
    <View style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowAssistant]}>
      <View
        style={[
          styles.messageBubble,
          {
            backgroundColor: isUser ? theme.primary : theme.surface,
            borderColor: isErrored ? theme.danger : theme.border,
          },
        ]}
      >
        {hasReasoning ? (
          <View style={[styles.reasoningBox, { backgroundColor: theme.inputBackground, borderColor: theme.border }]}>
            <Text style={[styles.reasoningLabel, { color: theme.mutedForeground }]}>思考</Text>
            <Text style={[styles.reasoningText, { color: theme.mutedForeground }]}>{message.reasoning}</Text>
          </View>
        ) : null}
        {content.length > 0 ? (
          <MarkdownText content={content} isUser={isUser} theme={theme} />
        ) : isStreaming ? (
          <View style={styles.streamingRow} accessibilityRole="progressbar">
            <ActivityIndicator color={isUser ? "#FFFFFF" : theme.primary} />
            <Text style={[styles.messageText, { color: isUser ? "#FFFFFF" : theme.mutedForeground }]}>
              正在生成
            </Text>
          </View>
        ) : null}
        {isErrored || isCancelled ? (
          <Text style={[styles.messageStatus, { color: isErrored ? theme.danger : theme.mutedForeground }]}>
            {message.streamError ?? (isErrored ? "生成失败" : "已停止生成")}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  messageRow: {
    flexDirection: "row",
  },
  messageRowUser: {
    justifyContent: "flex-end",
  },
  messageRowAssistant: {
    justifyContent: "flex-start",
  },
  messageBubble: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "88%",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    rowGap: spacing.sm,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 24,
  },
  reasoningBox: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    rowGap: 4,
  },
  reasoningLabel: {
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16,
  },
  reasoningText: {
    fontSize: 14,
    lineHeight: 21,
  },
  streamingRow: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
  },
  messageStatus: {
    fontSize: 13,
    lineHeight: 18,
  },
});
