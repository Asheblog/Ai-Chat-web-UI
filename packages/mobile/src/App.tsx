import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import type { AuthSession } from "./auth-types";
import { ServerManagerSheet } from "./components/sheets/ServerManagerSheet";
import { Button } from "./components/ui/UiPrimitives";
import { MobileApiClient } from "./mobile-api-client";
import { setHapticsEnabled } from "./native/haptics";
import { AuthScreen } from "./screens/AuthScreen";
import { EndpointScreen } from "./screens/EndpointScreen";
import { WorkspaceScreen } from "./screens/WorkspaceScreen";
import { checkServerHealth, normalizeServerEndpoint } from "./server-endpoint";
import {
  isRestorePending,
  isSessionBoundToProfile,
  shouldClearLiveSession,
  shouldDiscardStoredToken,
  tokenForProfile,
  type AuthedSession,
  type ScopedToken,
} from "./storage/auth-session-state";
import {
  clearAuthToken,
  clearAuthTokenIfCurrent,
  loadAuthToken,
  saveAuthToken,
} from "./storage/auth-token-storage";
import {
  DEFAULT_MOBILE_PREFERENCES,
  loadMobilePreferences,
  saveMobilePreferences,
} from "./storage/preferences-storage";
import {
  loadServerProfilesState,
  removeServerProfile,
  saveServerProfilesState,
  upsertServerProfile,
} from "./storage/server-profiles";
import { ThemeProvider, useAppTheme } from "./theme/ThemeProvider";
import { spacing } from "./theme/tokens";
import type { BrandingInfo, MobilePreferences, ServerProfile } from "./types/mobile";

