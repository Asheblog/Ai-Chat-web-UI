import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  KeyboardAvoidingView: () => null,
  Modal: () => null,
  Platform: { OS: "ios" },
  Pressable: () => null,
  ScrollView: () => null,
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: () => null,
  Text: () => null,
  TextInput: () => null,
  View: () => null,
}));
vi.mock("@expo/vector-icons", () => ({ MaterialCommunityIcons: () => null }));
vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  selectionAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

import { authInputSemantics, passwordToggleAccessibility } from "./AuthScreen";

describe("登录表单可访问与自动填充语义", () => {
  it("密码可见性按钮的文字随状态翻转", () => {
    expect(passwordToggleAccessibility(false)).toMatchObject({
      accessibilityRole: "button",
      accessibilityLabel: "显示密码",
      accessibilityState: { selected: false },
    });
    expect(passwordToggleAccessibility(true)).toMatchObject({
      accessibilityRole: "button",
      accessibilityLabel: "隐藏密码",
      accessibilityState: { selected: true },
    });
  });

  it("用户名使用账号自动填充语义", () => {
    expect(authInputSemantics("login").username).toMatchObject({
      accessibilityLabel: "用户名",
      autoCapitalize: "none",
      autoCorrect: false,
      autoComplete: "username",
      textContentType: "username",
    });
  });

  it("登录复用已保存密码，注册只提示新密码", () => {
    expect(authInputSemantics("login").password).toMatchObject({
      accessibilityLabel: "密码",
      autoComplete: "current-password",
      textContentType: "password",
    });
    expect(authInputSemantics("register").password).toMatchObject({
      accessibilityLabel: "密码",
      autoComplete: "new-password",
      textContentType: "newPassword",
    });
  });
});
