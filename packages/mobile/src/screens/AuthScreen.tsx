import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMemo, useRef, useState } from "react";
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

import type { AuthSession, RegisterResult } from "../auth-types";
import type { MobileApiClient } from "../mobile-api-client";
import type { AppTheme } from "../theme";
import { spacing } from "../theme";

type AuthMode = "login" | "register";
type SubmitState = "idle" | "submitting";

type AuthScreenProps = {
  apiClient: MobileApiClient;
  endpoint: string;
  onAuthenticated: (session: AuthSession) => Promise<void>;
  onEditEndpoint: () => void;
  theme: AppTheme;
};

export function AuthScreen({
  apiClient,
  endpoint,
  onAuthenticated,
  onEditEndpoint,
  theme,
}: AuthScreenProps) {
  const passwordInputRef = useRef<TextInput>(null);
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const isRegister = mode === "register";
  const canSubmit = submitState !== "submitting" && username.trim().length > 0 && password.length > 0;
  const title = isRegister ? "注册 AIChat 账号" : "登录 AIChat";
  const subtitle = isRegister
    ? "创建账号后，如果服务端开启审批，需等待管理员通过。"
    : "使用已保存的服务端地址登录，令牌会安全保存在本机。";

  const passwordHelper = useMemo(() => {
    if (!isRegister) {
      return "请输入你的 AIChat 密码。";
    }
    return "密码至少 8 位，注册后将使用服务端现有审批规则。";
  }, [isRegister]);

  async function handleSubmit() {
    setErrorMessage(null);
    setSuccessMessage(null);

    const normalizedUsername = username.trim();
    if (normalizedUsername.length < 3) {
      setErrorMessage("用户名至少需要 3 个字符。");
      return;
    }

    if (isRegister && password.length < 8) {
      setErrorMessage("注册密码至少需要 8 位。");
      return;
    }

    if (isRegister && password !== confirmPassword) {
      setErrorMessage("两次输入的密码不一致。");
      return;
    }

    setSubmitState("submitting");
    try {
      if (isRegister) {
        const result: RegisterResult = await apiClient.register(normalizedUsername, password);
        if (result.kind === "pending") {
          setMode("login");
          setPassword("");
          setConfirmPassword("");
          setSuccessMessage(result.message ?? "注册已提交，请审批后登录。");
          return;
        }

        await onAuthenticated(result.session);
        return;
      }

      const session = await apiClient.login(normalizedUsername, password);
      await onAuthenticated(session);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "认证请求失败，请重试。");
    } finally {
      setSubmitState("idle");
    }
  }

  function handleSwitchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setErrorMessage(null);
    setSuccessMessage(null);
    setConfirmPassword("");
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.keyboardAvoidingView}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View
            accessible
            accessibilityLabel="AIChat Mobile 认证"
            style={[
              styles.brandMark,
              {
                backgroundColor: theme.primarySurface,
                borderColor: theme.border,
              },
            ]}
          >
            <MaterialCommunityIcons name="shield-account-outline" size={30} color={theme.primary} />
          </View>

          <View style={styles.copy}>
            <Text style={[styles.eyebrow, { color: theme.primary }]}>AIChat Mobile</Text>
            <Text style={[styles.title, { color: theme.foreground }]}>{title}</Text>
            <Text style={[styles.description, { color: theme.mutedForeground }]}>{subtitle}</Text>
          </View>
        </View>

        <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.endpointBox, { backgroundColor: theme.inputBackground, borderColor: theme.border }]}>
            <MaterialCommunityIcons name="server-network" size={22} color={theme.primary} />
            <View style={styles.endpointCopy}>
              <Text style={[styles.endpointLabel, { color: theme.mutedForeground }]}>当前服务端</Text>
              <Text style={[styles.endpointValue, { color: theme.foreground }]}>{endpoint}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="修改服务端地址"
              hitSlop={8}
              onPress={onEditEndpoint}
              style={({ pressed }) => [
                styles.iconButton,
                { backgroundColor: pressed ? theme.primarySurface : "transparent" },
              ]}
            >
              <MaterialCommunityIcons name="pencil-outline" size={22} color={theme.primary} />
            </Pressable>
          </View>

          <View style={[styles.segmentedControl, { backgroundColor: theme.inputBackground, borderColor: theme.border }]}>
            <ModeButton active={mode === "login"} label="登录" onPress={() => handleSwitchMode("login")} theme={theme} />
            <ModeButton
              active={mode === "register"}
              label="注册"
              onPress={() => handleSwitchMode("register")}
              theme={theme}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: theme.foreground }]}>用户名</Text>
            <TextInput
              accessibilityLabel="用户名"
              autoCapitalize="none"
              autoCorrect={false}
              editable={submitState !== "submitting"}
              enterKeyHint="next"
              onChangeText={(value) => {
                setUsername(value);
                setErrorMessage(null);
              }}
              onSubmitEditing={() => {
                passwordInputRef.current?.focus();
              }}
              placeholder="请输入用户名"
              placeholderTextColor={theme.mutedForeground}
              returnKeyType="next"
              testID="auth-username-input"
              style={[
                styles.input,
                {
                  backgroundColor: theme.inputBackground,
                  borderColor: errorMessage ? theme.danger : theme.border,
                  color: theme.foreground,
                },
              ]}
              textContentType="username"
              value={username}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: theme.foreground }]}>密码</Text>
            <View
              style={[
                styles.passwordInputRow,
                {
                  backgroundColor: theme.inputBackground,
                  borderColor: errorMessage ? theme.danger : theme.border,
                },
              ]}
            >
              <TextInput
                accessibilityLabel="密码"
                autoCapitalize="none"
                autoCorrect={false}
                editable={submitState !== "submitting"}
                enterKeyHint="done"
                ref={passwordInputRef}
                onChangeText={(value) => {
                  setPassword(value);
                  setErrorMessage(null);
                }}
                onSubmitEditing={canSubmit ? handleSubmit : undefined}
                placeholder="请输入密码"
                placeholderTextColor={theme.mutedForeground}
                returnKeyType="done"
                secureTextEntry={!showPassword}
                style={[styles.passwordInput, { color: theme.foreground }]}
                testID="auth-password-input"
                textContentType={isRegister ? "newPassword" : "password"}
                value={password}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPassword ? "隐藏密码" : "显示密码"}
                hitSlop={8}
                onPress={() => setShowPassword((current) => !current)}
                style={styles.passwordToggle}
              >
                <MaterialCommunityIcons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={22}
                  color={theme.primary}
                />
              </Pressable>
            </View>
            <Text style={[styles.helperText, { color: theme.mutedForeground }]}>{passwordHelper}</Text>
          </View>

          {isRegister ? (
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: theme.foreground }]}>确认密码</Text>
              <TextInput
                accessibilityLabel="确认密码"
                autoCapitalize="none"
                autoCorrect={false}
                editable={submitState !== "submitting"}
                onChangeText={(value) => {
                  setConfirmPassword(value);
                  setErrorMessage(null);
                }}
                placeholder="再次输入密码"
                placeholderTextColor={theme.mutedForeground}
                secureTextEntry={!showPassword}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.inputBackground,
                    borderColor: errorMessage ? theme.danger : theme.border,
                    color: theme.foreground,
                  },
                ]}
                testID="auth-confirm-password-input"
                textContentType="newPassword"
                value={confirmPassword}
              />
            </View>
          ) : null}

          {errorMessage ? (
            <View
              accessibilityRole="alert"
              style={[styles.feedbackBox, { backgroundColor: theme.dangerSurface, borderColor: theme.danger }]}
            >
              <MaterialCommunityIcons name="alert-circle-outline" size={22} color={theme.danger} />
              <Text style={[styles.feedbackText, { color: theme.danger }]}>{errorMessage}</Text>
            </View>
          ) : null}

          {successMessage ? (
            <View
              accessibilityRole="summary"
              style={[styles.feedbackBox, { backgroundColor: theme.successSurface, borderColor: theme.border }]}
            >
              <MaterialCommunityIcons name="check-circle-outline" size={22} color={theme.success} />
              <Text style={[styles.feedbackText, { color: theme.success }]}>{successMessage}</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isRegister ? "注册 AIChat 账号" : "登录 AIChat"}
            accessibilityState={{ disabled: !canSubmit, busy: submitState === "submitting" }}
            disabled={!canSubmit}
            onPress={handleSubmit}
            testID="auth-submit-button"
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
            {submitState === "submitting" ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <MaterialCommunityIcons
                name={isRegister ? "account-plus-outline" : "login"}
                size={20}
                color="#FFFFFF"
              />
            )}
            <Text style={styles.buttonText}>
              {submitState === "submitting" ? "正在提交" : isRegister ? "注册" : "登录"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ModeButton({
  active,
  label,
  onPress,
  theme,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  theme: AppTheme;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.modeButton,
        {
          backgroundColor: active ? theme.primary : "transparent",
        },
      ]}
    >
      <Text style={[styles.modeButtonText, { color: active ? "#FFFFFF" : theme.foreground }]}>{label}</Text>
    </Pressable>
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
  endpointBox: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: 56,
    padding: spacing.md,
  },
  endpointCopy: {
    flex: 1,
    rowGap: 2,
  },
  endpointLabel: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  endpointValue: {
    fontSize: 15,
    lineHeight: 22,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  segmentedControl: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    padding: 4,
  },
  modeButton: {
    alignItems: "center",
    borderRadius: 6,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  modeButtonText: {
    fontSize: 16,
    fontWeight: "700",
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
  passwordInputRow: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 52,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  passwordInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 48,
    paddingVertical: spacing.sm,
  },
  passwordToggle: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  helperText: {
    fontSize: 14,
    lineHeight: 20,
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
});
