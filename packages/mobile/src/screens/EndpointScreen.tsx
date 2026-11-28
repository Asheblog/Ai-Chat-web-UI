import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Badge, Button, SurfaceCard } from "../components/ui/UiPrimitives";
import { lightTap } from "../native/haptics";
import type { EndpointValidationResult } from "../server-endpoint";
import type { AppTheme } from "../theme/tokens";
import { radii, spacing } from "../theme/tokens";
import type { ServerProfile } from "../types/mobile";

type SaveState = "idle" | "checking" | "saved";

type EndpointScreenProps = {
  theme: AppTheme;
  endpointInput: string;
  normalizedPreview: EndpointValidationResult;
  canSubmit: boolean;
  saveState: SaveState;
  savedProfiles: ServerProfile[];
  activeProfileId: string | null;
  isLoadingStored: boolean;
  errorMessage: string | null;
  successMessage: string | null;
  onEndpointChange: (value: string) => void;
  onSaveEndpoint: () => void;
  onSelectProfile: (profile: ServerProfile) => void;
  onRemoveProfile: (profileId: string) => void;
  onCancelEdit?: () => void;
};

export function EndpointScreen({
  theme,
  endpointInput,
  normalizedPreview,
  canSubmit,
  saveState,
  savedProfiles,
  activeProfileId,
  isLoadingStored,
  errorMessage,
  successMessage,
  onEndpointChange,
  onSaveEndpoint,
  onSelectProfile,
  onRemoveProfile,
  onCancelEdit,
}: EndpointScreenProps) {
  const [showTips, setShowTips] = useState(false);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.flex, { backgroundColor: theme.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.brandRow}>
            <View style={[styles.brandPill, { backgroundColor: theme.primarySurface }]}>
              <MaterialCommunityIcons color={theme.signalText} name="star-four-points" size={16} />
              <Text style={[styles.brandPillText, { color: theme.signalText }]}>
                AIChat Mobile
              </Text>
            </View>
            {onCancelEdit ? (
              <Pressable hitSlop={8} onPress={onCancelEdit}>
                <Text style={[styles.cancelText, { color: theme.signalText }]}>返回</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={[styles.title, { color: theme.foreground }]}>
            连接你的 AIChat 服务端
          </Text>
          <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>
            支持局域网自托管 HTTP、公网 HTTPS 以及多服务器快速切换，跨端数据与 Web 端实时同步。
          </Text>
        </View>

        <SurfaceCard theme={theme}>
          <View style={styles.form}>
            <Text style={[styles.label, { color: theme.mutedForeground }]}>
              服务端根地址
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={onEndpointChange}
              placeholder="例如 http://192.168.1.20:3001 或 https://chat.example.com"
              placeholderTextColor={theme.tertiaryForeground}
              returnKeyType="done"
              style={[
                styles.input,
                {
                  backgroundColor: theme.background,
                  borderColor: errorMessage ? theme.danger : theme.borderStrong,
                  color: theme.foreground,
                },
              ]}
              value={endpointInput}
            />

            {endpointInput.trim().length > 0 ? (
              <Text
                style={[
                  styles.previewText,
                  {
                    color: normalizedPreview.ok
                      ? theme.tertiaryForeground
                      : theme.warning,
                  },
                ]}
              >
                {normalizedPreview.ok
                  ? `将连接：${normalizedPreview.endpoint}`
                  : normalizedPreview.message}
              </Text>
            ) : null}

            {errorMessage ? (
              <View
                style={[
                  styles.notice,
                  { backgroundColor: theme.dangerSurface, borderColor: theme.danger },
                ]}
              >
                <Text style={[styles.noticeText, { color: theme.danger }]}>
                  {errorMessage}
                </Text>
              </View>
            ) : null}

            {successMessage ? (
              <View
                style={[
                  styles.notice,
                  { backgroundColor: theme.successSurface, borderColor: theme.success },
                ]}
              >
                <Text style={[styles.noticeText, { color: theme.success }]}>
                  {successMessage}
                </Text>
              </View>
            ) : null}

            <Button
              disabled={!canSubmit || isLoadingStored}
              icon="lan-connect"
              label={saveState === "checking" ? "正在检测服务端健康…" : "检测并连接服务端"}
              loading={saveState === "checking"}
              onPress={() => {
                void lightTap();
                onSaveEndpoint();
              }}
              theme={theme}
            />
          </View>
        </SurfaceCard>

        {savedProfiles.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>
              已保存的服务器 ({savedProfiles.length})
            </Text>
            {savedProfiles.map((profile) => {
              const active = profile.id === activeProfileId;
              return (
                <Pressable
                  key={profile.id}
                  onPress={() => {
                    void lightTap();
                    onSelectProfile(profile);
                  }}
                  style={[
                    styles.profileCard,
                    {
                      backgroundColor: active ? theme.primarySurface : theme.surface,
                      borderColor: active ? theme.primary : theme.border,
                    },
                  ]}
                >
                  <View style={styles.profileMain}>
                    <View style={styles.profileTitleRow}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.profileName,
                          { color: active ? theme.signalText : theme.foreground },
                        ]}
                      >
                        {profile.name}
                      </Text>
                      {active ? <Badge label="当前" theme={theme} tone="signal" /> : null}
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[styles.profileUrl, { color: theme.tertiaryForeground }]}
                    >
                      {profile.endpoint}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityLabel={`移除服务器 ${profile.name}`}
                    hitSlop={8}
                    onPress={() => onRemoveProfile(profile.id)}
                  >
                    <MaterialCommunityIcons
                      color={theme.tertiaryForeground}
                      name="trash-can-outline"
                      size={18}
                    />
                  </Pressable>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <Pressable
          onPress={() => setShowTips((v) => !v)}
          style={[styles.tipsToggle, { borderColor: theme.border, backgroundColor: theme.surface }]}
        >
          <View style={styles.tipsHeader}>
            <MaterialCommunityIcons color={theme.signalText} name="help-circle-outline" size={18} />
            <Text style={[styles.tipsTitle, { color: theme.foreground }]}>
              局域网连接与排查提示
            </Text>
            <MaterialCommunityIcons
              color={theme.tertiaryForeground}
              name={showTips ? "chevron-up" : "chevron-down"}
              size={18}
            />
          </View>
          {showTips ? (
            <Text style={[styles.tipsBody, { color: theme.mutedForeground }]}>
              1. 请填写后端 API 所在地址与端口（默认如 `:3001`），不要把真机里的 localhost 当作电脑地址。{"\n"}
              2. Android / iOS 均已放开局域网明文 HTTP 限制，同一 Wi-Fi 下可直接填电脑局域网 IP。{"\n"}
              3. 若使用 USB 调试 Android，可执行 `adb reverse tcp:3001 tcp:3001` 后填写 `http://127.0.0.1:3001`。
            </Text>
          ) : null}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    padding: spacing.lg,
    rowGap: spacing.lg,
  },
  hero: {
    paddingTop: spacing.sm,
    rowGap: 10,
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  brandPill: {
    alignItems: "center",
    borderRadius: radii.pill,
    columnGap: 6,
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  brandPillText: {
    fontSize: 13,
    fontWeight: "700",
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "600",
  },
  title: {
    fontSize: 25,
    fontWeight: "800",
    lineHeight: 33,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 21,
  },
  form: {
    rowGap: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
  input: {
    borderRadius: radii.md,
    borderWidth: 1,
    fontFamily: "monospace",
    fontSize: 14,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  previewText: {
    fontSize: 12,
  },
  notice: {
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 19,
  },
  section: {
    rowGap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  profileCard: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    columnGap: 12,
    flexDirection: "row",
    padding: 14,
  },
  profileMain: {
    flex: 1,
    rowGap: 3,
  },
  profileTitleRow: {
    alignItems: "center",
    columnGap: 8,
    flexDirection: "row",
  },
  profileName: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "700",
  },
  profileUrl: {
    fontFamily: "monospace",
    fontSize: 12,
  },
  tipsToggle: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    rowGap: 10,
  },
  tipsHeader: {
    alignItems: "center",
    columnGap: 8,
    flexDirection: "row",
  },
  tipsTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  tipsBody: {
    fontSize: 12,
    lineHeight: 19,
  },
});
