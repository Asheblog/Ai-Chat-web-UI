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
import { mergePendingImages } from "./chat-attachment-utils";
import { resolveSkillBindingVersion } from "./chat-skill-utils";
import {
  appendAssistantContent,
  appendAssistantGeneratedImages,
  appendAssistantReasoning,
  appendAssistantToolCall,
  findReplyTargetUserId,
  normalizeMessage,
} from "./chat-message-utils";
import { ChatStreamCoordinator } from "./chat-stream-coordinator";
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
  generation: number;
  sessionId: number;
};

type ErrorKind = "load" | "action";

type StreamOutcome = "completed" | "failed" | "cancelled" | "busy";

type ExecuteStreamOptions = {
  content: string;
  images: PendingImageAttachment[];
  replyToId?: number;
  restoreDraftOnError: boolean;
  /** 请求失败时恢复的文字草稿，默认使用 content（图片-only 时为空串，而非占位指令）。 */
  restoreInput?: string;
  /** 请求失败时恢复的引用目标。 */
  restoreReplyTo?: ChatMessage | null;
  /** 重新生成时服务端复用已有提问，不再追加本地用户气泡。 */
  appendUserMessage?: boolean;
  /** 流成功、最终刷新前执行（例如清理被替换的旧回复）。 */
  onStreamCompleted?: () => Promise<void>;
};

