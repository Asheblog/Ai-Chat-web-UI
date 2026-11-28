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
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ChatMessage } from "../chat-types";
import { ChatComposer } from "../components/chat/ChatComposer";
import { ImagePreviewModal } from "../components/chat/ImagePreviewModal";
import { SessionExtensionsSheet } from "../components/sheets/SessionExtensionsSheet";
import type { MobileApiClient } from "../mobile-api-client";
import { lightTap, successTap, warningTap } from "../native/haptics";
import { pickDocumentFile, pickImagesFromLibrary, takePhotoWithCamera } from "../native/media";
import { useIncomingSharedText } from "../native/share-intent";
import { useVoiceInput } from "../native/voice-input";
import type { ChatSession, ModelItem } from "../session-types";
import type { AppTheme } from "../theme/tokens";
import { radii, spacing } from "../theme/tokens";
import type {
  KnowledgeBaseItem,
  McpSessionTool,
  MobilePreferences,
  PendingImageAttachment,
  ReasoningEffort,
  SessionDocumentItem,
  SkillOptionItem,
} from "../types/mobile";
import {
  appendAssistantContent,
  appendAssistantGeneratedImages,
  appendAssistantReasoning,
  appendAssistantToolCall,
  normalizeMessage,
} from "./chat-message-utils";
import { MessageBubble } from "./MessageBubble";

type ChatScreenProps = {
  apiClient: MobileApiClient;
  session: ChatSession;
  models: ModelItem[];
  preferences: MobilePreferences;
  theme: AppTheme;
  showDrawerTrigger: boolean;
  onOpenDrawer: () => void;
  onNewChat: () => void;
  onOpenModelPicker: () => void;
  onSessionUpdated: (session: ChatSession) => void;
};

type StreamState = {
  assistantId: number | string;
  clientMessageId: string;
  messageId: number | null;
};

