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

import type { AuthSession } from "../auth-types";
import { Button, SegmentedControl, SurfaceCard } from "../components/ui/UiPrimitives";
import type { MobileApiClient } from "../mobile-api-client";
import { lightTap, successTap } from "../native/haptics";
import type { AppTheme } from "../theme/tokens";
import { radii, spacing } from "../theme/tokens";

type AuthMode = "login" | "register";

type AuthScreenProps = {
  apiClient: MobileApiClient;
  endpoint: string;
  serverName?: string;
  onAuthenticated: (session: AuthSession) => Promise<void> | void;
  onEditEndpoint: () => void;
  theme: AppTheme;
};

export function AuthScreen({
  apiClient,
  endpoint,
  serverName,
  onAuthenticated,
  onEditEndpoint,
  theme,
}: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      setErrorMessage("请输入用户名和密码。");
      return;
    }

    setErrorMessage(null);
    setInfoMessage(null);
    setIsSubmitting(true);

    try {
      if (mode === "login") {
        const session = await apiClient.login(trimmedUser, password);
        await successTap();
        await onAuthenticated(session);
      } else {
        const result = await apiClient.register(trimmedUser, password);
        if (result.kind === "signed-in") {
          await successTap();
          await onAuthenticated(result.session);
        } else {
          await lightTap();
          setInfoMessage(result.message ?? "注册已提交，请等待管理员审核后登录。");
          setMode("login");
        }
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "认证失败，请重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

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
        <Pressable
          onPress={onEditEndpoint}
          style={[
            styles.serverChip,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <View style={[styles.dot, { backgroundColor: theme.success }]} />
          <Text numberOfLines={1} style={[styles.serverText, { color: theme.mutedForeground }]}>
            {serverName ? `${serverName} · ` : ""}
            {endpoint}
          </Text>
          <Text style={[styles.switchText, { color: theme.signalText }]}>更换</Text>
        </Pressable>

        <Text style={[styles.title, { color: theme.foreground }]}>
          {mode === "login" ? "登录到工作区" : "创建新账号"}
        </Text>

        <SegmentedControl
          onChange={(next) => {
            setMode(next);
            setErrorMessage(null);
            setInfoMessage(null);
          }}
          options={[
            { value: "login", label: "登录账号" },
            { value: "register", label: "注册新用户" },
          ]}
          theme={theme}
          value={mode}
        />

        <SurfaceCard theme={theme}>
          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.mutedForeground }]}>用户名</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setUsername}
                placeholder="输入用户名"
                placeholderTextColor={theme.tertiaryForeground}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.borderStrong,
                    color: theme.foreground,
                  },
                ]}
                value={username}
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.mutedForeground }]}>密码</Text>
              <View
                style={[
                  styles.passwordWrap,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.borderStrong,
                  },
                ]}
              >
                <TextInput
                  autoCapitalize="none"
                  onChangeText={setPassword}
                  placeholder="输入密码"
                  placeholderTextColor={theme.tertiaryForeground}
                  secureTextEntry={!showPassword}
                  style={[styles.passwordInput, { color: theme.foreground }]}
                  value={password}
                />
                <Pressable hitSlop={8} onPress={() => setShowPassword((v) => !v)}>
                  <MaterialCommunityIcons
                    color={theme.tertiaryForeground}
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={20}
                  />
                </Pressable>
              </View>
            </View>

            {errorMessage ? (
              <View
                style={[
                  styles.banner,
                  { backgroundColor: theme.dangerSurface, borderColor: theme.danger },
                ]}
              >
                <Text style={[styles.bannerText, { color: theme.danger }]}>
                  {errorMessage}
                </Text>
              </View>
            ) : null}

            {infoMessage ? (
              <View
                style={[
                  styles.banner,
                  { backgroundColor: theme.primarySurface, borderColor: theme.primary },
                ]}
              >
                <Text style={[styles.bannerText, { color: theme.signalText }]}>
                  {infoMessage}
                </Text>
              </View>
            ) : null}

            <Button
              disabled={isSubmitting}
              icon={mode === "login" ? "login" : "account-plus-outline"}
              label={mode === "login" ? "安全登录" : "提交注册"}
              loading={isSubmitting}
              onPress={handleSubmit}
              theme={theme}
            />

            <Text style={[styles.footnote, { color: theme.tertiaryForeground }]}>
              Token 将按当前服务器隔离，使用 iOS Keychain / Android Keystore 加密保存。
            </Text>
          </View>
        </SurfaceCard>
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
  serverChip: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    columnGap: 8,
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  serverText: {
    flex: 1,
    fontSize: 12,
  },
  switchText: {
    fontSize: 13,
    fontWeight: "600",
  },
  title: {
    fontSize: 25,
    fontWeight: "800",
  },
  form: {
    rowGap: 14,
  },
  field: {
    rowGap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
  input: {
    borderRadius: radii.md,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  passwordWrap: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    columnGap: 8,
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: 14,
  },
  passwordInput: {
    flex: 1,
    fontSize: 15,
  },
  banner: {
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  bannerText: {
    fontSize: 13,
    lineHeight: 19,
  },
  footnote: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
});
