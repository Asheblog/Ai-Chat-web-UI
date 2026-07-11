import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { ChatMessage } from "../chat-types";
import type { MobileApiClient } from "../mobile-api-client";
import type { ChatSession } from "../session-types";
import type { AppTheme } from "../theme";
import { spacing } from "../theme";
import {
  appendAssistantContent,
  appendAssistantReasoning,
  normalizeMessage,
} from "./chat-message-utils";
import { MessageBubble } from "./MessageBubble";

type ChatScreenProps = {
  apiClient: MobileApiClient;
  onBack: () => void;
  session: ChatSession;
  theme: AppTheme;
};

type StreamState = {
  assistantId: number | string;
  clientMessageId: string;
  messageId: number | null;
};

export function ChatScreen({ apiClient, onBack, session, theme }: ChatScreenProps) {
  const title = getSessionTitle(session);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const inputRef = useRef<TextInput>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef<StreamState | null>(null);
  const stopRequestedRef = useRef(false);
  const streamStartedRef = useRef(false);
  const shouldFollowStreamRef = useRef(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadMessages = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    if (mode === "initial") {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setErrorMessage(null);

    try {
      const payload = await apiClient.getMessages(session.id, 100);
      setMessages((payload.messages ?? []).map(normalizeMessage).filter(Boolean));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载消息失败，请重试。");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [apiClient, session.id]);

  useEffect(() => {
    loadMessages("initial");

    return () => {
      abortRef.current?.abort();
    };
  }, [loadMessages]);

  const scrollToBottom = useCallback((animated = true) => {
    shouldFollowStreamRef.current = true;
    setShowScrollToBottom(false);
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const trimmedInput = input.trim();
  const canSend = trimmedInput.length > 0 && !isStreaming;

  const markActiveAssistant = useCallback((status: string, streamError?: string) => {
    const targetId = streamRef.current?.assistantId;
    if (targetId == null) {
      return;
    }
    setMessages((current) =>
      current.map((message) =>
        message.id === targetId
          ? {
              ...message,
              streamStatus: status,
              streamError,
            }
          : message,
      ),
    );
  }, []);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || isStreaming) {
      return;
    }

    const clientMessageId = createClientMessageId();
    const now = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: `local-user-${clientMessageId}`,
      sessionId: session.id,
      role: "user",
      content,
      clientMessageId,
      createdAt: now,
    };
    const assistantId = `local-assistant-${clientMessageId}`;
    const assistantMessage: ChatMessage = {
      id: assistantId,
      sessionId: session.id,
      role: "assistant",
      content: "",
      clientMessageId: null,
      streamStatus: "streaming",
      createdAt: now,
    };

    const controller = new AbortController();
    abortRef.current = controller;
    streamRef.current = { assistantId, clientMessageId, messageId: null };
    stopRequestedRef.current = false;
    streamStartedRef.current = false;
    shouldFollowStreamRef.current = true;
    setInput("");
    setErrorMessage(null);
    setIsStreaming(true);
    setMessages((current) => [...current, userMessage, assistantMessage]);

    try {
      for await (const chunk of apiClient.streamMessage({
        body: {
          sessionId: session.id,
          content,
          clientMessageId,
          contextEnabled: true,
          reasoningEnabled: true,
        },
        signal: controller.signal,
      })) {
        if (chunk.type === "start") {
          streamStartedRef.current = true;
          const previousAssistantId: number | string = streamRef.current?.assistantId ?? assistantId;
          const nextAssistantId: number | string = chunk.assistantMessageId ?? previousAssistantId;
          streamRef.current = {
            assistantId: nextAssistantId,
            clientMessageId,
            messageId: chunk.assistantMessageId ?? null,
          };
          setMessages((current) =>
            current.map((message) => {
              if (message.id === previousAssistantId || message.id === assistantId) {
                return {
                  ...message,
                  id: nextAssistantId,
                  clientMessageId: chunk.assistantClientMessageId ?? message.clientMessageId,
                  streamStatus: "streaming",
                };
              }
              if (message.id === userMessage.id && typeof chunk.messageId === "number") {
                return { ...message, id: chunk.messageId };
              }
              return message;
            }),
          );
          continue;
        }

        if (chunk.type === "content") {
          const targetId = streamRef.current?.assistantId ?? assistantId;
          setMessages((current) => appendAssistantContent(current, targetId, chunk.content));
          continue;
        }

        if (chunk.type === "reasoning" && chunk.content) {
          const reasoningContent = chunk.content;
          const targetId = streamRef.current?.assistantId ?? assistantId;
          setMessages((current) => appendAssistantReasoning(current, targetId, reasoningContent));
          continue;
        }

        if (chunk.type === "complete") {
          const targetId = streamRef.current?.assistantId ?? assistantId;
          setMessages((current) =>
            current.map((message) =>
              message.id === targetId
                ? {
                    ...message,
                    content: chunk.content ?? message.content,
                    streamStatus: "done",
                  }
                : message,
            ),
          );
          continue;
        }

        if (chunk.type === "error") {
          throw new Error(chunk.suggestion ? `${chunk.error} ${chunk.suggestion}` : chunk.error);
        }
      }

      const targetId = streamRef.current?.assistantId ?? assistantId;
      setMessages((current) =>
        current.map((message) =>
          message.id === targetId && message.streamStatus === "streaming"
            ? { ...message, streamStatus: "done" }
            : message,
        ),
      );

      try {
        await loadMessages("refresh");
      } catch {
        // loadMessages owns the visible refresh error; the completed stream should stay completed.
      }
    } catch (error) {
      if (stopRequestedRef.current || isAbortError(error)) {
        markActiveAssistant("cancelled", "已停止生成。");
        return;
      }

      const message = error instanceof Error ? error.message : "发送失败，请重试。";
      setErrorMessage(message);
      if (!streamStartedRef.current) {
        setInput(content);
        setMessages((current) =>
          current.filter((item) => item.id !== userMessage.id && item.id !== assistantId),
        );
      } else {
        markActiveAssistant("error", `${message} 下拉刷新可同步服务端状态。`);
      }
    } finally {
      abortRef.current = null;
      streamRef.current = null;
      stopRequestedRef.current = false;
      streamStartedRef.current = false;
      setIsStreaming(false);
    }
  }, [apiClient, input, isStreaming, loadMessages, markActiveAssistant, session.id]);

  const handleStop = useCallback(async () => {
    const active = streamRef.current;
    if (!active || !isStreaming) {
      return;
    }

    stopRequestedRef.current = true;
    abortRef.current?.abort();
    markActiveAssistant("cancelled", "已停止生成。");
    setIsStreaming(false);

    try {
      await apiClient.cancelStream(session.id, active.clientMessageId, active.messageId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "停止生成失败，请稍后刷新会话。");
    }
  }, [apiClient, isStreaming, markActiveAssistant, session.id]);

  const empty = useMemo(() => messages.length === 0, [messages.length]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      style={styles.container}
    >
      <View style={[styles.topBar, { borderBottomColor: theme.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回会话列表"
          hitSlop={8}
          onPress={onBack}
          style={({ pressed }) => [
            styles.iconButton,
            { backgroundColor: pressed ? theme.primarySurface : "transparent" },
          ]}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={theme.primary} />
        </Pressable>
        <View style={styles.topBarTitleGroup}>
          <Text numberOfLines={1} style={[styles.topBarTitle, { color: theme.foreground }]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[styles.topBarMeta, { color: theme.mutedForeground }]}>
            {session.modelLabel ?? session.modelRawId ?? "未显示模型"}
          </Text>
        </View>
      </View>

      {errorMessage ? (
        <InlineError message={errorMessage} onRetry={() => loadMessages("refresh")} theme={theme} />
      ) : null}

      <FlatList
        ref={listRef}
        contentContainerStyle={[styles.messageList, empty && styles.messageListEmpty]}
        data={messages}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={
          isLoading ? (
            <LoadingState theme={theme} />
          ) : (
            <EmptyState onFocusComposer={() => inputRef.current?.focus()} theme={theme} />
          )
        }
        onContentSizeChange={() => {
          if (shouldFollowStreamRef.current) {
            scrollToBottom(false);
          }
        }}
        onScroll={({ nativeEvent }) => {
          const distanceFromBottom =
            nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y;
          const isNearBottom = distanceFromBottom < 96;
          shouldFollowStreamRef.current = isNearBottom;
          setShowScrollToBottom(!isNearBottom);
        }}
        refreshControl={
          <RefreshControl
            colors={[theme.primary]}
            onRefresh={() => loadMessages("refresh")}
            refreshing={isRefreshing}
            tintColor={theme.primary}
          />
        }
        renderItem={({ item }) => <MessageBubble message={item} theme={theme} />}
        scrollEventThrottle={80}
      />

      {showScrollToBottom ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="回到最新消息"
          onPress={() => scrollToBottom()}
          style={({ pressed }) => [
            styles.scrollToBottomButton,
            {
              backgroundColor: pressed ? theme.primaryPressed : theme.primary,
              borderColor: theme.background,
            },
          ]}
        >
          <MaterialCommunityIcons name="arrow-down" size={20} color="#FFFFFF" />
          <Text style={styles.scrollToBottomText}>最新消息</Text>
        </Pressable>
      ) : null}

      <View
        style={[styles.composer, { borderTopColor: theme.border, backgroundColor: theme.background }]}
      >
        <TextInput
          ref={inputRef}
          accessibilityLabel="输入消息"
          editable={!isStreaming}
          multiline
          onChangeText={setInput}
          placeholder={isStreaming ? "助手正在回复" : "输入一条消息"}
          placeholderTextColor={theme.mutedForeground}
          style={[
            styles.input,
            {
              backgroundColor: theme.inputBackground,
              borderColor: theme.border,
              color: theme.foreground,
            },
          ]}
          textAlignVertical="top"
          value={input}
        />
        {isStreaming ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="停止生成"
            onPress={handleStop}
            style={({ pressed }) => [
              styles.sendButton,
              { backgroundColor: pressed ? theme.dangerSurface : theme.danger },
            ]}
          >
            <MaterialCommunityIcons name="stop" size={22} color="#FFFFFF" />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送消息"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={handleSend}
            style={({ pressed }) => [
              styles.sendButton,
              {
                backgroundColor: !canSend ? theme.border : pressed ? theme.primaryPressed : theme.primary,
                opacity: !canSend ? 0.65 : 1,
              },
            ]}
          >
            <MaterialCommunityIcons name="send" size={21} color="#FFFFFF" />
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function InlineError({
  message,
  onRetry,
  theme,
}: {
  message: string;
  onRetry: () => void;
  theme: AppTheme;
}) {
  return (
    <View
      accessibilityRole="alert"
      style={[styles.inlineError, { backgroundColor: theme.dangerSurface, borderColor: theme.danger }]}
    >
      <MaterialCommunityIcons name="alert-circle-outline" size={22} color={theme.danger} />
      <Text style={[styles.inlineErrorText, { color: theme.danger }]}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="刷新消息"
        onPress={onRetry}
        style={({ pressed }) => [
          styles.retryButton,
          { backgroundColor: pressed ? theme.primaryPressed : theme.primary },
        ]}
      >
        <MaterialCommunityIcons name="reload" size={18} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

function LoadingState({ theme }: { theme: AppTheme }) {
  return (
    <View style={styles.stateBox} accessibilityRole="progressbar">
      <ActivityIndicator color={theme.primary} />
      <Text style={[styles.stateTitle, { color: theme.foreground }]}>正在加载消息</Text>
      <Text style={[styles.stateBody, { color: theme.mutedForeground }]}>会读取该会话最近的历史消息。</Text>
    </View>
  );
}

function EmptyState({ onFocusComposer, theme }: { onFocusComposer: () => void; theme: AppTheme }) {
  return (
    <View style={styles.stateBox}>
      <MaterialCommunityIcons name="message-plus-outline" size={34} color={theme.primary} />
      <Text style={[styles.stateTitle, { color: theme.foreground }]}>开始这段对话</Text>
      <Text style={[styles.stateBody, { color: theme.mutedForeground }]}>发送文本后，助手回复会实时显示在这里。</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="前往输入框"
        onPress={onFocusComposer}
        style={({ pressed }) => [
          styles.emptyButton,
          { backgroundColor: pressed ? theme.primaryPressed : theme.primary },
        ]}
      >
        <MaterialCommunityIcons name="keyboard-outline" size={20} color="#FFFFFF" />
        <Text style={styles.emptyButtonText}>输入消息</Text>
      </Pressable>
    </View>
  );
}

function getSessionTitle(session: ChatSession) {
  const title = session.title?.trim();
  return title || `会话 ${session.id}`;
}

function createClientMessageId() {
  return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: 64,
    paddingHorizontal: spacing.lg,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  topBarTitleGroup: {
    flex: 1,
    rowGap: 2,
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
  },
  topBarMeta: {
    fontSize: 14,
    lineHeight: 20,
  },
  inlineError: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  inlineErrorText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  retryButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  messageList: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    rowGap: spacing.md,
  },
  messageListEmpty: {
    flexGrow: 1,
    justifyContent: "center",
  },
  stateBox: {
    alignItems: "center",
    padding: spacing.xl,
    rowGap: spacing.md,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
    textAlign: "center",
  },
  stateBody: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
  },
  scrollToBottomButton: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: 22,
    borderWidth: 2,
    bottom: 84,
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    position: "absolute",
  },
  scrollToBottomText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  emptyButton: {
    alignItems: "center",
    borderRadius: 8,
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  emptyButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  composer: {
    alignItems: "flex-end",
    borderTopWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  input: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 132,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  sendButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
});
