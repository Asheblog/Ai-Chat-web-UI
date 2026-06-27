import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { EndpointValidationResult } from "../server-endpoint";
import type { AppTheme } from "../theme";
import { spacing } from "../theme";

type SaveState = "idle" | "checking" | "saved";

type EndpointScreenProps = {
  canSubmit: boolean;
  endpointInput: string;
  errorMessage: string | null;
  hasSavedEndpoint: boolean;
  isLoadingStoredEndpoint: boolean;
  normalizedPreview: EndpointValidationResult;
  onEndpointChange: (value: string) => void;
  onEditEndpoint: () => void;
  onSaveEndpoint: () => void;
  onUseSavedEndpoint: () => void;
  saveState: SaveState;
  savedEndpoint: string | null;
  successMessage: string | null;
  theme: AppTheme;
};

export function EndpointScreen({
  canSubmit,
  endpointInput,
  errorMessage,
  hasSavedEndpoint,
  isLoadingStoredEndpoint,
  normalizedPreview,
  onEndpointChange,
  onEditEndpoint,
  onSaveEndpoint,
  onUseSavedEndpoint,
  saveState,
  savedEndpoint,
  successMessage,
  theme,
}: EndpointScreenProps) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.keyboardAvoidingView}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View
            accessible
            accessibilityLabel="AIChat Mobile"
            style={[
              styles.brandMark,
              {
                backgroundColor: theme.primarySurface,
                borderColor: theme.border,
              },
            ]}
          >
            <MaterialCommunityIcons name="server-network" size={30} color={theme.primary} />
          </View>

          <View style={styles.copy}>
            <Text style={[styles.eyebrow, { color: theme.primary }]}>AIChat Mobile</Text>
            <Text style={[styles.title, { color: theme.foreground }]}>配置服务端地址</Text>
            <Text style={[styles.description, { color: theme.mutedForeground }]}>
              输入 AIChat 后端根地址，连接检测通过后会保存在本机，后续启动自动恢复。
            </Text>
          </View>
        </View>

        <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {isLoadingStoredEndpoint ? (
            <View style={styles.loadingRow} accessibilityRole="progressbar">
              <ActivityIndicator color={theme.primary} />
              <Text style={[styles.panelBody, { color: theme.mutedForeground }]}>正在读取已保存地址</Text>
            </View>
          ) : (
            <>
              <View style={styles.panelHeader}>
                <View style={styles.panelTitleGroup}>
                  <Text style={[styles.panelTitle, { color: theme.foreground }]}>服务器地址</Text>
                  <Text style={[styles.panelBody, { color: theme.mutedForeground }]}>
                    例如 http://192.168.1.20:3000
                  </Text>
                </View>

                {hasSavedEndpoint ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="修改服务端地址"
                    hitSlop={8}
                    onPress={onEditEndpoint}
                    style={({ pressed }) => [
                      styles.iconButton,
                      {
                        backgroundColor: pressed ? theme.primarySurface : theme.inputBackground,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons name="pencil-outline" size={22} color={theme.primary} />
                  </Pressable>
                ) : null}
              </View>

              {hasSavedEndpoint ? (
                <View
                  accessibilityLabel={`已保存的服务端地址：${savedEndpoint}`}
                  style={[styles.savedEndpointBox, { backgroundColor: theme.successSurface, borderColor: theme.border }]}
                >
                  <MaterialCommunityIcons name="check-circle-outline" size={22} color={theme.success} />
                  <View style={styles.savedEndpointCopy}>
                    <Text style={[styles.savedEndpointLabel, { color: theme.success }]}>已保存</Text>
                    <Text style={[styles.savedEndpointValue, { color: theme.foreground }]}>{savedEndpoint}</Text>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: theme.foreground }]}>AIChat 服务端根地址</Text>
                    <TextInput
                      accessibilityLabel="AIChat 服务端根地址"
                      accessibilityHint="输入完整的 http 或 https 服务端地址"
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={saveState !== "checking"}
                      inputMode="url"
                      onChangeText={onEndpointChange}
                      placeholder="http://192.168.1.20:3000"
                      placeholderTextColor={theme.mutedForeground}
                      testID="server-endpoint-input"
                      style={[
                        styles.input,
                        {
                          backgroundColor: theme.inputBackground,
                          borderColor: errorMessage ? theme.danger : theme.border,
                          color: theme.foreground,
                        },
                      ]}
                      value={endpointInput}
                    />
                    <Text style={[styles.helperText, { color: theme.mutedForeground }]}>
                      请填写后端根地址，不需要手动追加 /api/settings/health。
                    </Text>
                    {normalizedPreview.ok ? (
                      <Text style={[styles.helperText, { color: theme.mutedForeground }]}>
                        将检测：{normalizedPreview.endpoint}/api/settings/health
                      </Text>
                    ) : null}
                  </View>

                  {errorMessage ? (
                    <View
                      accessibilityRole="alert"
                      style={[styles.feedbackBox, { backgroundColor: theme.dangerSurface, borderColor: theme.danger }]}
                    >
                      <MaterialCommunityIcons name="alert-circle-outline" size={22} color={theme.danger} />
                      <Text style={[styles.feedbackText, { color: theme.danger }]}>{errorMessage}</Text>
                    </View>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="检测并保存服务端地址"
                    accessibilityState={{ disabled: !canSubmit, busy: saveState === "checking" }}
                    disabled={!canSubmit}
                    onPress={onSaveEndpoint}
                    testID="server-endpoint-save-button"
                    style={({ pressed }) => [
                      styles.button,
                      {
                        backgroundColor: !canSubmit
                          ? theme.border
                          : pressed
                            ? theme.primaryPressed
                            : theme.primary,
                      },
                    ]}
                  >
                    {saveState === "checking" ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <MaterialCommunityIcons name="connection" size={20} color="#FFFFFF" />
                    )}
                    <Text style={styles.buttonText}>{saveState === "checking" ? "正在检测" : "检测并保存"}</Text>
                  </Pressable>

                  {savedEndpoint ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="取消修改服务端地址"
                      onPress={onUseSavedEndpoint}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        {
                          backgroundColor: pressed ? theme.primarySurface : "transparent",
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      <Text style={[styles.secondaryButtonText, { color: theme.primary }]}>取消修改</Text>
                    </Pressable>
                  ) : null}
                </>
              )}

              {successMessage ? (
                <View
                  accessibilityRole="summary"
                  style={[styles.feedbackBox, { backgroundColor: theme.successSurface, borderColor: theme.border }]}
                >
                  <MaterialCommunityIcons name="check-circle-outline" size={22} color={theme.success} />
                  <Text style={[styles.feedbackText, { color: theme.success }]}>{successMessage}</Text>
                </View>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing["2xl"],
    rowGap: spacing.xl,
  },
  header: {
    rowGap: spacing.xl,
  },
  brandMark: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  copy: {
    rowGap: spacing.sm,
  },
  eyebrow: {
    fontSize: 14,
    fontWeight: "700",
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    lineHeight: 38,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 480,
  },
  panel: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    rowGap: spacing.lg,
  },
  panelHeader: {
    alignItems: "flex-start",
    columnGap: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  panelTitleGroup: {
    flex: 1,
    rowGap: spacing.sm,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
  },
  panelBody: {
    fontSize: 16,
    lineHeight: 24,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  fieldGroup: {
    rowGap: spacing.sm,
  },
  label: {
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  helperText: {
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    alignItems: "center",
    borderRadius: 8,
    columnGap: spacing.sm,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "700",
  },
  feedbackBox: {
    alignItems: "flex-start",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    padding: spacing.md,
  },
  feedbackText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
  },
  loadingRow: {
    alignItems: "center",
    columnGap: spacing.md,
    flexDirection: "row",
    minHeight: 72,
  },
  savedEndpointBox: {
    alignItems: "flex-start",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    padding: spacing.md,
  },
  savedEndpointCopy: {
    flex: 1,
    rowGap: 4,
  },
  savedEndpointLabel: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  savedEndpointValue: {
    fontSize: 16,
    lineHeight: 24,
  },
});
