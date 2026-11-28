import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
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
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  const drawerWidth = Math.min(312, Math.max(272, Dimensions.get("window").width * 0.8));
  const slideAnim = useRef(new Animated.Value(-drawerWidth)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: drawerOpen ? 0 : -drawerWidth,
      duration: 210,
      useNativeDriver: true,
    }).start();
  }, [drawerOpen, drawerWidth, slideAnim]);

  const loadWorkspace = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [sessionRes, modelList] = await Promise.all([
        apiClient.getSessions(1, 100),
        apiClient.getModels(),
      ]);
      const list = sessionRes.sessions ?? [];
      setSessions(list);
      setModels(modelList ?? []);
      setActiveSessionId((prev) => {
        if (prev && list.some((s) => s.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载工作区失败，请重试。");
    } finally {
      setIsLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const handleCreateSession = useCallback(
    async (preferredModel?: ModelItem) => {
      const usableModels = models.filter(
        (m) => m.modelType !== "embedding" && m.accessDecision !== "deny",
      );
      const targetModel = preferredModel ?? usableModels[0];
      if (!targetModel) {
        setErrorMessage("当前账号没有可用对话模型，请联系管理员配置。");
        return;
      }

      setIsCreating(true);
      setErrorMessage(null);
      try {
        const created = await apiClient.createSession({
          modelId: targetModel.id,
          rawId: targetModel.rawId,
          connectionId: targetModel.connectionId ?? undefined,
          reasoningEnabled: preferences.defaultReasoningEnabled,
          reasoningEffort: preferences.defaultReasoningEffort,
        });
        await successTap();
        setSessions((prev) => [created, ...prev]);
        setActiveSessionId(created.id);
        setView("chat");
        setDrawerOpen(false);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "创建会话失败。");
      } finally {
        setIsCreating(false);
      }
    },
    [
      apiClient,
      models,
      preferences.defaultReasoningEffort,
      preferences.defaultReasoningEnabled,
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
        setErrorMessage(error instanceof Error ? error.message : "切换模型失败。");
      }
    },
    [activeSession, apiClient, handleCreateSession],
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
        setErrorMessage(error instanceof Error ? error.message : "更新置顶状态失败。");
      }
    },
    [apiClient],
  );

  const handleRenameSession = useCallback(
    async (session: ChatSession, newTitle: string) => {
      const updated = await apiClient.updateSession(session.id, { title: newTitle });
      setSessions((prev) =>
        prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
      );
    },
    [apiClient],
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
                setErrorMessage(err instanceof Error ? err.message : "清空消息失败。"),
              );
          },
        },
      ]);
    },
    [apiClient, loadWorkspace],
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
                setSessions((prev) => {
                  const next = prev.filter((item) => item.id !== session.id);
                  if (activeSessionId === session.id) {
                    setActiveSessionId(next[0]?.id ?? null);
                  }
                  return next;
                });
              })
              .catch((err) =>
                setErrorMessage(err instanceof Error ? err.message : "删除会话失败。"),
              );
          },
        },
      ]);
    },
    [activeSessionId, apiClient],
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
      onClearMessages={handleClearMessages}
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
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.primary} />
            <Text style={[styles.statusText, { color: theme.mutedForeground }]}>
              正在同步会话与模型列表…
            </Text>
          </View>
        ) : activeSession ? (
          <ChatScreen
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
                  {errorMessage || "当前还没有历史会话，点击下方按钮立即开启第一轮对话。"}
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
