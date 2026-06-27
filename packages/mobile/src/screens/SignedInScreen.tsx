import { useCallback, useEffect, useMemo, useState } from "react";

import type { MobileUser } from "../auth-types";
import type { MobileApiClient } from "../mobile-api-client";
import type { ChatSession, ModelItem } from "../session-types";
import type { AppTheme } from "../theme";
import { ChatScreen } from "./ChatScreen";
import { SessionListScreen } from "./SessionListScreen";

type SignedInScreenProps = {
  apiClient: MobileApiClient;
  endpoint: string;
  isLoggingOut: boolean;
  onEditEndpoint: () => void;
  onLogout: () => void;
  theme: AppTheme;
  user: MobileUser;
};

export function SignedInScreen({
  apiClient,
  endpoint,
  isLoggingOut,
  onEditEndpoint,
  onLogout,
  theme,
  user,
}: SignedInScreenProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [models, setModels] = useState<ModelItem[]>([]);

  const sortedSessions = useMemo(() => sortSessions(sessions), [sessions]);

  const fetchSessions = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    if (mode === "initial") {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setErrorMessage(null);

    try {
      const payload = await apiClient.getSessions(1, 100);
      const allSessions = [...(payload.sessions ?? [])];
      const totalPages = payload.pagination?.totalPages ?? 1;

      for (let page = 2; page <= totalPages; page += 1) {
        const nextPayload = await apiClient.getSessions(page, 100);
        allSessions.push(...(nextPayload.sessions ?? []));
      }

      setSessions(allSessions);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "获取会话列表失败，请重试。");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [apiClient]);

  useEffect(() => {
    fetchSessions("initial");
  }, [fetchSessions]);

  const handleCreateSession = useCallback(async () => {
    if (isCreating) {
      return;
    }

    setIsCreating(true);
    setErrorMessage(null);

    try {
      let availableModels = models;
      if (availableModels.length === 0) {
        availableModels = await apiClient.getModels();
        setModels(availableModels);
      }

      const selectedModel = selectDefaultModel(availableModels);
      if (!selectedModel) {
        setErrorMessage("当前服务端没有可用于创建会话的模型，请先在 Web 端配置模型。");
        return;
      }

      const created = await apiClient.createSession({
        modelId: selectedModel.id,
        title: "新的对话",
        ...(selectedModel.connectionId ? { connectionId: selectedModel.connectionId } : {}),
        ...(selectedModel.rawId ? { rawId: selectedModel.rawId } : {}),
      });

      setSessions((current) => sortSessions([created, ...current.filter((item) => item.id !== created.id)]));
      setSelectedSession(created);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "创建会话失败，请重试。");
    } finally {
      setIsCreating(false);
    }
  }, [apiClient, isCreating, models]);

  const handleSelectSession = useCallback((session: ChatSession) => {
    setSelectedSession(session);
  }, []);

  if (selectedSession) {
    return (
      <ChatScreen
        apiClient={apiClient}
        onBack={() => setSelectedSession(null)}
        session={selectedSession}
        theme={theme}
      />
    );
  }

  return (
    <SessionListScreen
      endpoint={endpoint}
      errorMessage={errorMessage}
      isCreating={isCreating}
      isLoading={isLoading}
      isLoggingOut={isLoggingOut}
      isRefreshing={isRefreshing}
      onCreateSession={handleCreateSession}
      onEditEndpoint={onEditEndpoint}
      onLogout={onLogout}
      onRefresh={() => fetchSessions("refresh")}
      onSelectSession={handleSelectSession}
      sessions={sortedSessions}
      theme={theme}
      user={user}
    />
  );
}

function selectDefaultModel(models: ModelItem[]) {
  return models.find((model) => model.accessDecision !== "deny" && model.modelType !== "embedding") ?? null;
}

function sortSessions(sessions: ChatSession[]) {
  return [...sessions].sort((a, b) => {
    const pinnedA = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
    const pinnedB = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
    if (pinnedA !== pinnedB) {
      return pinnedB - pinnedA;
    }

    const timeA = new Date(a.createdAt).getTime() || 0;
    const timeB = new Date(b.createdAt).getTime() || 0;
    return timeB - timeA;
  });
}
