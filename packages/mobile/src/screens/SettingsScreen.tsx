import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Constants from "expo-constants";

import type { MobileUser } from "../auth-types";
import {
  Button,
  IconButton,
  SegmentedControl,
  SurfaceCard,
  SwitchRow,
} from "../components/ui/UiPrimitives";
import type { MobileApiClient } from "../mobile-api-client";
import { lightTap, successTap } from "../native/haptics";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing } from "../theme/tokens";
import type { AppInfo, MobilePreferences, ServerProfile } from "../types/mobile";

export type PersonalSettingsStatus = "loading" | "ready" | "error";

export type PersonalSettingsState = {
  /** 每次读取尝试递增的作用域；切换服务器或重试后，旧请求的结果会被丢弃。 */
  scope: number;
  status: PersonalSettingsStatus;
  prompt: string;
  contextEnabled: boolean;
  error: string | null;
  feedback: string | null;
  saving: boolean;
};

export type PersonalSettingsAction =
  | { type: "reload"; scope: number }
  | { type: "loaded"; scope: number; prompt: string; contextEnabled: boolean }
  | { type: "failed"; scope: number; message: string }
  | { type: "editPrompt"; value: string }
  | { type: "setContextEnabled"; value: boolean }
  | { type: "saveStarted"; scope: number }
  | { type: "saveSucceeded"; scope: number; message: string }
  | { type: "saveFailed"; scope: number; message: string };

export const initialPersonalSettingsState: PersonalSettingsState = {
  scope: 0,
  status: "loading",
  prompt: "",
  contextEnabled: true,
  error: null,
  feedback: null,
  saving: false,
};

/** 只有远程个人设置读取成功且当前没有保存请求时，才允许提交，避免用默认值覆盖服务端。 */
export function canSubmitPersonalSettings(state: PersonalSettingsState): boolean {
  return state.status === "ready" && !state.saving;
}

export function personalSettingsReducer(
  state: PersonalSettingsState,
  action: PersonalSettingsAction,
): PersonalSettingsState {
  switch (action.type) {
    case "reload":
      return {
        ...state,
        scope: action.scope,
        status: "loading",
        error: null,
        feedback: null,
        saving: false,
      };
    case "loaded":
      if (action.scope !== state.scope) return state;
      return {
        ...state,
        status: "ready",
        prompt: action.prompt,
        contextEnabled: action.contextEnabled,
        error: null,
        feedback: null,
      };
    case "failed":
      if (action.scope !== state.scope) return state;
      return { ...state, status: "error", error: action.message, saving: false };
    case "editPrompt":
      if (state.status !== "ready" || state.saving) return state;
      return { ...state, prompt: action.value, feedback: null };
    case "setContextEnabled":
      if (state.status !== "ready" || state.saving) return state;
      return { ...state, contextEnabled: action.value, feedback: null };
    case "saveStarted":
      if (action.scope !== state.scope || state.status !== "ready" || state.saving) {
        return state;
      }
      return { ...state, saving: true, error: null, feedback: null };
    case "saveSucceeded":
      if (action.scope !== state.scope) return state;
      return { ...state, saving: false, error: null, feedback: action.message };
    case "saveFailed":
      if (action.scope !== state.scope) return state;
      return { ...state, saving: false, error: action.message };
    default:
      return state;
  }
}

