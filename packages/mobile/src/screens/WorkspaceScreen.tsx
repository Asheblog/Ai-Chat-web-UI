import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import type { MobileUser } from "../auth-types";
import { SessionDrawerContent } from "../components/drawer/SessionDrawer";
import { ModelPickerSheet } from "../components/sheets/ModelPickerSheet";
import { Button, SurfaceCard } from "../components/ui/UiPrimitives";
import type { MobileApiClient } from "../mobile-api-client";
import { lightTap, successTap } from "../native/haptics";
import type { ChatSession, ModelItem } from "../session-types";
import { useAppTheme } from "../theme/ThemeProvider";
import { spacing } from "../theme/tokens";
import type { MobilePreferences, ServerProfile } from "../types/mobile";
import { ChatScreen } from "./ChatScreen";
import { SettingsScreen } from "./SettingsScreen";
import { loadAllSessions } from "./workspace-session-loader";

type WorkspaceScreenProps = {
  apiClient: MobileApiClient;
  user: MobileUser;
  activeServer: ServerProfile | null;
  preferences: MobilePreferences;
  isLoggingOut: boolean;
  onUpdatePreferences: (patch: Partial<MobilePreferences>) => void;
  onOpenServers: () => void;
  onLogout: () => void;
};

export function WorkspaceScreen({
  apiClient,
  user,
  activeServer,
  preferences,
  isLoggingOut,
  onUpdatePreferences,
  onOpenServers,
  onLogout,
}: WorkspaceScreenProps) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const isTabletSplit = width >= 768;

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"load" | "action">("action");
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  const creatingRef = useRef(false);
  const sessionsRequestRef = useRef(0);
  const refreshSessionsInFlightRef = useRef(false);
  const drawerWidth = Math.min(312, Math.max(272, width * 0.8));
  const slideAnim = useRef(new Animated.Value(-drawerWidth)).current;

  const showError = useCallback((message: string, kind: "load" | "action" = "action") => {
    setErrorMessage(message);
    setErrorKind(kind);
  }, []);

  // Android 返回键优先关闭应用内自定义层（抽屉 / 设置页），而不是直接退出应用。
  useEffect(() => {
    if (Platform.OS !== "android") return;
    if (!drawerOpen && view === "chat") return;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (drawerOpen) {
        setDrawerOpen(false);
        return true;
      }
      if (view === "settings") {
        setView("chat");
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [drawerOpen, view]);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: drawerOpen ? 0 : -drawerWidth,
      duration: 210,
      useNativeDriver: true,
    }).start();
  }, [drawerOpen, drawerWidth, slideAnim]);

  const loadWorkspace = useCallback(async () => {
    const sessionsRequestId = ++sessionsRequestRef.current;
    setIsLoading(true);
    setErrorMessage(null);
    setErrorKind("load");

    const [sessionRes, modelRes] = await Promise.allSettled([
      loadAllSessions(apiClient),
      apiClient.getModels(),
    ]);

    const problems: string[] = [];

    // 刷新期间可能已经发起更新的会话请求；旧结果不得覆盖新列表。
    const isLatestSessionsRequest = sessionsRequestId === sessionsRequestRef.current;

    if (sessionRes.status === "fulfilled") {
      if (isLatestSessionsRequest) {
        const list = sessionRes.value.sessions;
        setSessions(list);
        setActiveSessionId((prev) => {
          if (prev && list.some((s) => s.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
        if (sessionRes.value.incomplete) {
          problems.push("会话列表仅加载了部分内容，可下拉刷新重试。");
        }
      }
    } else if (isLatestSessionsRequest) {
      problems.push(
        sessionRes.reason instanceof Error
          ? `会话列表加载失败：${sessionRes.reason.message}`
          : "会话列表加载失败，请重试。",
      );
    }

    if (modelRes.status === "fulfilled") {
      setModels(modelRes.value ?? []);
    } else {
      problems.push(
        modelRes.reason instanceof Error
          ? `模型列表加载失败：${modelRes.reason.message}`
          : "模型列表加载失败。",
      );
    }

    if (problems.length > 0) {
      showError(problems.join(" "), "load");
    }
    setIsLoading(false);
  }, [apiClient, showError]);

  /**
   * 抽屉下拉刷新：只刷新会话列表，不设置 isLoading，因此不会卸载当前 ChatScreen，
   * 进行中的流式回复和输入草稿保持不变。后续分页失败时保留现有列表并提示，可再次下拉重试。
   */
  const refreshSessions = useCallback(async () => {
    if (isLoading || refreshSessionsInFlightRef.current) return;

    refreshSessionsInFlightRef.current = true;
    setIsRefreshingSessions(true);
    setErrorMessage(null);
    const requestId = ++sessionsRequestRef.current;

    try {
      const result = await loadAllSessions(apiClient);
      if (requestId !== sessionsRequestRef.current) return;

      if (result.incomplete) {
        showError("会话列表仅加载了部分内容，已保留当前列表，可再次下拉重试。", "load");
        return;
      }

      setSessions(result.sessions);
      setActiveSessionId((prev) => {
        if (prev && result.sessions.some((s) => s.id === prev)) return prev;
        return result.sessions[0]?.id ?? null;
      });
    } catch (error) {
      if (requestId !== sessionsRequestRef.current) return;
      showError(
        error instanceof Error ? error.message : "刷新会话列表失败，请重试。",
        "load",
      );
    } finally {
      refreshSessionsInFlightRef.current = false;
      setIsRefreshingSessions(false);
    }
  }, [apiClient, isLoading, showError]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const handleCreateSession = useCallback(
    async (preferredModel?: ModelItem) => {
      if (creatingRef.current) return;

      creatingRef.current = true;
      setIsCreating(true);
      setErrorMessage(null);

      try {
        let availableModels = models;
        if (!preferredModel && availableModels.length === 0) {
          // 首屏模型接口失败后仍允许用户直接新建：重试一次模型列表，而不是直接判定“没有模型”。
          try {
            availableModels = await apiClient.getModels();
            setModels(availableModels);
          } catch {
            availableModels = [];
          }
        }

        const usableModels = availableModels.filter(
          (m) => m.modelType !== "embedding" && m.accessDecision !== "deny",
        );
        const targetModel = preferredModel ?? usableModels[0];
        if (!targetModel) {
          showError("暂时无法读取可用对话模型，请稍后重试或检查服务端模型配置。");
          return;
        }

        const created = await apiClient.createSession({
          modelId: targetModel.id,
          rawId: targetModel.rawId,
          connectionId: targetModel.connectionId ?? undefined,
          reasoningEnabled: preferences.defaultReasoningEnabled,
          reasoningEffort: preferences.defaultReasoningEffort,
        });
        await successTap();
        setSessions((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        setActiveSessionId(created.id);
        setView("chat");
        setDrawerOpen(false);
      } catch (error) {
        showError(error instanceof Error ? error.message : "创建会话失败。");
      } finally {
        creatingRef.current = false;
        setIsCreating(false);
      }
    },
    [
      apiClient,
      models,
      preferences.defaultReasoningEffort,
      preferences.defaultReasoningEnabled,
      showError,
    ],
  );

  const handleSelectModel = useCallback(
    async (model: ModelItem) => {
      if (!activeSession) {
        await handleCreateSession(model);
        return;
      }
      try {
        const updated = await apiClient.switchSessionModel(activeSession.id, {
          modelId: model.id,
          rawId: model.rawId,
          connectionId: model.connectionId ?? undefined,
        });
        setSessions((prev) =>
          prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
        );
      } catch (error) {
        showError(error instanceof Error ? error.message : "切换模型失败。");
      }
    },
    [activeSession, apiClient, handleCreateSession, showError],
  );

  const handleTogglePin = useCallback(
    async (session: ChatSession) => {
      try {
        const updated = await apiClient.updateSession(session.id, {
          pinned: !session.pinnedAt,
        });
        setSessions((prev) =>
          prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
        );
      } catch (error) {
        showError(error instanceof Error ? error.message : "更新置顶状态失败。");
      }
    },
    [apiClient, showError],
  );

  const handleRenameSession = useCallback(
    async (session: ChatSession, newTitle: string) => {
      try {
        const updated = await apiClient.updateSession(session.id, { title: newTitle });
        setSessions((prev) =>
          prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "重命名会话失败。";
        showError(message);
        // 抽屉里的重命名弹窗需要感知失败并保持打开，再显示同一错误。
        throw error instanceof Error ? error : new Error(message);
      }
    },
    [apiClient, showError],
  );

  const handleClearMessages = useCallback(
    (session: ChatSession) => {
      Alert.alert("清空历史消息", `确定要清空「${session.title || "该对话"}」的所有消息吗？`, [
        { text: "取消", style: "cancel" },
        {
          text: "清空",
          style: "destructive",
          onPress: () => {
            void apiClient
              .clearSessionMessages(session.id)
              .then(() => loadWorkspace())
              .catch((err) =>
                showError(err instanceof Error ? err.message : "清空消息失败。"),
              );
          },
        },
      ]);
    },
    [apiClient, loadWorkspace, showError],
  );

  const handleDeleteSession = useCallback(
    (session: ChatSession) => {
      Alert.alert("删除会话", `确定要删除「${session.title || "未命名对话"}」吗？`, [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: () => {
            void apiClient
              .deleteSession(session.id)
              .then(() => {
                const next = sessions.filter((item) => item.id !== session.id);
                setSessions(next);
                if (activeSessionId === session.id) {
                  setActiveSessionId(next[0]?.id ?? null);
                }
              })
              .catch((err) =>
                showError(err instanceof Error ? err.message : "删除会话失败。"),
              );
          },
        },
      ]);
    },
    [activeSessionId, apiClient, sessions, showError],
  );

  if (view === "settings") {
    return (
      <SettingsScreen
        activeServer={activeServer}
        apiClient={apiClient}
        isLoggingOut={isLoggingOut}
        onBack={() => setView("chat")}
        onLogout={onLogout}
        onOpenServers={onOpenServers}
        onUpdatePreferences={onUpdatePreferences}
        preferences={preferences}
        user={user}
      />
    );
  }

  const drawerContent = (
    <SessionDrawerContent
      activeServer={activeServer}
      activeSessionId={activeSessionId}
      errorMessage={errorMessage}
      isRefreshingSessions={isRefreshingSessions}
      onClearMessages={handleClearMessages}
      onDismissError={() => setErrorMessage(null)}
      onRefreshSessions={() => void refreshSessions()}
      onRetryError={
        errorKind === "load" && !activeSession ? () => void loadWorkspace() : undefined
      }
      onClose={isTabletSplit ? undefined : () => setDrawerOpen(false)}
      onDeleteSession={handleDeleteSession}
      onNewChat={() => void handleCreateSession()}
      onOpenServers={() => {
        setDrawerOpen(false);
        onOpenServers();
      }}
      onOpenSettings={() => {
        setDrawerOpen(false);
        setView("settings");
      }}
      onRenameSession={handleRenameSession}
      onSelectSession={(s) => {
        setActiveSessionId(s.id);
        setView("chat");
        setDrawerOpen(false);
      }}
      onTogglePin={handleTogglePin}
      sessions={sessions}
      theme={theme}
      user={user}
    />
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {isTabletSplit ? (
        <View style={[styles.tabletSidebar, { borderRightColor: theme.border }]}>
          {drawerContent}
        </View>
      ) : null}

      <View style={styles.mainStage}>
        {errorMessage && !isTabletSplit && !drawerOpen ? (
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            style={[
              styles.errorBanner,
              {
                backgroundColor: theme.dangerSurface,
                borderBottomColor: theme.danger,
              },
            ]}
          >
            <MaterialCommunityIcons
              color={theme.danger}
              name="alert-circle-outline"
              size={16}
            />
            <Text style={[styles.errorBannerText, { color: theme.danger }]}>
              {errorMessage}
            </Text>
            {errorKind === "load" && !activeSession ? (
              <Pressable
                accessibilityLabel="重新加载工作区"
                accessibilityRole="button"
                onPress={() => void loadWorkspace()}
                style={styles.bannerAction}
              >
                <MaterialCommunityIcons color={theme.danger} name="reload" size={16} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel="关闭错误提示"
              accessibilityRole="button"
              onPress={() => setErrorMessage(null)}
              style={styles.bannerAction}
            >
              <MaterialCommunityIcons color={theme.danger} name="close" size={16} />
            </Pressable>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.primary} />
            <Text style={[styles.statusText, { color: theme.mutedForeground }]}>
              正在同步会话与模型列表…
            </Text>
          </View>
        ) : activeSession ? (
          <ChatScreen
            key={activeSession.id}
            apiClient={apiClient}
            models={models}
            onNewChat={() => void handleCreateSession()}
            onOpenDrawer={() => setDrawerOpen(true)}
            onOpenModelPicker={() => setModelPickerOpen(true)}
            onSessionUpdated={(updated) =>
              setSessions((prev) =>
                prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
              )
            }
            preferences={preferences}
            session={activeSession}
            showDrawerTrigger={!isTabletSplit}
            theme={theme}
          />
        ) : (
          <View style={styles.emptyStage}>
            <SurfaceCard theme={theme}>
              <View style={styles.emptyCard}>
                <Text style={[styles.emptyTitle, { color: theme.foreground }]}>
                  欢迎使用 AIChat Mobile
                </Text>
                <Text style={[styles.emptySub, { color: theme.mutedForeground }]}>
                  当前还没有历史会话，点击下方按钮立即开启第一轮对话。
                </Text>
                <View style={styles.emptyActions}>
                  <Button
                    disabled={isCreating}
                    icon="plus"
                    label="新建对话"
                    loading={isCreating}
                    onPress={() => void handleCreateSession()}
                    theme={theme}
                  />
                  {!isTabletSplit ? (
                    <Button
                      icon="cog-outline"
                      label="打开设置"
                      onPress={() => {
                        void lightTap();
                        setView("settings");
                      }}
                      theme={theme}
                      variant="secondary"
                    />
                  ) : null}
                </View>
              </View>
            </SurfaceCard>
          </View>
        )}
      </View>

      {!isTabletSplit && drawerOpen ? (
        <View style={StyleSheet.absoluteFill}>
          <Pressable
            onPress={() => setDrawerOpen(false)}
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]}
          />
          <Animated.View
            style={[
              styles.mobileDrawer,
              {
                width: drawerWidth,
                transform: [{ translateX: slideAnim }],
              },
            ]}
          >
            {drawerContent}
          </Animated.View>
        </View>
      ) : null}

      <ModelPickerSheet
        models={models}
        onClose={() => setModelPickerOpen(false)}
        onSelectModel={(model) => void handleSelectModel(model)}
        selectedModelId={activeSession?.modelRawId ?? null}
        theme={theme}
        visible={modelPickerOpen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
  },
  tabletSidebar: {
    borderRightWidth: StyleSheet.hairlineWidth,
    width: 300,
  },
  mainStage: {
    flex: 1,
  },
  errorBanner: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
  },
  errorBannerText: {
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
  statusText: {
    fontSize: 13,
  },
  emptyStage: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  emptyCard: {
    rowGap: spacing.md,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "800",
  },
  emptySub: {
    fontSize: 14,
    lineHeight: 21,
  },
  emptyActions: {
    rowGap: spacing.sm,
  },
  mobileDrawer: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
  },
});