type SaveState = "idle" | "checking" | "saved";

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <MobileRoot />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function MobileRoot() {
  const { theme, setThemeMode, setSyncServerBrand, applyBranding } = useAppTheme();

  const [preferences, setPreferences] = useState<MobilePreferences>(DEFAULT_MOBILE_PREFERENCES);
  const preferencesRef = useRef<MobilePreferences>(DEFAULT_MOBILE_PREFERENCES);

  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const profilesRef = useRef<ServerProfile[]>([]);
  const [activeProfileId, setActiveProfileIdState] = useState<string | null>(null);
  const activeProfileIdRef = useRef<string | null>(null);

  const [isEditingEndpoint, setIsEditingEndpoint] = useState(true);
  const [isLoadingStored, setIsLoadingStored] = useState(true);

  const [endpointInput, setEndpointInput] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 登录会话与产生它的服务器绑定；token 与用户身份永远成套切换。
  const [session, setSession] = useState<AuthedSession | null>(null);
  const sessionRef = useRef<AuthedSession | null>(null);
  const tokenRef = useRef<ScopedToken | null>(null);
  const [restoredProfileId, setRestoredProfileId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreNonce, setRestoreNonce] = useState(0);

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [serverManagerOpen, setServerManagerOpen] = useState(false);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? null,
    [activeProfileId, profiles],
  );
  const activeEndpoint = activeProfile?.endpoint ?? null;

  const setActiveProfileId = useCallback((profileId: string | null) => {
    activeProfileIdRef.current = profileId;
    setActiveProfileIdState(profileId);
  }, []);

  const applySession = useCallback((next: AuthedSession | null) => {
    sessionRef.current = next;
    tokenRef.current = next ? { profileId: next.profileId, token: next.token } : null;
    setSession(next);
  }, []);

  const handleUnauthorized = useCallback(
    async (failedProfileId: string, failedToken: string) => {
      const liveSession = sessionRef.current;
      const liveToken =
        liveSession && liveSession.profileId === failedProfileId ? liveSession.token : null;

      // 只有“失败的那一份 token 仍是当前在线 token”时才退回登录页：
      // 旧服务器迟到的 401 不能顶下线其它服务器，同服务器重新登录后的新 token 也不能被清。
      if (
        shouldClearLiveSession(activeProfileIdRef.current, failedProfileId) &&
        liveToken === failedToken
      ) {
        applySession(null);
      }

      // 同理，只能删掉“失败的那一份”已保存凭证；槽位里若已是新 token 必须保留。
      // 读-比较-删在存储层的同一队列内完成，避免与并发登录保存交错（TOCTOU）。
      await clearAuthTokenIfCurrent(failedProfileId, failedToken).catch(() => undefined);
    },
    [applySession],
  );

  // 依赖只取字符串：profiles 刷新（品牌色、最近连接时间）不能重建客户端，
  // 否则恢复流程自己触发的 profiles 更新会让恢复 effect 反复重跑。
  const apiClient = useMemo(() => {
    if (!activeEndpoint || !activeProfileId) {
      return null;
    }
    const profileId = activeProfileId;
    return new MobileApiClient({
      endpoint: activeEndpoint,
      // 作用域 token：旧客户端（切站前创建、仍有残余异步调用）拿不到新服务器的 token。
      getToken: () => tokenForProfile(tokenRef.current, profileId),
      onUnauthorized: (failedToken) => handleUnauthorized(profileId, failedToken),
    });
  }, [activeEndpoint, activeProfileId, handleUnauthorized]);

  const saveProfiles = useCallback(async (next: ServerProfile[], activeId: string | null) => {
    // 先落盘再提交内存状态：写入失败时界面与存储保持一致，不会出现“看着已切换、重启又回去”。
    await saveServerProfilesState(next, activeId);
    profilesRef.current = next;
    setProfiles(next);
  }, []);

  const refreshProfileBranding = useCallback(async (endpoint: string, branding: BrandingInfo) => {
    const { profiles: next } = upsertServerProfile(profilesRef.current, { endpoint, branding });
    await saveServerProfilesState(next, activeProfileIdRef.current).catch(() => undefined);
    profilesRef.current = next;
    setProfiles(next);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      try {
        const [prefs, profileState] = await Promise.all([
          loadMobilePreferences(),
          loadServerProfilesState(),
        ]);
        if (!mounted) return;

        preferencesRef.current = prefs;
        setPreferences(prefs);
        setThemeMode(prefs.themeMode);
        setSyncServerBrand(prefs.syncServerBrand);
        setHapticsEnabled(prefs.hapticsEnabled);

        profilesRef.current = profileState.profiles;
        setProfiles(profileState.profiles);
        setActiveProfileId(profileState.activeProfileId);

        const active = profileState.profiles.find(
          (p) => p.id === profileState.activeProfileId,
        );
        if (active) {
          setEndpointInput(active.endpoint);
          setIsEditingEndpoint(false);
          applyBranding(active.brandTheme ?? null);
        }
      } catch {
        if (mounted) {
          setErrorMessage("读取本地配置失败，请重新输入服务端地址。");
        }
      } finally {
        if (mounted) {
          setIsLoadingStored(false);
        }
      }
    }
    void bootstrap();
    return () => {
      mounted = false;
    };
  }, [applyBranding, setActiveProfileId, setSyncServerBrand, setThemeMode]);

  useEffect(() => {
    let cancelled = false;

    if (!apiClient || !activeProfileId || !activeEndpoint || isEditingEndpoint) {
      return () => {
        cancelled = true;
      };
    }

    const profileId = activeProfileId;
    const endpoint = activeEndpoint;
    const client = apiClient;

    // 切站时先解除旧服务器的身份绑定，再向新服务器发任何请求；
    // 同一服务器的重新校验（例如取消“添加服务器”）保留在线会话。
    if (!isSessionBoundToProfile(sessionRef.current, profileId)) {
      applySession(null);
    }
    setRestoreError(null);

    async function restoreSession() {
      try {
        const [tokenResult, brandingResult] = await Promise.allSettled([
          loadAuthToken(profileId, endpoint),
          client.getBranding(),
        ]);
        if (cancelled) return;

        if (brandingResult.status === "fulfilled") {
          applyBranding(brandingResult.value);
          await refreshProfileBranding(endpoint, brandingResult.value);
          if (cancelled) return;
        }

        const token = tokenResult.status === "fulfilled" ? tokenResult.value : null;
        if (!token) return;

        // 恢复期间先用“作用域明确”的暂存 token 请求 /api/auth/me，
        // 只有该 profile 的客户端能读到它。
        tokenRef.current = { profileId, token };
        const user = await client.getCurrentUser();
        if (cancelled) return;
        applySession({ profileId, token, user });
      } catch (error) {
        if (cancelled) return;
        if (shouldDiscardStoredToken(error)) {
          // 401 已由 onUnauthorized 按“失败的是哪一份 token”处理（含按需删除存储）；
          // 这里不再无条件删除，避免同服务器重新登录后的新 token 被迟到的旧 401 清掉。
          return;
        }
        // 离线、超时或服务端 5xx：保留已保存凭证，交给用户重试而不是逼人重登。
        setRestoreError("暂时无法连接服务器验证登录状态，请检查网络后重试。");
      } finally {
        if (!cancelled) {
          setRestoredProfileId(profileId);
        }
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [
    activeEndpoint,
    activeProfileId,
    apiClient,
    applyBranding,
    applySession,
    isEditingEndpoint,
    refreshProfileBranding,
    restoreNonce,
  ]);

  const handleUpdatePreferences = useCallback(
    (patch: Partial<MobilePreferences>) => {
      const next = { ...preferencesRef.current, ...patch };
      preferencesRef.current = next;
      setPreferences(next);
      if (patch.hapticsEnabled !== undefined) {
        setHapticsEnabled(patch.hapticsEnabled);
      }
      // 偏好是主题的唯一来源：设置页改了模式或品牌同步开关，主题必须当场跟随。
      if (patch.themeMode !== undefined) {
        setThemeMode(patch.themeMode);
      }
      if (patch.syncServerBrand !== undefined) {
        setSyncServerBrand(patch.syncServerBrand);
      }
      void saveMobilePreferences(next).catch(() => undefined);
    },
    [setSyncServerBrand, setThemeMode],
  );

  const normalizedPreview = useMemo(
    () => normalizeServerEndpoint(endpointInput),
    [endpointInput],
  );
  const canSubmit = saveState !== "checking" && endpointInput.trim().length > 0;

  const handleSaveEndpoint = useCallback(async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    const validation = normalizeServerEndpoint(endpointInput);
    if (!validation.ok) {
      setErrorMessage(validation.message);
      return;
    }

    setSaveState("checking");
    const health = await checkServerHealth(validation.endpoint);
    if (!health.ok) {
      setSaveState("idle");
      setErrorMessage(health.message);
      return;
    }

    try {
      const tempClient = new MobileApiClient({ endpoint: health.endpoint });
      const branding = await tempClient.getBranding().catch(() => null);
      const { profiles: nextProfiles, profile } = upsertServerProfile(profilesRef.current, {
        endpoint: health.endpoint,
        branding,
      });
      await saveProfiles(nextProfiles, profile.id);

      if (profile.id !== activeProfileIdRef.current) {
        applySession(null);
        setRestoreError(null);
      }
      applyBranding(branding ?? profile.brandTheme ?? null);
      setActiveProfileId(profile.id);
      setEndpointInput(profile.endpoint);
      setIsEditingEndpoint(false);
      setSaveState("saved");
      setSuccessMessage("连接检测通过，服务端配置已保存。");
    } catch {
      setSaveState("idle");
      setErrorMessage("服务端可达，但保存到本地失败，请重试。");
    }
  }, [applyBranding, applySession, endpointInput, saveProfiles, setActiveProfileId]);

  const handleSelectProfile = useCallback(
    async (profile: ServerProfile) => {
      const switching = profile.id !== activeProfileIdRef.current;
      try {
        await saveProfiles(profilesRef.current, profile.id);
      } catch {
        setErrorMessage("切换服务器失败：无法写入本地配置，请重试。");
        return;
      }

      if (switching) {
        applySession(null);
        setRestoreError(null);
        applyBranding(profile.brandTheme ?? null);
      }
      setActiveProfileId(profile.id);
      setEndpointInput(profile.endpoint);
      setIsEditingEndpoint(false);
      setErrorMessage(null);
      setSuccessMessage(null);
    },
    [applyBranding, applySession, saveProfiles, setActiveProfileId],
  );

  const handleRemoveProfile = useCallback(
    async (profileId: string) => {
      const activeId = activeProfileIdRef.current;
      const removingActive = profileId === activeId;
      const next = removeServerProfile(profilesRef.current, profileId, activeId);

      if (removingActive) {
        applySession(null);
        setRestoreError(null);
        const nextActive = next.profiles.find((p) => p.id === next.activeProfileId) ?? null;
        applyBranding(nextActive?.brandTheme ?? null);
      }

      profilesRef.current = next.profiles;
      setProfiles(next.profiles);
      setActiveProfileId(next.activeProfileId);
      if (!next.activeProfileId) {
        setIsEditingEndpoint(true);
        setEndpointInput("");
      }
      setErrorMessage(null);
      setSuccessMessage(null);

      await clearAuthToken(profileId).catch(() => undefined);
      try {
        await saveServerProfilesState(next.profiles, next.activeProfileId);
      } catch {
        setErrorMessage("服务器已移除，但本地配置写入失败，请重启后确认。");
      }
    },
    [applyBranding, applySession, setActiveProfileId],
  );

  const handleAuthenticated = useCallback(
    async (authSession: AuthSession) => {
      if (!activeProfileId) return;
      const profileId = activeProfileId;

      // 登录结果归属到发起登录的那台服务器；即使用户中途切走，也把凭证存回它自己的槽位。
      await saveAuthToken(authSession.token, profileId).catch(() => undefined);
      if (activeProfileIdRef.current !== profileId) return;

      applySession({ profileId, token: authSession.token, user: authSession.user });
      setRestoredProfileId(profileId);
      setRestoreError(null);
      setErrorMessage(null);
      setSuccessMessage(null);
    },
    [activeProfileId, applySession],
  );

  const handleLogout = useCallback(async () => {
    const profileId = activeProfileIdRef.current;
    setIsLoggingOut(true);
    try {
      if (apiClient) {
        await apiClient.logout();
      }
    } catch {
      // 本地清理优先：服务端登出失败不阻塞用户退出。
    } finally {
      if (profileId) {
        await clearAuthToken(profileId).catch(() => undefined);
      }
      applySession(null);
      setRestoreError(null);
      setIsLoggingOut(false);
    }
  }, [apiClient, applySession]);

  const sessionBound = isSessionBoundToProfile(session, activeProfileId);
  const restorePending =
    !isEditingEndpoint &&
    Boolean(activeProfile && apiClient) &&
    !sessionBound &&
    !restoreError &&
    isRestorePending(restoredProfileId, activeProfileId);

  const content = (() => {
    if (isLoadingStored) {
      return <LoadingView message="正在初始化 AIChat Mobile…" />;
    }

    if (restorePending) {
      return <LoadingView message="正在验证服务端与登录状态…" />;
    }

    if (!isEditingEndpoint && activeProfile && apiClient && sessionBound && session) {
      return (
        <WorkspaceScreen
          activeServer={activeProfile}
          apiClient={apiClient}
          isLoggingOut={isLoggingOut}
          onLogout={() => void handleLogout()}
          onOpenServers={() => setServerManagerOpen(true)}
          onUpdatePreferences={handleUpdatePreferences}
          preferences={preferences}
          user={session.user}
        />
      );
    }

    if (!isEditingEndpoint && activeProfile && apiClient) {
      if (restoreError) {
        return (
          <RestoreFailureView
            message={restoreError}
            onEditServer={() => {
              setEndpointInput(activeProfile.endpoint);
              setIsEditingEndpoint(true);
              setRestoreError(null);
            }}
            onRelogin={() => {
              const profileId = activeProfileIdRef.current;
              if (profileId) {
                void clearAuthToken(profileId).catch(() => undefined);
              }
              applySession(null);
              setRestoreError(null);
              setRestoredProfileId(profileId);
            }}
            onRetry={() => {
              setRestoreError(null);
              setRestoredProfileId(null);
              setRestoreNonce((value) => value + 1);
            }}
          />
        );
      }

      return (
        <AuthScreen
          apiClient={apiClient}
          endpoint={activeProfile.endpoint}
          onAuthenticated={handleAuthenticated}
          onEditEndpoint={() => {
            setEndpointInput(activeProfile.endpoint);
            setIsEditingEndpoint(true);
            setErrorMessage(null);
            setSuccessMessage(null);
          }}
          serverName={activeProfile.name}
          theme={theme}
        />
      );
    }

    return (
      <EndpointScreen
        activeProfileId={activeProfileId}
        canSubmit={canSubmit}
        endpointInput={endpointInput}
        errorMessage={errorMessage}
        isLoadingStored={isLoadingStored}
        normalizedPreview={normalizedPreview}
        onCancelEdit={
          activeProfile ? () => setIsEditingEndpoint(false) : undefined
        }
        onEndpointChange={(val) => {
          setEndpointInput(val);
          setErrorMessage(null);
          setSuccessMessage(null);
          setSaveState("idle");
        }}
        onRemoveProfile={(id) => void handleRemoveProfile(id)}
        onSaveEndpoint={() => void handleSaveEndpoint()}
        onSelectProfile={(p) => void handleSelectProfile(p)}
        saveState={saveState}
        savedProfiles={profiles}
        successMessage={successMessage}
        theme={theme}
      />
    );
  })();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <StatusBar style={theme.statusBarStyle} />
      {content}
      <ServerManagerSheet
        activeProfileId={activeProfileId}
        onAddNewServer={() => {
          setEndpointInput("");
          setSaveState("idle");
          setErrorMessage(null);
          setSuccessMessage(null);
          setIsEditingEndpoint(true);
        }}
        onClose={() => setServerManagerOpen(false)}
        onRemoveProfile={(id) => void handleRemoveProfile(id)}
        onSelectProfile={(p) => void handleSelectProfile(p)}
        profiles={profiles}
        theme={theme}
        visible={serverManagerOpen}
      />
    </SafeAreaView>
  );
}

function LoadingView({ message }: { message: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.centeredScreen}>
      <ActivityIndicator color={theme.primary} size="large" />
      <Text style={[styles.bodyText, { color: theme.mutedForeground }]}>{message}</Text>
    </View>
  );
}

function RestoreFailureView({
  message,
  onRetry,
  onEditServer,
  onRelogin,
}: {
  message: string;
  onRetry: () => void;
  onEditServer: () => void;
  onRelogin: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.centeredScreen}>
      <Text style={[styles.failureTitle, { color: theme.foreground }]}>无法验证登录状态</Text>
      <Text style={[styles.bodyText, { color: theme.mutedForeground }]}>{message}</Text>
      <View style={styles.failureActions}>
        <Button icon="refresh" label="重试" onPress={onRetry} theme={theme} />
        <Button
          icon="server-network"
          label="更换服务器"
          onPress={onEditServer}
          theme={theme}
          variant="secondary"
        />
        <Button
          icon="account-key-outline"
          label="重新登录"
          onPress={onRelogin}
          theme={theme}
          variant="ghost"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  centeredScreen: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
    rowGap: spacing.md,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  failureTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  failureActions: {
    alignSelf: "stretch",
    marginTop: spacing.sm,
    rowGap: spacing.sm,
  },
});