export function SettingsScreen({
  apiClient,
  user,
  activeServer,
  preferences,
  onUpdatePreferences,
  onOpenServers,
  onLogout,
  onBack,
  isLoggingOut,
}: {
  apiClient: MobileApiClient;
  user: MobileUser;
  activeServer: ServerProfile | null;
  preferences: MobilePreferences;
  onUpdatePreferences: (patch: Partial<MobilePreferences>) => void;
  onOpenServers: () => void;
  onLogout: () => void;
  onBack: () => void;
  isLoggingOut: boolean;
}) {
  const { theme, themeMode, setThemeMode, syncServerBrand, setSyncServerBrand } = useAppTheme();

  const [personal, dispatchPersonal] = useReducer(
    personalSettingsReducer,
    initialPersonalSettingsState,
  );
  const personalScopeRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  const loadPersonalSettings = useCallback(async () => {
    const scope = personalScopeRef.current + 1;
    personalScopeRef.current = scope;
    dispatchPersonal({ type: "reload", scope });
    try {
      const value = await apiClient.getPersonalSettings();
      dispatchPersonal({
        type: "loaded",
        scope,
        prompt: value.personal_prompt ?? "",
        contextEnabled: value.context_enabled ?? true,
      });
    } catch (error) {
      dispatchPersonal({
        type: "failed",
        scope,
        message: error instanceof Error ? error.message : "读取服务端个人设置失败。",
      });
    }
  }, [apiClient]);

  useEffect(() => {
    void loadPersonalSettings();
    return () => {
      // 切换服务器或卸载时作废仍在进行中的读取，避免旧响应落到新服务器。
      personalScopeRef.current += 1;
    };
  }, [loadPersonalSettings]);

  useEffect(() => {
    let active = true;
    apiClient
      .getAppInfo()
      .then((info) => {
        if (active) setAppInfo(info);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [apiClient]);

  const handleSavePersonal = useCallback(async () => {
    if (!canSubmitPersonalSettings(personal) || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    const scope = personal.scope;
    dispatchPersonal({ type: "saveStarted", scope });
    try {
      await apiClient.updatePersonalSettings({
        personal_prompt: personal.prompt.trim() || null,
        context_enabled: personal.contextEnabled,
      });
      await successTap();
      dispatchPersonal({ type: "saveSucceeded", scope, message: "个人设置已同步到服务端。" });
    } catch (error) {
      dispatchPersonal({
        type: "saveFailed",
        scope,
        message: error instanceof Error ? error.message : "同步个人设置失败。",
      });
    } finally {
      saveInFlightRef.current = false;
    }
  }, [apiClient, personal]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: theme.surface, borderBottomColor: theme.border },
        ]}
      >
        <IconButton icon="arrow-left" label="返回" onPress={onBack} theme={theme} />
        <Text style={[styles.headerTitle, { color: theme.foreground }]}>设置与偏好</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>
            外观与 Ink & Mist 品牌主题
          </Text>
          <SegmentedControl
            onChange={(mode) => {
              void lightTap();
              setThemeMode(mode);
              onUpdatePreferences({ themeMode: mode });
            }}
            options={[
              { value: "system", label: "跟随系统" },
              { value: "light", label: "浅色" },
              { value: "dark", label: "深色" },
            ]}
            theme={theme}
            value={themeMode}
          />
          <SwitchRow
            onValueChange={(next) => {
              setSyncServerBrand(next);
              onUpdatePreferences({ syncServerBrand: next });
            }}
            subtitle="自动读取 /api/settings/branding 并同步主信号色"
            theme={theme}
            title="同步服务端品牌色"
            value={syncServerBrand}
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>
            服务端个人设置同步
          </Text>
          {personal.status === "loading" ? (
            <SurfaceCard theme={theme}>
              <View style={styles.promptWrap}>
                <ActivityIndicator color={theme.primary} />
                <Text style={[styles.statusText, { color: theme.tertiaryForeground }]}>
                  正在读取服务端个人设置…
                </Text>
              </View>
            </SurfaceCard>
          ) : personal.status === "error" ? (
            <SurfaceCard theme={theme}>
              <View style={styles.promptWrap}>
                <Text
                  accessibilityRole="alert"
                  style={[styles.promptLabel, { color: theme.danger }]}
                >
                  读取服务端个人设置失败
                </Text>
                <Text style={[styles.statusText, { color: theme.tertiaryForeground }]}>
                  {personal.error ?? "请检查网络与登录状态。"}
                </Text>
                <Text style={[styles.statusText, { color: theme.tertiaryForeground }]}>
                  为避免用默认值覆盖服务端设置，保存已禁用；重试成功后才可提交。
                </Text>
                <Button
                  icon="refresh"
                  label="重新读取"
                  onPress={() => void loadPersonalSettings()}
                  theme={theme}
                  variant="secondary"
                />
              </View>
            </SurfaceCard>
          ) : (
            <View style={styles.section}>
              <SwitchRow
                disabled={personal.saving}
                onValueChange={(next) =>
                  dispatchPersonal({ type: "setContextEnabled", value: next })
                }
                subtitle="允许对话携带个人上下文记忆"
                theme={theme}
                title="上下文记忆 (Context Enabled)"
                value={personal.contextEnabled}
              />
              <SurfaceCard theme={theme}>
                <View style={styles.promptWrap}>
                  <Text style={[styles.promptLabel, { color: theme.mutedForeground }]}>
                    个人默认提示词 (Personal Prompt)
                  </Text>
                  <TextInput
                    editable={!personal.saving}
                    multiline
                    onChangeText={(value) => dispatchPersonal({ type: "editPrompt", value })}
                    placeholder="输入你希望全局生效的个人偏好提示词…"
                    placeholderTextColor={theme.tertiaryForeground}
                    style={[
                      styles.promptInput,
                      {
                        backgroundColor: theme.background,
                        borderColor: theme.borderStrong,
                        color: theme.foreground,
                      },
                    ]}
                    value={personal.prompt}
                  />
                  <Button
                    disabled={!canSubmitPersonalSettings(personal)}
                    icon="cloud-upload-outline"
                    label="保存并同步到服务端"
                    loading={personal.saving}
                    onPress={() => void handleSavePersonal()}
                    theme={theme}
                    variant="soft"
                  />
                  {personal.feedback ? (
                    <Text style={[styles.statusText, { color: theme.signalText }]}>
                      {personal.feedback}
                    </Text>
                  ) : null}
                  {personal.error ? (
                    <Text
                      accessibilityRole="alert"
                      style={[styles.statusText, { color: theme.danger }]}
                    >
                      {personal.error}
                    </Text>
                  ) : null}
                </View>
              </SurfaceCard>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>
            原生交互与默认开关
          </Text>
          <SwitchRow
            onValueChange={(next) => onUpdatePreferences({ hapticsEnabled: next })}
            subtitle="发送、复制、长按和切换模型时提供轻震触感"
            theme={theme}
            title="触觉反馈 (Haptics)"
            value={preferences.hapticsEnabled}
          />
          <SwitchRow
            onValueChange={(next) => onUpdatePreferences({ defaultReasoningEnabled: next })}
            subtitle="新建对话时默认开启推理思维链"
            theme={theme}
            title="新对话默认深度思考"
            value={preferences.defaultReasoningEnabled}
          />
          <SwitchRow
            onValueChange={(next) => onUpdatePreferences({ defaultWebSearchEnabled: next })}
            subtitle="新建对话时默认启用内置联网搜索"
            theme={theme}
            title="新对话默认联网搜索"
            value={preferences.defaultWebSearchEnabled}
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>
            服务器与账号
          </Text>
          <SurfaceCard theme={theme}>
            <View style={styles.infoList}>
              <InfoRow label="当前账号" theme={theme} value={`${user.username} (${user.role})`} />
              <InfoRow
                label="当前服务器"
                theme={theme}
                value={activeServer?.name || activeServer?.endpoint || "-"}
              />
              <InfoRow
                label="服务端版本"
                theme={theme}
                value={typeof appInfo?.version === "string" ? appInfo.version : "已连接"}
              />
              <InfoRow
                label="客户端版本"
                theme={theme}
                value={Constants.expoConfig?.version ?? "1.0.0"}
              />
            </View>
          </SurfaceCard>
          <Button
            icon="server-network"
            label="管理或切换服务器"
            onPress={onOpenServers}
            theme={theme}
            variant="secondary"
          />
          <Button
            disabled={isLoggingOut}
            icon="logout"
            label="退出当前账号"
            loading={isLoggingOut}
            onPress={onLogout}
            theme={theme}
            variant="danger"
          />
        </View>
      </ScrollView>
    </View>
  );
}

function InfoRow({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: ReturnType<typeof useAppTheme>["theme"];
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: theme.tertiaryForeground }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.infoValue, { color: theme.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 54,
    paddingHorizontal: spacing.md,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  headerSpacer: {
    width: 36,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing["2xl"],
    rowGap: spacing.xl,
  },
  section: {
    rowGap: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  promptWrap: {
    rowGap: 10,
  },
  promptLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  promptInput: {
    borderRadius: radii.md,
    borderWidth: 1,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 92,
    padding: spacing.md,
    textAlignVertical: "top",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
  infoList: {
    rowGap: 10,
  },
  infoRow: {
    alignItems: "center",
    columnGap: 12,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  infoLabel: {
    fontSize: 13,
  },
  infoValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
  },
});