/** 图片-only 消息的回退指令，与 Web 端 buildAttachmentFallbackPrompt 保持一致。 */
const IMAGE_ONLY_FALLBACK_PROMPT = "请查看这些图片";

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
  const coordinatorRef = useRef(new ChatStreamCoordinator());
  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef<StreamState | null>(null);
  const messageRequestRef = useRef(0);
  const extensionsRequestRef = useRef(0);
  const updatingSkillIdsRef = useRef(new Set<number>());
  const shouldFollowStreamRef = useRef(true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
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

  const knowledgeBaseKey = Array.isArray(session.knowledgeBaseIds)
    ? session.knowledgeBaseIds.join(",")
    : "";

  // 只同步服务端已保存的会话开关；不再因为会话对象刷新而清空草稿、附件或引用。
  // 会话切换由 WorkspaceScreen 的 key 触发组件重挂载，附件天然按会话隔离。
  useEffect(() => {
    setReasoningEnabled(session.reasoningEnabled ?? preferences.defaultReasoningEnabled);
    setReasoningEffort(session.reasoningEffort ?? preferences.defaultReasoningEffort);
  }, [
    preferences.defaultReasoningEffort,
    preferences.defaultReasoningEnabled,
    session.id,
    session.reasoningEffort,
    session.reasoningEnabled,
  ]);

  useEffect(() => {
    setSelectedKbIds(Array.isArray(session.knowledgeBaseIds) ? session.knowledgeBaseIds : []);
  }, [knowledgeBaseKey, session.id]);

  // 卸载（含切换会话导致的 key 重挂载、退出登录、切换服务端）时中止本地流，
  // 并尽力通知服务端取消，避免遗留仍在生成的后台任务。
  useEffect(() => {
    return () => {
      const active = coordinatorRef.current.cancelActive();
      const stream = streamRef.current;
      abortRef.current?.abort();
      if (active && stream) {
        void apiClient
          .cancelStream(active.sessionId, stream.clientMessageId, stream.messageId)
          .catch(() => {});
      }
      abortRef.current = null;
      streamRef.current = null;
    };
  }, [apiClient]);

  const showError = useCallback((message: string, kind: ErrorKind = "action") => {
    setErrorMessage(message);
    setErrorKind(kind);
  }, []);

  const dismissError = useCallback(() => {
    setErrorMessage(null);
    setErrorKind(null);
  }, []);

  const loadMessages = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
      const requestId = ++messageRequestRef.current;
      if (mode === "initial") {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setErrorMessage(null);
      setErrorKind(null);

      try {
        const payload = await apiClient.getMessages(session.id, 100);
        // 后发的刷新请求优先：丢弃旧请求的迟到响应，避免历史消息倒序覆盖。
        if (messageRequestRef.current !== requestId) return;
        setMessages((payload.messages ?? []).map(normalizeMessage).filter(Boolean));
      } catch (error) {
        if (messageRequestRef.current !== requestId) return;
        showError(error instanceof Error ? error.message : "加载消息失败，请重试。", "load");
      } finally {
        if (messageRequestRef.current === requestId) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [apiClient, session.id, showError],
  );

  const loadExtensions = useCallback(async () => {
    const requestId = ++extensionsRequestRef.current;
    const [docsRes, kbRes, skillRes, mcpRes] = await Promise.allSettled([
      apiClient.getSessionDocuments(session.id),
      apiClient.getKnowledgeBases(),
      apiClient.getSessionSkillOptions(session.id),
      apiClient.getSessionMcpTools(session.id),
    ]);
    if (extensionsRequestRef.current !== requestId) return;
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
    onError: showError,
  });

  const scrollToBottom = useCallback((animated = true) => {
    shouldFollowStreamRef.current = true;
    setShowScrollToBottom(false);
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const markAssistantById = useCallback(
    (targetId: number | string, status: string, streamError?: string) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === targetId && message.streamStatus === "streaming"
            ? { ...message, streamStatus: status, streamError }
            : message,
        ),
      );
    },
    [],
  );

  const markActiveAssistant = useCallback(
    (generation: number, status: string, streamError?: string) => {
      if (!coordinatorRef.current.isCurrent(generation)) return;
      const targetId = streamRef.current?.assistantId;
      if (targetId == null) return;
      markAssistantById(targetId, status, streamError);
    },
    [markAssistantById],
  );

  const executeStream = useCallback(
    async (options: ExecuteStreamOptions): Promise<StreamOutcome> => {
      const {
        content,
        images,
        replyToId,
        restoreDraftOnError,
        appendUserMessage = true,
      } = options;
      const generation = coordinatorRef.current.begin(session.id);
      if (generation == null) return "busy";

      const clientMessageId = createClientMessageId();
      const now = new Date().toISOString();
      const userMessage: ChatMessage | null = appendUserMessage
        ? {
            id: `local-user-${clientMessageId}`,
            sessionId: session.id,
            role: "user",
            content,
            clientMessageId,
            images: images.map((img) => `data:${img.mime};base64,${img.data}`),
            replyToMessageId: replyToId ?? null,
            createdAt: now,
          }
        : null;
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
      streamRef.current = {
        assistantId,
        clientMessageId,
        messageId: null,
        generation,
        sessionId: session.id,
      };
      let streamStarted = false;
      shouldFollowStreamRef.current = true;

      if (restoreDraftOnError) {
        setInput("");
        setPendingImages([]);
        setReplyToMessage(null);
      }
      dismissError();
      setNoticeMessage(null);
      setIsStreaming(true);
      setMessages((current) => [
        ...current,
        ...(userMessage ? [userMessage] : []),
        assistantMessage,
      ]);

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
          // 停止 / 切换会话 / 卸载后，旧流的迟到分片不得再写入任何界面状态。
          if (!coordinatorRef.current.isCurrent(generation)) {
            return "cancelled";
          }

          if (chunk.type === "start") {
            streamStarted = true;
            const prevId: number | string = streamRef.current?.assistantId ?? assistantId;
            const nextId: number | string = chunk.assistantMessageId ?? prevId;
            streamRef.current = {
              assistantId: nextId,
              clientMessageId,
              messageId: chunk.assistantMessageId ?? null,
              generation,
              sessionId: session.id,
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
                if (
                  userMessage &&
                  message.id === userMessage.id &&
                  typeof chunk.messageId === "number"
                ) {
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

        if (!coordinatorRef.current.isCurrent(generation)) {
          return "cancelled";
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

        if (options.onStreamCompleted && coordinatorRef.current.isCurrent(generation)) {
          try {
            await options.onStreamCompleted();
          } catch {
            // 清理失败由调用方给出可恢复提示，不阻断最终消息同步。
          }
        }

        if (coordinatorRef.current.isCurrent(generation)) {
          await loadMessages("refresh");
        }
        return "completed";
      } catch (error) {
        if (!coordinatorRef.current.isCurrent(generation)) {
          return "cancelled";
        }

        if (isAbortError(error)) {
          markActiveAssistant(generation, "cancelled", "已停止生成。");
          return "cancelled";
        }

        await warningTap();
        const message = error instanceof Error ? error.message : "发送失败，请重试。";
        showError(message);

        if (!streamStarted) {
          setMessages((current) =>
            current.filter(
              (item) => item.id !== assistantId && item.id !== userMessage?.id,
            ),
          );
          if (restoreDraftOnError) {
            // 用用户原始草稿恢复（图片-only 时为空串），并把失败时新增的图片按 id 合并回去。
            setInput((current) =>
              current.trim().length === 0 ? options.restoreInput ?? content : current,
            );
            if (images.length > 0) {
              setPendingImages((current) => mergePendingImages(current, images));
            }
            setReplyToMessage((current) => current ?? options.restoreReplyTo ?? null);
          }
          return "failed";
        }

        markActiveAssistant(
          generation,
          "error",
          `${message} 下拉刷新可同步服务端已保存内容。`,
        );
        return "failed";
      } finally {
        if (coordinatorRef.current.release(generation)) {
          if (streamRef.current?.generation === generation) {
            streamRef.current = null;
          }
          abortRef.current = null;
          setIsStreaming(false);
        }
      }
    },
    [
      apiClient,
      dismissError,
      enabledSkillIds,
      loadMessages,
      markActiveAssistant,
      reasoningEffort,
      reasoningEnabled,
      selectedKbIds,
      session.id,
      showError,
      skills,
      webSearchEnabled,
    ],
  );

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if ((!content && pendingImages.length === 0) || isStreaming || streamRef.current) {
      return;
    }

    const replyTarget = replyToMessage;
    // 不在启动流之前 await 触感：await 期间若用户切换会话，组件已卸载，
    // executeStream 会在卸载后才开始且再也不会被 cleanup 取消。
    void lightTap();
    await executeStream({
      content: content || IMAGE_ONLY_FALLBACK_PROMPT,
      images: pendingImages,
      replyToId:
        replyTarget && typeof replyTarget.id === "number" ? replyTarget.id : undefined,
      restoreDraftOnError: true,
      restoreInput: content,
      restoreReplyTo: replyTarget,
      appendUserMessage: true,
    });
  }, [executeStream, input, isStreaming, pendingImages, replyToMessage]);

  const handleStop = useCallback(async () => {
    const stream = streamRef.current;
    const controller = abortRef.current;
    const active = coordinatorRef.current.cancelActive();
    if (!active || !stream) {
      setIsStreaming(false);
      return;
    }

    // 关键顺序：所有同步状态变更必须在第一个 await 之前完成，否则用户在停止的下一帧
    // 立即发送时，这里会清掉新流的 abortRef / streamRef。
    abortRef.current = null;
    streamRef.current = null;
    setIsStreaming(false);
    controller?.abort();
    markAssistantById(stream.assistantId, "cancelled", "已停止生成。");
    void lightTap();

    try {
      await apiClient.cancelStream(active.sessionId, stream.clientMessageId, stream.messageId);
    } catch {
      setNoticeMessage("已停止本地接收，但服务端取消未确认，请下拉刷新查看最终状态。");
    }
  }, [apiClient, markAssistantById]);

  const handleRetryAssistantMessage = useCallback(
    async (assistantMsg: ChatMessage) => {
      const assistantId = assistantMsg.id;
      if (
        isStreaming ||
        streamRef.current ||
        typeof assistantId !== "number"
      ) {
        return;
      }

      // 不调用会先删除旧回复的 /api/chat/regenerate：先复用已有用户提问生成新回复，
      // 成功后再删除被替换的旧回复。这样即使请求失败，历史中的旧答案仍然保留。
      const declaredParentMessageId = (
        assistantMsg as ChatMessage & { parentMessageId?: unknown }
      ).parentMessageId;
      const parentUserId = findReplyTargetUserId(
        messages,
        assistantId,
        typeof declaredParentMessageId === "number" ? declaredParentMessageId : null,
      );
      if (parentUserId == null) {
        showError("未找到这条回复对应的提问（可能已被上下文压缩），请刷新后重试。");
        return;
      }

      void lightTap();
      await executeStream({
        content: "",
        images: [],
        replyToId: parentUserId,
        restoreDraftOnError: false,
        appendUserMessage: false,
        onStreamCompleted: async () => {
          try {
            await apiClient.regenerateMessage(session.id, assistantId);
          } catch {
            setNoticeMessage("新回复已生成，但旧回复未能清理；下拉刷新后可能看到两条回复。");
          }
        },
      });
    },
    [apiClient, executeStream, isStreaming, messages, session.id, showError],
  );

  const handlePickCamera = useCallback(async () => {
    const result = await takePhotoWithCamera(pendingImages);
    if (!result.ok) {
      showError(result.message);
      return;
    }
    if (result.images.length > 0) {
      setPendingImages((prev) => mergePendingImages(prev, result.images));
    }
  }, [pendingImages, showError]);

  const handlePickGallery = useCallback(async () => {
    const result = await pickImagesFromLibrary(pendingImages);
    if (!result.ok) {
      showError(result.message);
      return;
    }
    if (result.images.length > 0) {
      setPendingImages((prev) => mergePendingImages(prev, result.images));
    }
  }, [pendingImages, showError]);

  const handlePickDocument = useCallback(async () => {
    const picked = await pickDocumentFile();
    if (!picked.ok) {
      showError(picked.message);
      return;
    }
    if (!picked.file) return;
    setIsUploadingDoc(true);
    dismissError();
    try {
      await apiClient.uploadDocument(picked.file, session.id);
      const docs = await apiClient.getSessionDocuments(session.id);
      setSessionDocuments(docs);
      setNoticeMessage(`已将「${picked.file.name}」附加到当前对话。`);
    } catch (error) {
      showError(error instanceof Error ? error.message : "上传文档失败。");
    } finally {
      setIsUploadingDoc(false);
    }
  }, [apiClient, dismissError, session.id, showError]);

  const handleDetachDocument = useCallback(
    async (docId: number) => {
      try {
        await apiClient.detachDocument(docId, session.id);
        setSessionDocuments((prev) => prev.filter((d) => d.id !== docId));
      } catch (error) {
        showError(error instanceof Error ? error.message : "移除文档失败。");
      }
    },
    [apiClient, session.id, showError],
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

  const handlePersistReasoningEnabled = useCallback(
    (enabled: boolean) => {
      const previous = reasoningEnabled;
      setReasoningEnabled(enabled);
      void apiClient
        .updateSession(session.id, { reasoningEnabled: enabled })
        .then(onSessionUpdated)
        .catch((error) => {
          setReasoningEnabled(previous);
          showError(
            error instanceof Error ? error.message : "保存深度思考设置失败，请重试。",
          );
        });
    },
    [apiClient, onSessionUpdated, reasoningEnabled, session.id, showError],
  );

  const handlePersistReasoningEffort = useCallback(
    (effort: ReasoningEffort) => {
      const previous = reasoningEffort;
      setReasoningEffort(effort);
      void apiClient
        .updateSession(session.id, { reasoningEffort: effort })
        .then(onSessionUpdated)
        .catch((error) => {
          setReasoningEffort(previous);
          showError(
            error instanceof Error ? error.message : "保存推理深度失败，请重试。",
          );
        });
    },
    [apiClient, onSessionUpdated, reasoningEffort, session.id, showError],
  );

  const handleToggleKnowledgeBase = useCallback(
    (id: number) => {
      const previous = selectedKbIds;
      const wasSelected = previous.includes(id);
      const next = wasSelected
        ? previous.filter((item) => item !== id)
        : [...previous, id];
      setSelectedKbIds(next);
      void apiClient
        .updateSession(session.id, { knowledgeBaseIds: next })
        .then(onSessionUpdated)
        .catch((error) => {
          // 只回滚这一个知识库，避免失败请求把用户刚选中的其他知识库一起抹掉。
          setSelectedKbIds((current) =>
            wasSelected
              ? current.includes(id)
                ? current
                : [...current, id]
              : current.filter((item) => item !== id),
          );
          showError(
            error instanceof Error ? error.message : "保存知识库选择失败，请重试。",
          );
        });
    },
    [apiClient, onSessionUpdated, selectedKbIds, session.id, showError],
  );

  const handleToggleSkill = useCallback(
    (skill: SkillOptionItem) => {
      // 已绑定的会话版本优先，否则回退到该 Skill 的默认版本；后端只接受正整数 versionId。
      // 两处都没有版本时不提交（Web 端同样直接返回），避免把开关表现成已保存。
      const versionId = resolveSkillBindingVersion(skill);
      if (versionId == null) {
        setNoticeMessage("该 Skill 尚未有可用版本，暂时无法启用。");
        return;
      }
      if (updatingSkillIdsRef.current.has(skill.id)) return;

      const previous = enabledSkillIds;
      const wasEnabled = previous.includes(skill.id);
      const enabled = !wasEnabled;
      const next = enabled
        ? [...previous, skill.id]
        : previous.filter((id) => id !== skill.id);
      setEnabledSkillIds(next);
      updatingSkillIdsRef.current.add(skill.id);

      void apiClient
        .updateSessionSkillBinding(session.id, {
          skillId: skill.id,
          versionId,
          enabled,
        })
        .catch((error) => {
          // 只回滚这一个 Skill，其他并发开关的结果不受影响。
          setEnabledSkillIds((current) =>
            wasEnabled
              ? current.includes(skill.id)
                ? current
                : [...current, skill.id]
              : current.filter((id) => id !== skill.id),
          );
          showError(
            error instanceof Error ? error.message : "保存 Skill 开关失败，请重试。",
          );
        })
        .finally(() => {
          updatingSkillIdsRef.current.delete(skill.id);
        });
    },
    [apiClient, enabledSkillIds, session.id, showError],
  );

  const handleSaveSystemPrompt = useCallback(
    async (nextPrompt: string) => {
      try {
        const updated = await apiClient.updateSession(session.id, {
          systemPrompt: nextPrompt || null,
        });
        onSessionUpdated(updated);
      } catch (error) {
        // 扩展面板的保存按钮没有错误分支，这里吞掉异常并用会话横幅告知，
        // 避免变成未处理的 Promise rejection。
        showError(
          error instanceof Error ? error.message : "保存会话提示词失败，请重试。",
        );
      }
    },
    [apiClient, onSessionUpdated, session.id, showError],
  );

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
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[
            styles.banner,
            { backgroundColor: theme.dangerSurface, borderBottomColor: theme.danger },
          ]}
        >
          <Text style={[styles.bannerText, { color: theme.danger }]}>{errorMessage}</Text>
          {errorKind === "load" ? (
            <Pressable
              accessibilityLabel="重新加载消息"
              accessibilityRole="button"
              onPress={() => void loadMessages("refresh")}
              style={styles.bannerAction}
            >
              <MaterialCommunityIcons color={theme.danger} name="reload" size={16} />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="关闭错误提示"
            accessibilityRole="button"
            onPress={dismissError}
            style={styles.bannerAction}
          >
            <MaterialCommunityIcons color={theme.danger} name="close" size={16} />
          </Pressable>
        </View>
      ) : null}

      {noticeMessage ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.banner,
            { backgroundColor: theme.primarySurface, borderBottomColor: theme.primary },
          ]}
        >
          <Text style={[styles.bannerText, { color: theme.signalText }]}>{noticeMessage}</Text>
          <Pressable
            accessibilityLabel="关闭提示"
            accessibilityRole="button"
            onPress={() => setNoticeMessage(null)}
            style={styles.bannerAction}
          >
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
                errorMessage && errorKind === "load" ? (
                  <View style={styles.emptyWrap}>
                    <View style={[styles.emptyIcon, { backgroundColor: theme.dangerSurface }]}>
                      <MaterialCommunityIcons
                        color={theme.danger}
                        name="cloud-off-outline"
                        size={24}
                      />
                    </View>
                    <Text style={[styles.emptyTitle, { color: theme.foreground }]}>
                      消息加载失败
                    </Text>
                    <Text style={[styles.emptySub, { color: theme.mutedForeground }]}>
                      {errorMessage}
                    </Text>
                    <Pressable
                      accessibilityLabel="重新加载消息"
                      accessibilityRole="button"
                      onPress={() => void loadMessages("refresh")}
                      style={[styles.retryButton, { backgroundColor: theme.primary }]}
                    >
                      <MaterialCommunityIcons
                        color={theme.primaryForeground}
                        name="reload"
                        size={16}
                      />
                      <Text style={[styles.retryButtonText, { color: theme.primaryForeground }]}>
                        重试
                      </Text>
                    </Pressable>
                  </View>
                ) : (
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
                )
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
                  onRefresh={() => void loadMessages("refresh")}
                  refreshing={isRefreshing}
                  tintColor={theme.primary}
                />
              }
              renderItem={({ item }) => (
                <MessageBubble
                  endpoint={apiClient.getEndpoint()}
                  message={item}
                  onPreviewImage={setPreviewImageUri}
                  onReply={(msg) => {
                    if (typeof msg.id !== "number") {
                      setNoticeMessage("这条消息仍在发送中，保存完成后才能引用。");
                      return;
                    }
                    setReplyToMessage(msg);
                  }}
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
        onChangeReasoningEffort={handlePersistReasoningEffort}
        onChangeReasoningEnabled={handlePersistReasoningEnabled}
        onChangeWebSearchEnabled={setWebSearchEnabled}
        onClose={() => setExtensionsOpen(false)}
        onSaveSystemPrompt={handleSaveSystemPrompt}
        onToggleKb={handleToggleKnowledgeBase}
        onToggleSkill={handleToggleSkill}
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
    paddingVertical: 2,
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 4,
  },
  bannerAction: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
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
  retryButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    columnGap: 6,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 18,
  },
  retryButtonText: {
    fontSize: 13,
    fontWeight: "700",
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
