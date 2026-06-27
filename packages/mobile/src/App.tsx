import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, useColorScheme, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { clearAuthToken, loadAuthToken, saveAuthToken } from "./auth-token-storage";
import type { AuthSession, MobileUser } from "./auth-types";
import { MobileApiClient } from "./mobile-api-client";
import { AuthScreen } from "./screens/AuthScreen";
import { EndpointScreen } from "./screens/EndpointScreen";
import { SignedInScreen } from "./screens/SignedInScreen";
import { checkServerHealth, normalizeServerEndpoint } from "./server-endpoint";
import { loadServerEndpoint, saveServerEndpoint } from "./server-endpoint-storage";
import { createTheme, spacing } from "./theme";

type SaveState = "idle" | "checking" | "saved";
type AuthRestoreState = "idle" | "restoring";

export default function App() {
  const colorScheme = useColorScheme();
  const theme = useMemo(() => createTheme(colorScheme), [colorScheme]);
  const [endpointInput, setEndpointInput] = useState("");
  const [savedEndpoint, setSavedEndpoint] = useState<string | null>(null);
  const [isEditingEndpoint, setIsEditingEndpoint] = useState(true);
  const [isLoadingStoredEndpoint, setIsLoadingStoredEndpoint] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [authRestoreState, setAuthRestoreState] = useState<AuthRestoreState>("idle");
  const [authToken, setAuthToken] = useState<string | null>(null);
  const authTokenRef = useRef<string | null>(null);
  const [currentUser, setCurrentUser] = useState<MobileUser | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const clearAuthState = useCallback(async () => {
    authTokenRef.current = null;
    setAuthToken(null);
    setCurrentUser(null);
    await clearAuthToken();
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function restoreEndpoint() {
      try {
        const storedEndpoint = await loadServerEndpoint();

        if (!isMounted) {
          return;
        }

        if (storedEndpoint) {
          setEndpointInput(storedEndpoint);
          setSavedEndpoint(storedEndpoint);
          setIsEditingEndpoint(false);
          setSuccessMessage("已恢复上次保存的服务端地址。");
        }
      } catch {
        if (isMounted) {
          setErrorMessage("读取本地服务端地址失败，请重新保存。");
        }
      } finally {
        if (isMounted) {
          setIsLoadingStoredEndpoint(false);
        }
      }
    }

    restoreEndpoint();

    return () => {
      isMounted = false;
    };
  }, []);

  const apiClient = useMemo(() => {
    if (!savedEndpoint) {
      return null;
    }

    return new MobileApiClient({
      endpoint: savedEndpoint,
      getToken: () => authTokenRef.current,
      onUnauthorized: clearAuthState,
    });
  }, [clearAuthState, savedEndpoint]);

  useEffect(() => {
    let isMounted = true;

    async function restoreAuth() {
      if (!apiClient || isEditingEndpoint) {
        return;
      }

      setAuthRestoreState("restoring");
      try {
        const storedToken = await loadAuthToken();
        if (!storedToken) {
          return;
        }

        authTokenRef.current = storedToken;
        if (isMounted) {
          setAuthToken(storedToken);
        }

        const user = await apiClient.getCurrentUser();
        if (isMounted) {
          setCurrentUser(user);
          setSuccessMessage("已恢复登录状态。");
        }
      } catch {
        await clearAuthState();
        if (isMounted) {
          setErrorMessage("登录状态已失效，请重新登录。");
        }
      } finally {
        if (isMounted) {
          setAuthRestoreState("idle");
        }
      }
    }

    restoreAuth();

    return () => {
      isMounted = false;
    };
  }, [apiClient, clearAuthState, isEditingEndpoint]);

  const normalizedPreview = useMemo(() => normalizeServerEndpoint(endpointInput), [endpointInput]);
  const canSubmit = saveState !== "checking" && endpointInput.trim().length > 0;
  const hasSavedEndpoint = savedEndpoint !== null && !isEditingEndpoint;

  const handleEndpointChange = useCallback((value: string) => {
    setEndpointInput(value);
    setErrorMessage(null);
    setSuccessMessage(null);
    setSaveState("idle");
  }, []);

  const handleUseSavedEndpoint = useCallback(() => {
    if (!savedEndpoint) {
      return;
    }

    setEndpointInput(savedEndpoint);
    setIsEditingEndpoint(false);
    setErrorMessage(null);
    setSuccessMessage("继续使用已保存的服务端地址。");
    setSaveState("saved");
  }, [savedEndpoint]);

  const handleEditEndpoint = useCallback(() => {
    setIsEditingEndpoint(true);
    setCurrentUser(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    setSaveState("idle");
  }, []);

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
      const endpointChanged = savedEndpoint !== null && savedEndpoint !== health.endpoint;
      await saveServerEndpoint(health.endpoint);
      if (endpointChanged) {
        await clearAuthState();
      }
      setEndpointInput(health.endpoint);
      setSavedEndpoint(health.endpoint);
      setIsEditingEndpoint(false);
      setSaveState("saved");
      setSuccessMessage(
        endpointChanged
          ? "服务端地址已更新，请重新登录。"
          : "连接检测通过，服务端地址已保存。",
      );
    } catch {
      setSaveState("idle");
      setErrorMessage("服务端可达，但保存到本地失败，请重试。");
    }
  }, [clearAuthState, endpointInput, savedEndpoint]);

  const handleAuthenticated = useCallback(async (session: AuthSession) => {
    await saveAuthToken(session.token);
    authTokenRef.current = session.token;
    setAuthToken(session.token);
    setCurrentUser(session.user);
    setErrorMessage(null);
    setSuccessMessage("登录成功。");
  }, []);

  const handleLogout = useCallback(async () => {
    if (!apiClient) {
      await clearAuthState();
      return;
    }

    setIsLoggingOut(true);
    try {
      await apiClient.logout();
    } catch {
      // 本地清理优先，服务端登出失败不阻塞用户退出。
    } finally {
      await clearAuthState();
      setIsLoggingOut(false);
      setSuccessMessage("已退出登录。");
    }
  }, [apiClient, clearAuthState]);

  const content = (() => {
    if (hasSavedEndpoint && apiClient && authRestoreState === "restoring") {
      return <LoadingScreen message="正在恢复登录状态" theme={theme} />;
    }

    if (hasSavedEndpoint && apiClient && currentUser && authToken) {
      return (
        <SignedInScreen
          apiClient={apiClient}
          endpoint={savedEndpoint}
          isLoggingOut={isLoggingOut}
          onEditEndpoint={handleEditEndpoint}
          onLogout={handleLogout}
          theme={theme}
          user={currentUser}
        />
      );
    }

    if (hasSavedEndpoint && apiClient) {
      return (
        <AuthScreen
          apiClient={apiClient}
          endpoint={savedEndpoint}
          onAuthenticated={handleAuthenticated}
          onEditEndpoint={handleEditEndpoint}
          theme={theme}
        />
      );
    }

    return (
      <EndpointScreen
        canSubmit={canSubmit}
        endpointInput={endpointInput}
        errorMessage={errorMessage}
        hasSavedEndpoint={hasSavedEndpoint}
        isLoadingStoredEndpoint={isLoadingStoredEndpoint}
        normalizedPreview={normalizedPreview}
        onEndpointChange={handleEndpointChange}
        onEditEndpoint={handleEditEndpoint}
        onSaveEndpoint={handleSaveEndpoint}
        onUseSavedEndpoint={handleUseSavedEndpoint}
        saveState={saveState}
        savedEndpoint={savedEndpoint}
        successMessage={successMessage}
        theme={theme}
      />
    );
  })();

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <StatusBar style={theme.statusBarStyle} />
        {content}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function LoadingScreen({ message, theme }: { message: string; theme: ReturnType<typeof createTheme> }) {
  return (
    <View style={styles.loadingScreen} accessibilityRole="progressbar">
      <ActivityIndicator color={theme.primary} />
      <Text style={[styles.panelBody, { color: theme.mutedForeground }]}>{message}</Text>
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
  panelBody: {
    fontSize: 16,
    lineHeight: 24,
  },
});
