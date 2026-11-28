import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import type { AuthSession, MobileUser } from "./auth-types";
import { ServerManagerSheet } from "./components/sheets/ServerManagerSheet";
import { MobileApiClient } from "./mobile-api-client";
import { setHapticsEnabled } from "./native/haptics";
import { AuthScreen } from "./screens/AuthScreen";
import { EndpointScreen } from "./screens/EndpointScreen";
import { WorkspaceScreen } from "./screens/WorkspaceScreen";
import { checkServerHealth, normalizeServerEndpoint } from "./server-endpoint";
import { clearAuthToken, loadAuthToken, saveAuthToken } from "./storage/auth-token-storage";
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
import type { MobilePreferences, ServerProfile } from "./types/mobile";

type SaveState = "idle" | "checking" | "saved";
type AuthRestoreState = "idle" | "restoring";

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
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [isEditingEndpoint, setIsEditingEndpoint] = useState(true);
  const [isLoadingStored, setIsLoadingStored] = useState(true);

  const [endpointInput, setEndpointInput] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [authRestoreState, setAuthRestoreState] = useState<AuthRestoreState>("idle");
  const [authToken, setAuthToken] = useState<string | null>(null);
  const authTokenRef = useRef<string | null>(null);
  const [currentUser, setCurrentUser] = useState<MobileUser | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [serverManagerOpen, setServerManagerOpen] = useState(false);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? null,
    [activeProfileId, profiles],
  );

  const clearAuthState = useCallback(
    async (profileIdOverride?: string | null) => {
      const targetId = profileIdOverride !== undefined ? profileIdOverride : activeProfileId;
      authTokenRef.current = null;
      setAuthToken(null);
      setCurrentUser(null);
      await clearAuthToken(targetId);
    },
    [activeProfileId],
  );

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      try {
        const [prefs, profileState] = await Promise.all([
          loadMobilePreferences(),
          loadServerProfilesState(),
        ]);
        if (!mounted) return;

        setPreferences(prefs);
        setThemeMode(prefs.themeMode);
        setSyncServerBrand(prefs.syncServerBrand);
        setHapticsEnabled(prefs.hapticsEnabled);

        setProfiles(profileState.profiles);
        setActiveProfileId(profileState.activeProfileId);

        const active = profileState.profiles.find(
          (p) => p.id === profileState.activeProfileId,
        );
        if (active) {
          setEndpointInput(active.endpoint);
          setIsEditingEndpoint(false);
          if (active.brandTheme) {
            applyBranding(active.brandTheme);
          }
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
  }, [applyBranding, setSyncServerBrand, setThemeMode]);

  const apiClient = useMemo(() => {
    if (!activeProfile) return null;
    return new MobileApiClient({
      endpoint: activeProfile.endpoint,
      getToken: () => authTokenRef.current,
      onUnauthorized: () => clearAuthState(activeProfile.id),
    });
  }, [activeProfile, clearAuthState]);

  useEffect(() => {
    let mounted = true;
    async function restoreAuthAndBranding() {
      if (!apiClient || !activeProfile || isEditingEndpoint) {
        return;
      }

      setAuthRestoreState("restoring");
      authTokenRef.current = null;
      setAuthToken(null);
      setCurrentUser(null);

      try {
        const [storedToken, brandingRes] = await Promise.allSettled([
          loadAuthToken(activeProfile.id),
          apiClient.getBranding(),
        ]);

        if (!mounted) return;

        if (brandingRes.status === "fulfilled") {
          applyBranding(brandingRes.value);
          setProfiles((prev) => {
            const { profiles: next } = upsertServerProfile(prev, {
              endpoint: activeProfile.endpoint,
              name: activeProfile.name,
              branding: brandingRes.value,
            });
            void saveServerProfilesState(next, activeProfile.id);
            return next;
          });
        }

        const token = storedToken.status === "fulfilled" ? storedToken.value : null;
        if (!token) return;

        authTokenRef.current = token;
        setAuthToken(token);
        const user = await apiClient.getCurrentUser();
        if (mounted) {
          setCurrentUser(user);
        }
      } catch {
        await clearAuthState(activeProfile.id);
      } finally {
        if (mounted) {
          setAuthRestoreState("idle");
        }
      }
    }

    void restoreAuthAndBranding();
    return () => {
      mounted = false;
    };
  }, [activeProfile?.id, apiClient, applyBranding, clearAuthState, isEditingEndpoint]);

  const handleUpdatePreferences = useCallback((patch: Partial<MobilePreferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...patch };
      if (patch.hapticsEnabled !== undefined) {
        setHapticsEnabled(patch.hapticsEnabled);
      }
      void saveMobilePreferences(next);
      return next;
    });
  }, []);

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
      if (branding) {
        applyBranding(branding);
      }

      const { profiles: nextProfiles, profile } = upsertServerProfile(profiles, {
        endpoint: health.endpoint,
        branding,
      });
      await saveServerProfilesState(nextProfiles, profile.id);
      setProfiles(nextProfiles);
      setActiveProfileId(profile.id);
      setEndpointInput(profile.endpoint);
      setIsEditingEndpoint(false);
      setSaveState("saved");
      setSuccessMessage("连接检测通过，服务端配置已保存。");
    } catch {
      setSaveState("idle");
      setErrorMessage("服务端可达，但保存到本地失败，请重试。");
    }
  }, [applyBranding, endpointInput, profiles]);

  const handleSelectProfile = useCallback(
    async (profile: ServerProfile) => {
      await saveServerProfilesState(profiles, profile.id);
      setActiveProfileId(profile.id);
      setEndpointInput(profile.endpoint);
      setIsEditingEndpoint(false);
      setErrorMessage(null);
      setSuccessMessage(null);
      applyBranding(profile.brandTheme ?? null);
    },
    [applyBranding, profiles],
  );

  const handleRemoveProfile = useCallback(
    async (profileId: string) => {
      await clearAuthToken(profileId);
      const next = removeServerProfile(profiles, profileId, activeProfileId);
      await saveServerProfilesState(next.profiles, next.activeProfileId);
      setProfiles(next.profiles);
      setActiveProfileId(next.activeProfileId);
      if (!next.activeProfileId) {
        setIsEditingEndpoint(true);
        setEndpointInput("");
      }
    },
    [activeProfileId, profiles],
  );

  const handleAuthenticated = useCallback(
    async (session: AuthSession) => {
      if (!activeProfile) return;
      await saveAuthToken(session.token, activeProfile.id);
      authTokenRef.current = session.token;
      setAuthToken(session.token);
      setCurrentUser(session.user);
      setErrorMessage(null);
      setSuccessMessage(null);
    },
    [activeProfile],
  );

  const handleLogout = useCallback(async () => {
    if (!apiClient) {
      await clearAuthState();
      return;
    }
    setIsLoggingOut(true);
    try {
      await apiClient.logout();
    } catch {
    } finally {
      await clearAuthState();
      setIsLoggingOut(false);
    }
  }, [apiClient, clearAuthState]);

  const content = (() => {
    if (isLoadingStored) {
      return <LoadingView message="正在初始化 AIChat Mobile…" />;
    }

    if (!isEditingEndpoint && activeProfile && apiClient && authRestoreState === "restoring") {
      return <LoadingView message="正在验证服务端与登录状态…" />;
    }

    if (!isEditingEndpoint && activeProfile && apiClient && currentUser && authToken) {
      return (
        <WorkspaceScreen
          activeServer={activeProfile}
          apiClient={apiClient}
          isLoggingOut={isLoggingOut}
          onLogout={() => void handleLogout()}
          onOpenServers={() => setServerManagerOpen(true)}
          onUpdatePreferences={handleUpdatePreferences}
          preferences={preferences}
          user={currentUser}
        />
      );
    }

    if (!isEditingEndpoint && activeProfile && apiClient) {
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
    <View style={styles.loadingScreen}>
      <ActivityIndicator color={theme.primary} size="large" />
      <Text style={[styles.loadingText, { color: theme.mutedForeground }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loadingScreen: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
    rowGap: spacing.md,
  },
  loadingText: {
    fontSize: 14,
  },
});
