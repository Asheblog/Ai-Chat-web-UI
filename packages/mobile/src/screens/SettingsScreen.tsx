import { useEffect, useState } from "react";
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

  const [personalPrompt, setPersonalPrompt] = useState("");
  const [contextEnabled, setContextEnabled] = useState(true);
  const [loadingPersonal, setLoadingPersonal] = useState(true);
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.allSettled([apiClient.getPersonalSettings(), apiClient.getAppInfo()]).then(
      ([personalRes, appInfoRes]) => {
        if (!active) return;
        if (personalRes.status === "fulfilled") {
          setPersonalPrompt(personalRes.value.personal_prompt ?? "");
          setContextEnabled(personalRes.value.context_enabled ?? true);
        }
        if (appInfoRes.status === "fulfilled") {
          setAppInfo(appInfoRes.value);
        }
        setLoadingPersonal(false);
      },
    );
    return () => {
      active = false;
    };
  }, [apiClient]);

  const handleSavePersonal = async () => {
    setSavingPersonal(true);
    setStatusMessage(null);
    try {
      await apiClient.updatePersonalSettings({
        personal_prompt: personalPrompt.trim() || null,
        context_enabled: contextEnabled,
      });
      await successTap();
      setStatusMessage("个人设置已同步到服务端。");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "同步个人设置失败。");
    } finally {
      setSavingPersonal(false);
    }
  };

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
          {loadingPersonal ? (
            <SurfaceCard theme={theme}>
              <ActivityIndicator color={theme.primary} />
            </SurfaceCard>
          ) : (
            <View style={styles.section}>
              <SwitchRow
                onValueChange={setContextEnabled}
                subtitle="允许对话携带个人上下文记忆"
                theme={theme}
                title="上下文记忆 (Context Enabled)"
                value={contextEnabled}
              />
              <SurfaceCard theme={theme}>
                <View style={styles.promptWrap}>
                  <Text style={[styles.promptLabel, { color: theme.mutedForeground }]}>
                    个人默认提示词 (Personal Prompt)
                  </Text>
                  <TextInput
                    multiline
                    onChangeText={setPersonalPrompt}
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
                    value={personalPrompt}
                  />
                  <Button
                    disabled={savingPersonal}
                    icon="cloud-upload-outline"
                    label="保存并同步到服务端"
                    loading={savingPersonal}
                    onPress={handleSavePersonal}
                    theme={theme}
                    variant="soft"
                  />
                  {statusMessage ? (
                    <Text style={[styles.statusText, { color: theme.signalText }]}>
                      {statusMessage}
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