export function ChatScreen({
  apiClient,
  session,
  models,
  preferences,
  theme,
  showDrawerTrigger,
  onOpenDrawer,
  onNewChat,
  onOpenModelPicker,
  onSessionUpdated,
}: ChatScreenProps) {
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ChatMessage>>(null);
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
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  const [reasoningEnabled, setReasoningEnabled] = useState(
    session.reasoningEnabled ?? preferences.defaultReasoningEnabled,
  );
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    session.reasoningEffort ?? preferences.defaultReasoningEffort,
  );
  const [webSearchEnabled, setWebSearchEnabled] = useState(
    preferences.defaultWebSearchEnabled,
  );

  const [pendingImages, setPendingImages] = useState<PendingImageAttachment[]>([]);
  const [sessionDocuments, setSessionDocuments] = useState<SessionDocumentItem[]>([]);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [replyToMessage, setReplyToMessage] = useState<ChatMessage | null>(null);
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);

  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseItem[]>([]);
  const [selectedKbIds, setSelectedKbIds] = useState<number[]>(
    Array.isArray(session.knowledgeBaseIds) ? session.knowledgeBaseIds : [],
  );
  const [skills, setSkills] = useState<SkillOptionItem[]>([]);
  const [enabledSkillIds, setEnabledSkillIds] = useState<number[]>([]);
  const [mcpTools, setMcpTools] = useState<McpSessionTool[]>([]);

  useEffect(() => {
    setReasoningEnabled(session.reasoningEnabled ?? preferences.defaultReasoningEnabled);
    setReasoningEffort(session.reasoningEffort ?? preferences.defaultReasoningEffort);
    setSelectedKbIds(Array.isArray(session.knowledgeBaseIds) ? session.knowledgeBaseIds : []);
    setPendingImages([]);
    setReplyToMessage(null);
    setErrorMessage(null);
    setNoticeMessage(null);
  }, [
    preferences.defaultReasoningEffort,
    preferences.defaultReasoningEnabled,
    session.id,
    session.knowledgeBaseIds,
    session.reasoningEffort,
    session.reasoningEnabled,
  ]);

  const loadMessages = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
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
    },
    [apiClient, session.id],
  );

  const loadExtensions = useCallback(async () => {
    const [docsRes, kbRes, skillRes, mcpRes] = await Promise.allSettled([
      apiClient.getSessionDocuments(session.id),
      apiClient.getKnowledgeBases(),
      apiClient.getSessionSkillOptions(session.id),
      apiClient.getSessionMcpTools(session.id),
    ]);
    if (docsRes.status === "fulfilled") {
      setSessionDocuments(docsRes.value);
    }
    if (kbRes.status === "fulfilled") {
      setKnowledgeBases(kbRes.value);
    }
    if (skillRes.status === "fulfilled") {
      setSkills(skillRes.value);
      setEnabledSkillIds(
        skillRes.value
          .filter((item) => item.sessionBinding?.enabled)
          .map((item) => item.id),
      );
    }
    if (mcpRes.status === "fulfilled") {
      setMcpTools(mcpRes.value);
    }
  }, [apiClient, session.id]);

  useEffect(() => {
    void loadMessages("initial");
    void loadExtensions();

    return () => {
      abortRef.current?.abort();
    };
  }, [loadExtensions, loadMessages]);

  useIncomingSharedText(
    useCallback((sharedText: string) => {
      setInput((prev) => (prev.trim() ? `${prev}\n${sharedText}` : sharedText));
      setNoticeMessage("已导入来自系统的分享文本。");
    }, []),
  );

  const voice = useVoiceInput({
    locale: preferences.voiceLocale,
    onTranscript: (text) => {
      setInput((prev) => (prev.trim() ? `${prev} ${text}` : text));
    },
    onUnavailable: (hint) => setNoticeMessage(hint),
    onError: (msg) => setErrorMessage(msg),
  });

  const scrollToBottom = useCallback((animated = true) => {
    shouldFollowStreamRef.current = true;
    setShowScrollToBottom(false);
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const markActiveAssistant = useCallback((status: string, streamError?: string) => {
    const targetId = streamRef.current?.assistantId;
    if (targetId == null) return;
    setMessages((current) =>
      current.map((message) =>
        message.id === targetId
          ? { ...message, streamStatus: status, streamError }
          : message,
      ),
    );
  }, []);

  const executeStream = useCallback(
    async ({
      content,
      images,
      replyToId,
      restoreDraftOnError,
    }: {
      content: string;
      images: PendingImageAttachment[];
      replyToId?: number;
      restoreDraftOnError: boolean;
    }) => {
      const clientMessageId = createClientMessageId();
      const now = new Date().toISOString();
      const userMessage: ChatMessage = {
        id: `local-user-${clientMessageId}`,
        sessionId: session.id,
        role: "user",
        content,
        clientMessageId,
        images: images.map((img) => `data:${img.mime};base64,${img.data}`),
        replyToMessageId: replyToId ?? null,
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

      if (restoreDraftOnError) {
        setInput("");
        setPendingImages([]);
        setReplyToMessage(null);
      }
      setErrorMessage(null);
      setNoticeMessage(null);
      setIsStreaming(true);
      setMessages((current) => [...current, userMessage, assistantMessage]);

      const enabledSkillItems = skills
        .filter((s) => enabledSkillIds.includes(s.id) && s.defaultVersion?.id)
        .map((s) => ({
          skillId: s.id,
          versionId: s.defaultVersion!.id,
        }));

      try {
        for await (const chunk of apiClient.streamMessage({
          body: {
            sessionId: session.id,
            content: content || undefined,
            clientMessageId,
            replyToMessageId: replyToId,
            images:
              images.length > 0
                ? images.map((img) => ({ data: img.data, mime: img.mime }))
                : undefined,
            reasoningEnabled,
            reasoningEffort,
            skills:
              webSearchEnabled || enabledSkillItems.length > 0
                ? {
                    builtin: webSearchEnabled ? ["web-search"] : undefined,
                    enabled: enabledSkillItems.length > 0 ? enabledSkillItems : undefined,
                  }
                : undefined,
            knowledgeBaseIds: selectedKbIds.length > 0 ? selectedKbIds : undefined,
          },
          signal: controller.signal,
        })) {
          if (chunk.type === "start") {
            streamStartedRef.current = true;
            const prevId: number | string = streamRef.current?.assistantId ?? assistantId;
            const nextId: number | string = chunk.assistantMessageId ?? prevId;
            streamRef.current = {
              assistantId: nextId,
              clientMessageId,
              messageId: chunk.assistantMessageId ?? null,
            };
            setMessages((current) =>
              current.map((message) => {
                if (message.id === prevId || message.id === assistantId) {
                  return {
                    ...message,
                    id: nextId,
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

          if (chunk.type === "content" && chunk.content) {
            const targetId = streamRef.current?.assistantId ?? assistantId;
            setMessages((current) => appendAssistantContent(current, targetId, chunk.content!));
            continue;
          }

          if (chunk.type === "reasoning" && chunk.content) {
            const targetId = streamRef.current?.assistantId ?? assistantId;
            setMessages((current) =>
              appendAssistantReasoning(current, targetId, chunk.content!, chunk.meta),
            );
            continue;
          }

          if (chunk.type === "tool_call") {
            const targetId = streamRef.current?.assistantId ?? assistantId;
            setMessages((current) => appendAssistantToolCall(current, targetId, chunk, session.id));
            continue;
          }

          if (chunk.type === "image" && chunk.generatedImages) {
            const targetId = streamRef.current?.assistantId ?? assistantId;
            setMessages((current) =>
              appendAssistantGeneratedImages(current, targetId, chunk.generatedImages!),
            );
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
        await successTap();
        try {
          await loadMessages("refresh");
        } catch {}
      } catch (error) {
        if (stopRequestedRef.current || isAbortError(error)) {
          markActiveAssistant("cancelled", "已停止生成。");
          return;
        }

        await warningTap();
        const message = error instanceof Error ? error.message : "发送失败，请重试。";
        setErrorMessage(message);

        if (!streamStartedRef.current) {
          setMessages((current) =>
            current.filter((item) => item.id !== userMessage.id && item.id !== assistantId),
          );
          if (restoreDraftOnError) {
            setInput((current) => (current.trim().length === 0 ? content : current));
            if (images.length > 0) {
              setPendingImages(images);
            }
          }
          return;
        }

        markActiveAssistant("error", `${message} 下拉刷新可同步服务端已保存内容。`);
      } finally {
        abortRef.current = null;
        streamRef.current = null;
        setIsStreaming(false);
      }
    },
    [
      apiClient,
      enabledSkillIds,
      loadMessages,
      markActiveAssistant,
      reasoningEffort,
      reasoningEnabled,
      selectedKbIds,
      session.id,
      skills,
      webSearchEnabled,
    ],
  );

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if ((!content && pendingImages.length === 0) || isStreaming) {
      return;
    }
    await lightTap();
    await executeStream({
      content: content || "请分析图片内容",
      images: pendingImages,
      replyToId:
        replyToMessage && typeof replyToMessage.id === "number"
          ? replyToMessage.id
          : undefined,
      restoreDraftOnError: true,
    });
  }, [executeStream, input, isStreaming, pendingImages, replyToMessage]);

  const handleStop = useCallback(async () => {
    if (!isStreaming) return;
    await lightTap();
    stopRequestedRef.current = true;
    const activeStream = streamRef.current;
    abortRef.current?.abort();

    if (activeStream) {
      void apiClient
        .cancelStream(session.id, activeStream.clientMessageId, activeStream.messageId)
        .catch(() => {});
    }
  }, [apiClient, isStreaming, session.id]);

  const handleRetryAssistantMessage = useCallback(
    async (assistantMsg: ChatMessage) => {
      if (isStreaming || typeof assistantMsg.id !== "number") return;
      try {
        const res = await apiClient.regenerateMessage(session.id, assistantMsg.id);
        await loadMessages("refresh");
        await executeStream({
          content: "",
          images: [],
          replyToId: res.userMessageId,
          restoreDraftOnError: false,
        });
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "重新生成失败。");
      }
    },
    [apiClient, executeStream, isStreaming, loadMessages, session.id],
  );

  const handlePickCamera = useCallback(async () => {
    const result = await takePhotoWithCamera(pendingImages.length);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    if (result.images.length > 0) {
      setPendingImages((prev) => [...prev, ...result.images]);
    }
  }, [pendingImages.length]);

  const handlePickGallery = useCallback(async () => {
    const result = await pickImagesFromLibrary(pendingImages.length);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    if (result.images.length > 0) {
      setPendingImages((prev) => [...prev, ...result.images]);
    }
  }, [pendingImages.length]);

  const handlePickDocument = useCallback(async () => {
    const picked = await pickDocumentFile();
    if (!picked.ok) {
      setErrorMessage(picked.message);
      return;
    }
    if (!picked.file) return;
    setIsUploadingDoc(true);
    setErrorMessage(null);
    try {
      await apiClient.uploadDocument(picked.file, session.id);
      const docs = await apiClient.getSessionDocuments(session.id);
      setSessionDocuments(docs);
      setNoticeMessage(`已将「${picked.file.name}」附加到当前对话。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "上传文档失败。");
    } finally {
      setIsUploadingDoc(false);
    }
  }, [apiClient, session.id]);

  const handleDetachDocument = useCallback(
    async (docId: number) => {
      try {
        await apiClient.detachDocument(docId, session.id);
        setSessionDocuments((prev) => prev.filter((d) => d.id !== docId));
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "移除文档失败。");
      }
    },
    [apiClient, session.id],
  );

  const activeModelLabel = useMemo(() => {
    if (session.modelLabel) return session.modelLabel;
    const found = models.find(
      (m) => m.rawId === session.modelRawId || m.id === session.modelRawId,
    );
    return found?.name || session.modelRawId || "选择模型";
  }, [models, session.modelLabel, session.modelRawId]);

  const canSend =
    (input.trim().length > 0 || pendingImages.length > 0) && !isStreaming;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: theme.surface, borderBottomColor: theme.border },
        ]}
      >
        {showDrawerTrigger ? (
          <Pressable
            accessibilityLabel="打开会话列表"
            onPress={() => {
              void lightTap();
              onOpenDrawer();
            }}
            style={[styles.headerBtn, { backgroundColor: theme.surfaceSubtle }]}
          >
            <MaterialCommunityIcons color={theme.foreground} name="menu" size={20} />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}

        <Pressable onPress={onOpenModelPicker} style={styles.headerCenter}>
          <Text numberOfLines={1} style={[styles.headerTitle, { color: theme.foreground }]}>
            {session.title?.trim() || "新对话"}
          </Text>
          <View style={[styles.modelPill, { backgroundColor: theme.primarySurface }]}>
            <Text numberOfLines={1} style={[styles.modelPillText, { color: theme.signalText }]}>
              {activeModelLabel}
            </Text>
            <MaterialCommunityIcons color={theme.signalText} name="chevron-down" size={14} />
          </View>
        </Pressable>

        <Pressable
          accessibilityLabel="新建对话"
          onPress={() => {
            void lightTap();
            onNewChat();
          }}
          style={[styles.headerBtn, { backgroundColor: theme.surfaceSubtle }]}
        >
          <MaterialCommunityIcons color={theme.signalText} name="plus" size={20} />
        </Pressable>
      </View>

      {errorMessage ? (
        <View
          style={[
            styles.banner,
            { backgroundColor: theme.dangerSurface, borderBottomColor: theme.danger },
          ]}
        >
          <Text style={[styles.bannerText, { color: theme.danger }]}>{errorMessage}</Text>
          <Pressable hitSlop={6} onPress={() => setErrorMessage(null)}>
            <MaterialCommunityIcons color={theme.danger} name="close" size={16} />
          </Pressable>
        </View>
      ) : null}

      {noticeMessage ? (
        <View
          style={[
            styles.banner,
            { backgroundColor: theme.primarySurface, borderBottomColor: theme.primary },
          ]}
        >
          <Text style={[styles.bannerText, { color: theme.signalText }]}>{noticeMessage}</Text>
          <Pressable hitSlop={6} onPress={() => setNoticeMessage(null)}>
            <MaterialCommunityIcons color={theme.signalText} name="close" size={16} />
          </Pressable>
        </View>
      ) : null}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 54 : 0}
        style={styles.flex}
      >
        <View style={styles.flex}>
          {isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={theme.primary} />
              <Text style={[styles.mutedText, { color: theme.mutedForeground }]}>
                正在加载历史消息…
              </Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              contentContainerStyle={
                messages.length === 0 ? styles.emptyList : styles.messageList
              }
              data={messages}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              keyExtractor={(item, index) => `${item.id}-${index}`}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <View style={[styles.emptyIcon, { backgroundColor: theme.primarySurface }]}>
                    <MaterialCommunityIcons color={theme.signalText} name="star-four-points" size={24} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: theme.foreground }]}>
                    开始新对话
                  </Text>
                  <Text style={[styles.emptySub, { color: theme.mutedForeground }]}>
                    支持多模态发图、文档上传、深度思考时间轴与实时联网检索。
                  </Text>
                </View>
              }
              onContentSizeChange={() => {
                if (shouldFollowStreamRef.current && messages.length > 0) {
                  listRef.current?.scrollToEnd({ animated: false });
                }
              }}
              onScroll={(event) => {
                const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
                const distanceFromBottom =
                  contentSize.height - (contentOffset.y + layoutMeasurement.height);
                const nearBottom = distanceFromBottom <= 96;
                shouldFollowStreamRef.current = nearBottom;
                setShowScrollToBottom(!nearBottom && messages.length > 2);
              }}
              refreshControl={
                <RefreshControl
                  onRefresh={() => loadMessages("refresh")}
                  refreshing={isRefreshing}
                  tintColor={theme.primary}
                />
              }
              renderItem={({ item }) => (
                <MessageBubble
                  endpoint={apiClient.getEndpoint()}
                  message={item}
                  onPreviewImage={setPreviewImageUri}
                  onReply={(msg) => setReplyToMessage(msg)}
                  onRetry={handleRetryAssistantMessage}
                  theme={theme}
                />
              )}
              scrollEventThrottle={100}
            />
          )}

          {showScrollToBottom ? (
            <Pressable
              accessibilityLabel="回到底部"
              onPress={() => scrollToBottom(true)}
              style={[
                styles.scrollBottomBtn,
                { backgroundColor: theme.surface, borderColor: theme.borderStrong },
              ]}
            >
              <MaterialCommunityIcons color={theme.signalText} name="arrow-down" size={16} />
              <Text style={[styles.scrollBottomText, { color: theme.signalText }]}>
                最新消息
              </Text>
            </Pressable>
          ) : null}
        </View>

        <ChatComposer
          bottomInset={insets.bottom}
          canSend={canSend}
          isListeningVoice={voice.isListening}
          isStreaming={isStreaming}
          isUploadingDoc={isUploadingDoc}
          onChangeText={setInput}
          onClearReply={() => setReplyToMessage(null)}
          onDetachDocument={handleDetachDocument}
          onOpenExtensions={() => setExtensionsOpen(true)}
          onPickCamera={handlePickCamera}
          onPickDocument={handlePickDocument}
          onPickGallery={handlePickGallery}
          onPressVoice={() => void voice.toggleListening()}
          onRemoveImage={(id) =>
            setPendingImages((prev) => prev.filter((item) => item.id !== id))
          }
          onSend={() => void handleSend()}
          onStop={() => void handleStop()}
          pendingImages={pendingImages}
          reasoningEnabled={reasoningEnabled}
          replyToMessage={replyToMessage}
          selectedKbCount={selectedKbIds.length}
          selectedSkillsCount={enabledSkillIds.length}
          sessionDocuments={sessionDocuments}
          theme={theme}
          value={input}
          webSearchEnabled={webSearchEnabled}
          onToggleReasoning={() => setReasoningEnabled((v) => !v)}
          onToggleWebSearch={() => setWebSearchEnabled((v) => !v)}
        />
      </KeyboardAvoidingView>

      <SessionExtensionsSheet
        enabledSkillIds={enabledSkillIds}
        knowledgeBases={knowledgeBases}
        mcpTools={mcpTools}
        onChangeReasoningEffort={(effort) => {
          setReasoningEffort(effort);
          void apiClient
            .updateSession(session.id, { reasoningEffort: effort })
            .then(onSessionUpdated)
            .catch(() => {});
        }}
        onChangeReasoningEnabled={(enabled) => {
          setReasoningEnabled(enabled);
          void apiClient
            .updateSession(session.id, { reasoningEnabled: enabled })
            .then(onSessionUpdated)
            .catch(() => {});
        }}
        onChangeWebSearchEnabled={setWebSearchEnabled}
        onClose={() => setExtensionsOpen(false)}
        onSaveSystemPrompt={async (nextPrompt) => {
          const updated = await apiClient.updateSession(session.id, {
            systemPrompt: nextPrompt || null,
          });
          onSessionUpdated(updated);
        }}
        onToggleKb={(id) => {
          const next = selectedKbIds.includes(id)
            ? selectedKbIds.filter((item) => item !== id)
            : [...selectedKbIds, id];
          setSelectedKbIds(next);
          void apiClient
            .updateSession(session.id, { knowledgeBaseIds: next })
            .then(onSessionUpdated)
            .catch(() => {});
        }}
        onToggleSkill={(skill) => {
          setEnabledSkillIds((prev) =>
            prev.includes(skill.id)
              ? prev.filter((item) => item !== skill.id)
              : [...prev, skill.id],
          );
        }}
        reasoningEffort={reasoningEffort}
        reasoningEnabled={reasoningEnabled}
        selectedKbIds={selectedKbIds}
        skills={skills}
        systemPrompt={session.systemPrompt ?? ""}
        theme={theme}
        visible={extensionsOpen}
        webSearchEnabled={webSearchEnabled}
      />

      <ImagePreviewModal
        imageUri={previewImageUri}
        onClose={() => setPreviewImageUri(null)}
        theme={theme}
        visible={Boolean(previewImageUri)}
      />
    </View>
  );
}

function createClientMessageId() {
  return `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    columnGap: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 54,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  headerBtn: {
    alignItems: "center",
    borderRadius: radii.md,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  headerSpacer: {
    width: 36,
  },
  headerCenter: {
    alignItems: "center",
    flex: 1,
    rowGap: 3,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  modelPill: {
    alignItems: "center",
    borderRadius: radii.pill,
    columnGap: 4,
    flexDirection: "row",
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  modelPillText: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "600",
  },
  banner: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    columnGap: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  centered: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    rowGap: spacing.sm,
  },
  mutedText: {
    fontSize: 13,
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  emptyWrap: {
    alignItems: "center",
    rowGap: 10,
  },
  emptyIcon: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  emptySub: {
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 280,
    textAlign: "center",
  },
  messageList: {
    padding: spacing.lg,
    rowGap: spacing.lg,
  },
  scrollBottomBtn: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    bottom: 12,
    columnGap: 4,
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 8,
    position: "absolute",
  },
  scrollBottomText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
