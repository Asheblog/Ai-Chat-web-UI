import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { createTheme, spacing } from "./theme";

export default function App() {
  const colorScheme = useColorScheme();
  const theme = useMemo(() => createTheme(colorScheme), [colorScheme]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <StatusBar style={theme.statusBarStyle} />
        <View style={styles.screen}>
          <View
            accessible
            accessibilityLabel="AIChat Mobile empty home screen"
            style={[
              styles.brandMark,
              {
                backgroundColor: theme.primarySurface,
                borderColor: theme.border,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="chat-processing-outline"
              size={32}
              color={theme.primary}
            />
          </View>

          <View style={styles.copy}>
            <Text style={[styles.eyebrow, { color: theme.primary }]}>AIChat Mobile</Text>
            <Text style={[styles.title, { color: theme.foreground }]}>空首页已就绪</Text>
            <Text style={[styles.description, { color: theme.mutedForeground }]}>
              阶段 1 只验证 Expo Android 空 App 能运行。后端连接、登录和聊天会在后续阶段接入。
            </Text>
          </View>

          <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.panelTitle, { color: theme.foreground }]}>当前阶段</Text>
            <Text style={[styles.panelBody, { color: theme.mutedForeground }]}>
              环境和空 Expo App
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mark mobile app launch check"
              accessibilityHint="Records the current time on this placeholder screen"
              onPress={() => setCheckedAt(new Date().toLocaleTimeString())}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: pressed ? theme.primaryPressed : theme.primary,
                },
              ]}
            >
              <Text style={styles.buttonText}>运行检查</Text>
            </Pressable>
            <Text style={[styles.checkText, { color: theme.mutedForeground }]}>
              {checkedAt ? `最近检查：${checkedAt}` : "等待 Android 真机启动验证"}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing["2xl"],
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
    maxWidth: 420,
  },
  panel: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    rowGap: spacing.md,
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
  button: {
    alignItems: "center",
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  checkText: {
    fontSize: 14,
    lineHeight: 20,
  },
});
